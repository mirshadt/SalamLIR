import shutil
import tempfile
import unittest
from ipaddress import ip_network
from pathlib import Path

import backend.main as app
from backend.tests.test_bulk_assignment_release import HEADER, business_row

ROOT = "87.101.190.0/24"
CONTAINER = "87.101.190.112/28"
ASSIGNED = "87.101.190.120/29"


class CstContainerSplitTest(unittest.TestCase):
    """An Unassigned record already in CST now contains a newly loaded assignment (partial reassignment)."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.original_db_path = app.DB_PATH
        app.DB_PATH = self.temp_dir / "ipam.test.db"
        app.init_db()
        self.calls: list[tuple[str, str, str, int]] = []
        self.fail_operations: set[str] = set()
        original = app.execute_cst_real_api_job

        def fake(connection, config, resource, operation, payload, transaction_id):
            self.calls.append((operation, resource.cidr, transaction_id, resource.assignment_status_id))
            if operation in self.fail_operations:
                return "FAILED", f"CST {operation} rejected", {"accepted": False}
            return "SUCCESS", "", {"accepted": True, "externalApiCalled": True}

        app.execute_cst_real_api_job = fake
        self.addCleanup(setattr, app, "execute_cst_real_api_job", original)
        with app.connect() as connection:
            connection.execute("UPDATE cst_config SET enabled = 1, auto_execute = 1, send_enabled = 1, update_enabled = 1, delete_enabled = 1")
            pool = app.pool_from_network(ip_network(ROOT), "Root", "Central")
            app.insert_pool(connection, pool)
            root = app.sync_pool_resource(connection, pool)
        self.container_tx = self.send_unassigned_fragment(CONTAINER, root)

    def tearDown(self):
        app.DB_PATH = self.original_db_path
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def send_unassigned_fragment(self, cidr: str, root: app.ResourceRecord, status_id: int = 1) -> str:
        """Earlier unassigned-space migration: the block was sent to CST as its own record."""
        resource = app.cst_resource_from_network(
            ip_network(cidr), app.stable_uuid("test-fragment", cidr), app.BULK_UNASSIGNED_FRAGMENT_SOURCE, f"test:{cidr}", "test fragment"
        ).model_copy(update={"root_pool_uuid": root.resource_uuid, "parent_resource_uuid": root.resource_uuid, "assignment_status_id": status_id, "cst_sync_ready": True})
        with app.connect() as connection:
            app.upsert_resource_record(connection, resource)
            jobs = app.create_cst_sync_jobs(connection, [(resource, "SEND")], "TEST_SEND")
        self.assertEqual(jobs[0].status, "SUCCESS", jobs[0].last_error)
        self.calls.clear()
        return jobs[0].transaction_id

    def load_assignment(self, cidr: str = ASSIGNED, size: int = 8):
        result = app.process_assignment_bulk("\n".join([HEADER, business_row(cidr, size, "Abdul Latif Jameel", "SVC-1")]))
        self.assertEqual(result.imported, 1, result.errors)

    def ledger(self, transaction_id: str):
        with app.connect() as connection:
            return connection.execute("SELECT * FROM cst_transaction_ledger WHERE transaction_id = ?", (transaction_id,)).fetchone()

    def test_preview_plans_delete_then_send_assigned_and_remaining_portions(self):
        self.load_assignment()
        result = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=True))
        self.assertEqual(result.planned, 1)
        item = result.containers[0]
        self.assertEqual(item.container_cidr, CONTAINER)
        self.assertEqual(item.status, "PLANNED", item.reason)
        self.assertEqual(item.operations, [
            f"DeleteLIR {CONTAINER} (Transaction ID {self.container_tx})",
            "SendLIR 87.101.190.112/29 [Unassigned]",
            f"SendLIR {ASSIGNED} [Business]",
        ])
        self.assertEqual(self.calls, [])

    def test_execute_deletes_record_retires_transaction_and_sends_portions(self):
        self.load_assignment()
        result = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=False, execute_immediately=True))
        self.assertEqual(result.created_batches, 1)
        self.assertEqual([(op, cidr) for op, cidr, _tx, _status in self.calls], [
            ("DELETE", CONTAINER), ("SEND", "87.101.190.112/29"), ("SEND", ASSIGNED),
        ])
        self.assertEqual(self.calls[0][2], self.container_tx)
        self.assertEqual(self.calls[0][3], 1)
        self.assertNotIn(self.container_tx, {tx for _op, _cidr, tx, _status in self.calls[1:]})
        self.assertNotEqual(self.ledger(self.container_tx)["retired_at"], "")
        again = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=True))
        self.assertEqual(again.containers, [])

    def test_failed_delete_holds_the_sends(self):
        self.load_assignment()
        self.fail_operations = {"DELETE"}
        result = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=False, execute_immediately=True))
        self.assertEqual([op for op, *_ in self.calls], ["DELETE"])
        statuses = result.containers[0].job_statuses
        self.assertTrue(statuses[0].startswith("DELETE"))
        self.assertTrue(all(": PENDING" in status for status in statuses[1:]), statuses)
        self.assertEqual(self.ledger(self.container_tx)["retired_at"], "")

    def test_assigned_cst_record_is_never_deleted(self):
        with app.connect() as connection:
            root = app.find_resource_by_cidr(connection, ROOT)
        assigned_tx = self.send_unassigned_fragment("87.101.190.32/27", root, status_id=3)
        self.load_assignment("87.101.190.32/30", 4)
        result = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=False, execute_immediately=True))
        blocked = [item for item in result.containers if item.container_transaction_id == assigned_tx]
        self.assertEqual(blocked[0].status, "BLOCKED")
        self.assertIn("DeleteLIR needs Unassigned", blocked[0].reason)
        self.assertNotIn(("DELETE", "87.101.190.32/27"), {(op, cidr) for op, cidr, *_ in self.calls})

    def individual_assignment(self, cidr: str, size: int, customer: str = "Walk-in Customer"):
        """Assignment Management path: one assignment, sent to CST straight away."""
        import csv
        from io import StringIO
        row = next(csv.DictReader(StringIO("\n".join([HEADER, business_row(cidr, size, customer, "SVC-9")]))))
        payload = app.assignment_payload_from_bulk_row(row, ip_network(cidr), 3, "Active", 2)
        return app.add_assignment(payload)

    def operations(self):
        return [(op, cidr) for op, cidr, _tx, _status in self.calls]

    def test_individual_assignment_inside_cst_record_deletes_then_sends_portions(self):
        self.individual_assignment(ASSIGNED, 8)
        self.assertEqual(self.operations(), [("DELETE", CONTAINER), ("SEND", "87.101.190.112/29"), ("SEND", ASSIGNED)])
        self.assertNotEqual(self.ledger(self.container_tx)["retired_at"], "")
        with app.connect() as connection:
            fragment = app.find_resource_by_cidr(connection, "87.101.190.112/29")
            self.assertTrue(app.cst_resource_reported_to_cst(connection, fragment), "remaining portion is a saved local record held in CST")
        self.assertEqual(app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=True)).containers, [])

    def test_bulk_and_individual_paths_produce_the_same_cst_operations(self):
        self.load_assignment()
        result = app.create_manual_cst_migration_job(app.CstManualMigrationRequest())
        self.assertEqual(len(result.split_batch_ids), 1, result.message)
        with app.connect() as connection:
            batch = connection.execute("SELECT workflow_type FROM cst_sync_batches WHERE id = ?", (result.split_batch_ids[0],)).fetchone()
            queued = [(row["operation"], row["cidr"]) for row in connection.execute(
                "SELECT operation, cidr FROM cst_sync_jobs WHERE batch_id = ? ORDER BY sequence_no", (result.split_batch_ids[0],)
            )]
        self.assertTrue(batch["workflow_type"].startswith("PARTIAL_REASSIGNMENT"), "strictly sequenced batch")
        self.assertEqual(queued, [("DELETE", CONTAINER), ("SEND", "87.101.190.112/29"), ("SEND", ASSIGNED)])
        self.assertEqual(self.calls, [], "queued only; CST is called when pending jobs are pushed")

    def test_individual_assignment_also_sends_unsent_bulk_neighbour_in_same_record(self):
        self.load_assignment("87.101.190.112/30", 4)
        self.individual_assignment(ASSIGNED, 8)
        self.assertEqual(self.operations(), [
            ("DELETE", CONTAINER), ("SEND", "87.101.190.112/30"), ("SEND", "87.101.190.116/30"), ("SEND", ASSIGNED),
        ])

    def test_individual_assignment_saved_when_delete_succeeds_but_send_fails(self):
        self.fail_operations = {"SEND"}
        with self.assertRaises(app.HTTPException) as raised:
            self.individual_assignment(ASSIGNED, 8)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("Retry failed jobs", raised.exception.detail)
        with app.connect() as connection:
            self.assertIsNotNone(connection.execute("SELECT 1 FROM assignments WHERE cidr = ?", (ASSIGNED,)).fetchone())
        self.assertNotEqual(self.ledger(self.container_tx)["retired_at"], "", "CST deleted the record, so it stays retired locally")

    def test_individual_assignment_rolled_back_when_delete_fails(self):
        self.fail_operations = {"DELETE"}
        with self.assertRaises(app.HTTPException):
            self.individual_assignment(ASSIGNED, 8)
        with app.connect() as connection:
            self.assertIsNone(connection.execute("SELECT 1 FROM assignments WHERE cidr = ?", (ASSIGNED,)).fetchone())
        self.assertEqual(self.ledger(self.container_tx)["retired_at"], "")

    def controlled_sync(self):
        """auto_execute off: changes are saved and CST jobs queued until pending jobs are pushed."""
        with app.connect() as connection:
            connection.execute("UPDATE cst_config SET auto_execute = 0")

    def batch_jobs(self, batch_id: str):
        with app.connect() as connection:
            workflow = connection.execute("SELECT workflow_type FROM cst_sync_batches WHERE id = ?", (batch_id,)).fetchone()["workflow_type"]
            jobs = [(row["operation"], row["cidr"], row["status"]) for row in connection.execute(
                "SELECT operation, cidr, status FROM cst_sync_jobs WHERE batch_id = ? ORDER BY sequence_no", (batch_id,)
            )]
        return workflow, jobs

    def test_controlled_sync_individual_assignment_is_saved_and_queued(self):
        self.controlled_sync()
        assignment = self.individual_assignment(ASSIGNED, 8)
        self.assertEqual(assignment.cidr, ASSIGNED)
        self.assertEqual(self.calls, [])
        with app.connect() as connection:
            batch_id = connection.execute(
                "SELECT batch_id FROM cst_sync_jobs WHERE cidr = ? AND operation = 'DELETE' AND status = 'PENDING'", (CONTAINER,)
            ).fetchone()["batch_id"]
        workflow, jobs = self.batch_jobs(batch_id)
        self.assertTrue(app.cst_workflow_is_strict(workflow))
        self.assertEqual([(op, cidr) for op, cidr, _status in jobs], [("DELETE", CONTAINER), ("SEND", "87.101.190.112/29"), ("SEND", ASSIGNED)])
        self.assertEqual({status for *_rest, status in jobs}, {"PENDING"})
        self.assertEqual(self.ledger(self.container_tx)["retired_at"], "", "nothing changes in CST until the push")

    def test_controlled_sync_release_queues_unassign_then_delete(self):
        assignment = self.individual_assignment(ASSIGNED, 8)
        sent_tx = next(tx for op, cidr, tx, _status in self.calls if op == "SEND" and cidr == ASSIGNED)
        self.calls.clear()
        self.controlled_sync()
        app.unassign(assignment.id)
        self.assertEqual(self.calls, [])
        with app.connect() as connection:
            self.assertIsNone(connection.execute("SELECT 1 FROM assignments WHERE id = ?", (assignment.id,)).fetchone())
            batch_id = connection.execute("SELECT batch_id FROM cst_sync_jobs WHERE transaction_id = ? AND operation = 'DELETE'", (sent_tx,)).fetchone()["batch_id"]
        workflow, jobs = self.batch_jobs(batch_id)
        self.assertEqual(workflow, app.CST_RELEASE_WORKFLOW)
        self.assertEqual(jobs, [("UPDATE", ASSIGNED, "PENDING"), ("DELETE", ASSIGNED, "PENDING")])
        self.assertEqual(self.ledger(sent_tx)["retired_at"], "")

        with self.assertRaises(app.HTTPException) as raised:
            self.individual_assignment(ASSIGNED, 8, "New Customer")
        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("already queued", raised.exception.detail)
        self.assertIn("push pending CST jobs first", raised.exception.detail)

    def test_larger_free_block_replaces_smaller_cst_records(self):
        """Reverse overlap, e.g. after a release merges free space: the new block contains CST records."""
        with app.connect() as connection:
            root = app.find_resource_by_cidr(connection, ROOT)
        small_a = self.send_unassigned_fragment("87.101.190.0/30", root)
        small_b = self.send_unassigned_fragment("87.101.190.4/30", root)
        self.load_assignment("87.101.190.128/25", 128)
        result = app.run_cst_container_split(app.CstContainerSplitRequest(dry_run=True))
        group = next(item for item in result.containers if "87.101.190.0/30" in item.container_cidr)
        self.assertEqual(group.status, "PLANNED", group.reason)
        self.assertIn(small_a, group.container_transaction_id)
        self.assertIn(small_b, group.container_transaction_id)
        self.assertIn(CONTAINER, group.container_cidr)
        self.assertEqual(group.operations[-1], "SendLIR 87.101.190.0/25 [Unassigned]")


if __name__ == "__main__":
    unittest.main()

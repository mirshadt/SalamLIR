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

    def test_manual_migration_no_longer_sends_overlapping_subnet(self):
        self.load_assignment()
        with app.connect() as connection:
            operations, _eligible, _deletes = app.cst_migration_resource_operations(connection, app.CstManualMigrationRequest())
        sent = {resource.cidr for resource, operation in operations if operation == "SEND"}
        self.assertNotIn(ASSIGNED, sent)
        self.assertNotIn("87.101.190.112/29", sent)


if __name__ == "__main__":
    unittest.main()

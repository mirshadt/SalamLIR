import shutil
import tempfile
import unittest
from ipaddress import ip_network
from pathlib import Path

import backend.main as app

HEADER = "assignmentType,cidr,size,status,assignmentDate,customerName,organizationName,organizationId,customerTypeId,regionId,cityId,fullName,mobileNumber,idNumber,email,customerId,serviceId,serviceDescription,accessTechnologyId,owner,assignmentPurpose,site"


def business_row(cidr: str, size: int, customer: str, service_id: str) -> str:
    return f"BUSINESS,{cidr},{size},3,2026-07-29,{customer},{customer},1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,{service_id},Test service,1,Business Customer,Test,Site A"


class BulkAssignmentReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.original_db_path = app.DB_PATH
        app.DB_PATH = self.temp_dir / "ipam.test.db"
        app.init_db()
        pool = app.pool_from_network(ip_network("87.101.152.0/24"), "Migration root", "Central")
        with app.connect() as connection:
            app.insert_pool(connection, pool)
            app.sync_pool_resource(connection, pool)
        result = app.process_assignment_bulk("\n".join([
            HEADER,
            business_row("87.101.152.0/30", 4, "Alpha", "SVC-A"),
            business_row("87.101.152.4/30", 4, "Beta", "SVC-B"),
            business_row("87.101.152.8/30", 4, "Gamma", "SVC-C"),
        ]))
        self.assertEqual(result.imported, 3, result.errors)

    def tearDown(self):
        app.DB_PATH = self.original_db_path
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def assignment_cidrs(self) -> set[str]:
        with app.connect() as connection:
            return {row["cidr"] for row in connection.execute("SELECT cidr FROM assignments").fetchall()}

    def resource_cidrs(self) -> set[str]:
        with app.connect() as connection:
            return {row["cidr"] for row in connection.execute("SELECT cidr FROM ip_resources WHERE source_entity_type = 'assignment'").fetchall()}

    def test_deletes_listed_cidrs_and_reports_failures_per_row(self):
        result = app.process_assignment_release_bulk("\n".join([
            "cidr,customerName,reason",
            "87.101.152.0/30,Alpha,migration cleanup",
            "87.101.152.200/30,,not assigned",
            "87.101.152.4/30,Wrong Customer,",
        ]))
        self.assertEqual(result.imported, 1)
        self.assertEqual(result.blocked, 2)
        statuses = [row.processingStatus for row in result.output_rows if row.inputRowNumber]
        self.assertEqual(statuses, ["RELEASED", "FAILED", "FAILED"])
        self.assertIn("No assignment exists", result.output_rows[1].processingMessage)
        self.assertIn("belongs to 'Beta'", result.output_rows[2].processingMessage)
        self.assertEqual(self.assignment_cidrs(), {"87.101.152.4/30", "87.101.152.8/30"})
        self.assertNotIn("87.101.152.0/30", self.resource_cidrs())

    def test_dry_run_changes_nothing(self):
        result = app.process_assignment_release_bulk("cidr,serviceId\n87.101.152.0/30,SVC-A\n87.101.152.4/30,SVC-B", dry_run=True)
        self.assertEqual(result.imported, 2)
        self.assertEqual({row.processingStatus for row in result.output_rows}, {"WOULD_RELEASE"})
        self.assertEqual(len(self.assignment_cidrs()), 3)

    def test_service_id_mismatch_and_duplicate_rows_are_rejected(self):
        result = app.process_assignment_release_bulk("cidr,serviceId\n87.101.152.8/30,SVC-X\n87.101.152.4/30,\n87.101.152.4/30,")
        self.assertEqual([row.processingStatus for row in result.output_rows if row.inputRowNumber], ["FAILED", "RELEASED", "FAILED"])
        self.assertIn("serviceId", result.output_rows[0].processingMessage)
        self.assertIn("more than once", result.output_rows[2].processingMessage)

    def test_unaligned_cidr_is_rejected(self):
        result = app.process_assignment_release_bulk("cidr\n87.101.152.1/30")
        self.assertEqual(result.blocked, 1)
        self.assertIn("not CIDR-aligned", result.output_rows[0].processingMessage)

    def resource_row(self, cidr: str):
        with app.connect() as connection:
            return connection.execute("SELECT * FROM ip_resources WHERE cidr = ?", (cidr,)).fetchone()

    def fake_cst(self, fail_operations: set[str] | None = None):
        """Replace only the HTTP call to CST; job records and the transaction ledger run for real."""
        fail_operations = fail_operations or set()
        calls: list[tuple[str, str, int]] = []
        original = app.execute_cst_real_api_job

        def fake(connection, config, resource, operation, payload, transaction_id):
            calls.append((operation, transaction_id, resource.assignment_status_id))
            if operation in fail_operations:
                return "FAILED", f"CST {operation} rejected", {"accepted": False}
            return "SUCCESS", "", {"accepted": True, "externalApiCalled": True}

        app.execute_cst_real_api_job = fake
        self.addCleanup(setattr, app, "execute_cst_real_api_job", original)
        with app.connect() as connection:
            connection.execute("UPDATE cst_config SET enabled = 1, auto_execute = 1, send_enabled = 1, update_enabled = 1, delete_enabled = 1")
        return calls

    def send_to_cst(self, cidr: str) -> str:
        with app.connect() as connection:
            assignment_id = connection.execute("SELECT id FROM assignments WHERE cidr = ?", (cidr,)).fetchone()["id"]
            resource = app.find_resource_by_source(connection, "assignment", assignment_id)
            jobs = app.create_cst_sync_jobs(connection, [(resource, "SEND")], "TEST_SEND")
        self.assertEqual(jobs[0].status, "SUCCESS", jobs[0].last_error)
        return jobs[0].transaction_id

    def ledger(self, transaction_id: str):
        with app.connect() as connection:
            return connection.execute("SELECT * FROM cst_transaction_ledger WHERE transaction_id = ?", (transaction_id,)).fetchone()

    def test_release_in_cst_only_unassigns_and_keeps_record(self):
        """Termination policy: UpdateLIR to Unassigned only; record, Transaction ID and local subnet kept."""
        calls = self.fake_cst()
        transaction_id = self.send_to_cst("87.101.152.0/30")
        before = self.resource_row("87.101.152.0/30")
        result = app.process_assignment_release_bulk("cidr\n87.101.152.0/30")
        self.assertEqual(result.output_rows[0].processingStatus, "RELEASED", result.errors)
        self.assertIn(f"Transaction ID {transaction_id} kept", result.output_rows[0].processingMessage)
        self.assertEqual([(op, tx, status_id) for op, tx, status_id in calls[1:]], [("UPDATE", transaction_id, 1)])
        self.assertEqual(self.ledger(transaction_id)["retired_at"], "", "no DeleteLIR: Transaction ID stays active")
        self.assertNotIn("87.101.152.0/30", self.assignment_cidrs())
        after = self.resource_row("87.101.152.0/30")
        self.assertEqual(after["resource_uuid"], before["resource_uuid"])
        self.assertEqual((after["status"], after["assignment_status_id"], after["customer_name"], after["source_entity_type"]), ("AVAILABLE", 1, "", app.BULK_UNASSIGNED_FRAGMENT_SOURCE))
        self.assertEqual(after["transaction_id"], transaction_id)
        with app.connect() as connection:
            reasons = [row["archived_reason"] for row in connection.execute("SELECT archived_reason FROM ip_resource_history WHERE cidr = '87.101.152.0/30'").fetchall()]
            self.assertIn("ASSIGNMENT_RELEASED_CST_UNASSIGNED", reasons)
            self.assertFalse(app.cst_resource_needs_send(connection, app.resource_from_row(after)), "in sync with CST")
            self.assertIsNone(app.cst_resource_pending_update(connection, app.resource_from_row(after)))

    def test_new_customer_on_released_cidr_updates_same_transaction(self):
        calls = self.fake_cst()
        transaction_id = self.send_to_cst("87.101.152.0/30")
        app.process_assignment_release_bulk("cidr\n87.101.152.0/30")
        result = app.process_assignment_bulk("\n".join([HEADER, business_row("87.101.152.0/30", 4, "Delta", "SVC-D")]))
        self.assertEqual(result.imported, 1, result.errors)
        with app.connect() as connection:
            resource = app.find_resource_by_cidr(connection, "87.101.152.0/30")
            outcome = app.cst_send_resources(connection, [resource], "TEST_MIGRATION", queue_only=False)
        self.assertEqual([(job.operation, job.transaction_id, job.status) for job in outcome.jobs], [("UPDATE", transaction_id, "SUCCESS")])
        self.assertEqual(calls[-1], ("UPDATE", transaction_id, 3))

    def test_update_failure_changes_nothing(self):
        self.fake_cst()
        self.send_to_cst("87.101.152.0/30")
        self.fake_cst({"UPDATE"})
        result = app.process_assignment_release_bulk("cidr\n87.101.152.0/30\n87.101.152.4/30")
        self.assertEqual([row.processingStatus for row in result.output_rows if row.inputRowNumber], ["FAILED", "RELEASED"])
        with app.connect() as connection:
            row = connection.execute("SELECT status FROM assignments WHERE cidr = '87.101.152.0/30'").fetchone()
        self.assertEqual(row["status"], "Active")

    def test_no_delete_is_ever_sent_on_release(self):
        calls = self.fake_cst()
        self.send_to_cst("87.101.152.0/30")
        self.send_to_cst("87.101.152.4/30")
        app.process_assignment_release_bulk("cidr\n87.101.152.0/30\n87.101.152.4/30")
        self.assertNotIn("DELETE", [op for op, _tx, _status in calls])
        self.assertIn("87.101.152.0/30", self.resource_cidrs_all())
        self.assertIn("87.101.152.4/30", self.resource_cidrs_all(), "released blocks held in CST are not merged into a /29")
        self.assertNotIn("87.101.152.0/29", self.resource_cidrs_all())

    def resource_cidrs_all(self) -> set[str]:
        with app.connect() as connection:
            return {row["cidr"] for row in connection.execute("SELECT cidr FROM ip_resources").fetchall()}

    def test_release_not_in_cst_makes_no_cst_call(self):
        calls = self.fake_cst()
        result = app.process_assignment_release_bulk("cidr\n87.101.152.4/30")
        self.assertEqual(result.output_rows[0].processingStatus, "RELEASED")
        self.assertEqual(calls, [])
        self.assertNotIn("87.101.152.4/30", self.resource_cidrs())

    def test_single_unassign_endpoint_uses_same_rules(self):
        calls = self.fake_cst()
        self.send_to_cst("87.101.152.8/30")
        with app.connect() as connection:
            assignment_id = connection.execute("SELECT id FROM assignments WHERE cidr = '87.101.152.8/30'").fetchone()["id"]
        app.unassign(assignment_id)
        self.assertEqual([op for op, _tx, _status in calls], ["SEND", "UPDATE"])


if __name__ == "__main__":
    unittest.main()

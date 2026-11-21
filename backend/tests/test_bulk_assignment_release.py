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

    def test_cst_failure_rolls_back_that_row_only(self):
        with app.connect() as connection:
            connection.execute("UPDATE ip_resources SET cst_sync_status = 'SUCCESS' WHERE cidr = '87.101.152.0/30'")
        original = app.create_cst_sync_jobs

        def failing_jobs(connection, items, workflow_type, *args, **kwargs):
            resource = items[0][0]
            return [app.CstSyncJob.model_construct(status="FAILED", cidr=resource.cidr, last_error="CST unreachable")]

        app.create_cst_sync_jobs = failing_jobs
        try:
            result = app.process_assignment_release_bulk("cidr\n87.101.152.0/30\n87.101.152.4/30")
        finally:
            app.create_cst_sync_jobs = original
        self.assertEqual([row.processingStatus for row in result.output_rows if row.inputRowNumber], ["FAILED", "RELEASED"])
        self.assertIn("CST unreachable", result.output_rows[0].processingMessage)
        self.assertIn("87.101.152.0/30", self.assignment_cidrs())
        with app.connect() as connection:
            status = connection.execute("SELECT status FROM assignments WHERE cidr = '87.101.152.0/30'").fetchone()["status"]
        self.assertNotEqual(status, "Retiring")

    def resource_row(self, cidr: str):
        with app.connect() as connection:
            return connection.execute("SELECT * FROM ip_resources WHERE cidr = ?", (cidr,)).fetchone()

    def test_release_keeps_subnet_and_clears_customer(self):
        before = self.resource_row("87.101.152.0/30")
        app.process_assignment_release_bulk("cidr\n87.101.152.0/30")
        after = self.resource_row("87.101.152.0/30")
        self.assertIsNotNone(after, "released subnet must not be deleted")
        self.assertEqual(after["resource_uuid"], before["resource_uuid"])
        self.assertNotEqual(after["version_uuid"], before["version_uuid"])
        self.assertEqual(after["status"], "AVAILABLE")
        self.assertEqual(after["ownership_type"], "POOL")
        self.assertEqual(after["assignment_status_id"], 1)
        for field in ("customer_name", "organization_name", "service_id", "full_name", "mobile_number", "email"):
            self.assertEqual(after[field], "", field)
        self.assertTrue(after["source_entity_id"].startswith(app.RELEASED_SUBNET_SOURCE_PREFIX))
        with app.connect() as connection:
            history = connection.execute("SELECT * FROM ip_resource_history WHERE archived_resource_uuid = ?", (before["resource_uuid"],)).fetchall()
            details = connection.execute("SELECT COUNT(*) FROM assignment_details WHERE resource_uuid = ?", (before["resource_uuid"],)).fetchone()[0]
        self.assertEqual([row["archived_reason"] for row in history], ["ASSIGNMENT_RELEASED"])
        self.assertEqual(history[0]["customer_name"], "Alpha")
        self.assertEqual(details, 0)

    def test_released_subnet_is_not_merged_into_larger_free_block(self):
        app.process_assignment_release_bulk("cidr\n87.101.152.0/30\n87.101.152.4/30")
        with app.connect() as connection:
            app.materialize_bulk_unassigned_fragments(connection)
        cidrs = self.resource_cidrs() | {row["cidr"] for row in app.connect().execute("SELECT cidr FROM ip_resources").fetchall()}
        self.assertIn("87.101.152.0/30", cidrs)
        self.assertIn("87.101.152.4/30", cidrs)
        self.assertNotIn("87.101.152.0/29", cidrs)

    def test_reassign_same_cidr_reuses_released_subnet(self):
        before = self.resource_row("87.101.152.0/30")
        app.process_assignment_release_bulk("cidr\n87.101.152.0/30")
        result = app.process_assignment_bulk("\n".join([HEADER, business_row("87.101.152.0/30", 4, "Delta", "SVC-D")]))
        self.assertEqual(result.imported, 1, result.errors)
        self.assertNotEqual(result.output_rows[0].processingStatus, "IMPORTED_WITH_CONFLICT")
        after = self.resource_row("87.101.152.0/30")
        self.assertEqual(after["resource_uuid"], before["resource_uuid"])
        self.assertEqual(after["source_entity_type"], "assignment")
        self.assertEqual(after["customer_name"], "Delta")

    def test_assigning_part_of_released_subnet_refragments_it(self):
        pool = app.pool_from_network(ip_network("87.101.153.0/24"), "Second root", "Central")
        with app.connect() as connection:
            app.insert_pool(connection, pool)
            app.sync_pool_resource(connection, pool)
        self.assertEqual(app.process_assignment_bulk("\n".join([HEADER, business_row("87.101.153.0/29", 8, "Wide", "SVC-W")])).imported, 1)
        released_uuid = self.resource_row("87.101.153.0/29")["resource_uuid"]
        app.process_assignment_release_bulk("cidr\n87.101.153.0/29")
        self.assertEqual(self.resource_row("87.101.153.0/29")["status"], "AVAILABLE")
        result = app.process_assignment_bulk("\n".join([HEADER, business_row("87.101.153.0/30", 4, "Narrow", "SVC-N")]))
        self.assertEqual(result.imported, 1, result.errors)
        self.assertIsNone(self.resource_row("87.101.153.0/29"))
        self.assertEqual(self.resource_row("87.101.153.4/30")["status"], "AVAILABLE")
        with app.connect() as connection:
            reasons = [row["archived_reason"] for row in connection.execute("SELECT archived_reason FROM ip_resource_history WHERE archived_resource_uuid = ?", (released_uuid,)).fetchall()]
        self.assertIn("RELEASED_SUBNET_REUSED", reasons)

    def test_single_unassign_endpoint_also_keeps_subnet(self):
        with app.connect() as connection:
            assignment_id = connection.execute("SELECT id FROM assignments WHERE cidr = '87.101.152.8/30'").fetchone()["id"]
        app.unassign(assignment_id)
        self.assertEqual(self.resource_row("87.101.152.8/30")["status"], "AVAILABLE")


if __name__ == "__main__":
    unittest.main()

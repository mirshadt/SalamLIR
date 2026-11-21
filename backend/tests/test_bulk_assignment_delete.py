import shutil
import tempfile
import unittest
from ipaddress import ip_network
from pathlib import Path

import backend.main as app

HEADER = "assignmentType,cidr,size,status,assignmentDate,customerName,organizationName,organizationId,customerTypeId,regionId,cityId,fullName,mobileNumber,idNumber,email,customerId,serviceId,serviceDescription,accessTechnologyId,owner,assignmentPurpose,site"


def business_row(cidr: str, size: int, customer: str, service_id: str) -> str:
    return f"BUSINESS,{cidr},{size},3,2026-07-29,{customer},{customer},1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,{service_id},Test service,1,Business Customer,Test,Site A"


class BulkAssignmentDeleteTest(unittest.TestCase):
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
        result = app.process_assignment_delete_bulk("\n".join([
            "cidr,customerName,reason",
            "87.101.152.0/30,Alpha,migration cleanup",
            "87.101.152.200/30,,not assigned",
            "87.101.152.4/30,Wrong Customer,",
        ]))
        self.assertEqual(result.imported, 1)
        self.assertEqual(result.blocked, 2)
        statuses = [row.processingStatus for row in result.output_rows if row.inputRowNumber]
        self.assertEqual(statuses, ["DELETED", "FAILED", "FAILED"])
        self.assertIn("No assignment exists", result.output_rows[1].processingMessage)
        self.assertIn("belongs to 'Beta'", result.output_rows[2].processingMessage)
        self.assertEqual(self.assignment_cidrs(), {"87.101.152.4/30", "87.101.152.8/30"})
        self.assertNotIn("87.101.152.0/30", self.resource_cidrs())

    def test_dry_run_changes_nothing(self):
        result = app.process_assignment_delete_bulk("cidr,serviceId\n87.101.152.0/30,SVC-A\n87.101.152.4/30,SVC-B", dry_run=True)
        self.assertEqual(result.imported, 2)
        self.assertEqual({row.processingStatus for row in result.output_rows}, {"WOULD_DELETE"})
        self.assertEqual(len(self.assignment_cidrs()), 3)

    def test_service_id_mismatch_and_duplicate_rows_are_rejected(self):
        result = app.process_assignment_delete_bulk("cidr,serviceId\n87.101.152.8/30,SVC-X\n87.101.152.4/30,\n87.101.152.4/30,")
        self.assertEqual([row.processingStatus for row in result.output_rows if row.inputRowNumber], ["FAILED", "DELETED", "FAILED"])
        self.assertIn("serviceId", result.output_rows[0].processingMessage)
        self.assertIn("more than once", result.output_rows[2].processingMessage)

    def test_unaligned_cidr_is_rejected(self):
        result = app.process_assignment_delete_bulk("cidr\n87.101.152.1/30")
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
            result = app.process_assignment_delete_bulk("cidr\n87.101.152.0/30\n87.101.152.4/30")
        finally:
            app.create_cst_sync_jobs = original
        self.assertEqual([row.processingStatus for row in result.output_rows if row.inputRowNumber], ["FAILED", "DELETED"])
        self.assertIn("CST unreachable", result.output_rows[0].processingMessage)
        self.assertIn("87.101.152.0/30", self.assignment_cidrs())
        with app.connect() as connection:
            status = connection.execute("SELECT status FROM assignments WHERE cidr = '87.101.152.0/30'").fetchone()["status"]
        self.assertNotEqual(status, "Retiring")

    def test_freed_cidr_can_be_reassigned_by_bulk_add(self):
        app.process_assignment_delete_bulk("cidr\n87.101.152.0/30")
        result = app.process_assignment_bulk("\n".join([HEADER, business_row("87.101.152.0/30", 4, "Delta", "SVC-D")]))
        self.assertEqual(result.imported, 1, result.errors)
        self.assertEqual(result.output_rows[0].processingStatus != "IMPORTED_WITH_CONFLICT", True)


if __name__ == "__main__":
    unittest.main()

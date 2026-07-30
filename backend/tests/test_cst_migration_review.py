import shutil
import tempfile
import unittest
from ipaddress import ip_network
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

import backend.main as app


class CstMigrationReviewWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.original_db_path = app.DB_PATH
        app.DB_PATH = self.temp_dir / "ipam.test.db"
        app.init_db()

    def tearDown(self):
        app.DB_PATH = self.original_db_path
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def add_resource(self, cidr: str, customer: str = "Customer", service_id: str = "SVC-1") -> app.ResourceRecord:
        network = ip_network(cidr)
        resource = app.cst_resource_from_network(
            network,
            str(uuid4()),
            "assignment",
            str(uuid4()),
            customer,
        ).model_copy(update={
            "ownership_type": "BUSINESS",
            "status": "ASSIGNED",
            "assignment_status_id": 3,
            "customer_name": customer,
            "organization_name": customer,
            "organization_id": "1234567890",
            "customer_type_id": "2",
            "region_id": "14",
            "city_id": "1",
            "full_name": "Test Contact",
            "mobile_number": "966500000000",
            "id_number": "0000000000",
            "email": "test@example.com",
            "service_id": service_id,
            "service_description": "Migration test",
            "cst_sync_ready": True,
            "cst_validation_status": "READY",
        })
        with app.connect() as connection:
            app.upsert_resource_record(connection, resource)
        return resource

    def table_count(self, table: str) -> int:
        with app.connect() as connection:
            return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    def test_review_does_not_create_jobs_or_transactions(self):
        self.add_resource("128.127.225.0/30")
        review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned"))
        self.assertEqual(review.total, 1)
        self.assertEqual(review.items[0].operation, "SEND")
        self.assertEqual(self.table_count("cst_sync_jobs"), 0)
        self.assertEqual(self.table_count("cst_transaction_ledger"), 0)

    def test_final_create_requires_confirmation(self):
        self.add_resource("128.127.225.0/30")
        review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned"))
        with self.assertRaises(HTTPException):
            app.create_cst_migration_job_from_review(app.CstMigrationReviewCreateRequest(
                included_review_ids=[review.items[0].review_id],
                final_confirmed=False,
            ))

    def test_create_uses_only_included_ids_and_prevents_duplicate_review(self):
        first = self.add_resource("128.127.225.0/30", "Customer A", "SVC-A")
        second = self.add_resource("128.127.226.0/30", "Customer B", "SVC-B")
        review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned"))
        include_id = next(item.review_id for item in review.items if item.resource_uuid == first.resource_uuid)
        exclude_id = next(item.review_id for item in review.items if item.resource_uuid == second.resource_uuid)
        result = app.create_cst_migration_job_from_review(app.CstMigrationReviewCreateRequest(
            included_review_ids=[include_id],
            excluded_review_ids=[exclude_id],
            resource_scope="assigned",
            final_confirmed=True,
            created_by="unit-test",
        ))
        self.assertEqual(result.created_jobs, 1)
        self.assertEqual(self.table_count("cst_sync_jobs"), 1)
        next_review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned"))
        self.assertNotIn(include_id, next_review.all_matching_review_ids)
        self.assertIn(exclude_id, next_review.all_matching_review_ids)


    def test_bulk_assignment_extra_csv_values_reports_row_error(self):
        csv_text = "\n".join([
            "assignmentType,cidr,status,assignmentDate,customerName,customerId,serviceId",
            "BUSINESS,87.101.152.0/30,3,2026-07-29,Customer A,CUST-1,SVC-1,unexpected-extra",
        ])
        result = app.process_assignment_bulk(csv_text)
        self.assertEqual(result.imported, 0)
        self.assertEqual(result.blocked, 1)
        self.assertEqual(result.output_rows[0].processingStatus, "FAILED")
        self.assertIn("more values than the CSV header", result.output_rows[0].processingMessage)


    def test_integrity_conflict_assignment_is_not_eligible_for_cst_review(self):
        parent_pool = app.pool_from_network(ip_network("87.101.153.0/24"), "Migration root", "Central")
        with app.connect() as connection:
            app.insert_pool(connection, parent_pool)
            app.sync_pool_resource(connection, parent_pool)

        csv_text = "\n".join([
            "assignmentType,cidr,size,status,assignmentDate,customerName,organizationName,organizationId,customerTypeId,regionId,cityId,fullName,mobileNumber,idNumber,email,customerId,serviceId,serviceDescription,accessTechnologyId,owner,assignmentPurpose,site",
            "BUSINESS,87.101.153.0/29,8,3,2026-07-29,First Customer,First Customer,1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,SVC-1,Test service,1,Business Customer,Test,Site A",
            "BUSINESS,87.101.153.4/30,4,3,2026-07-29,Overlap Customer,Overlap Customer,1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,SVC-2,Test service,1,Business Customer,Test,Site B",
        ])
        result = app.process_assignment_bulk(csv_text)
        self.assertEqual(result.imported, 2)
        conflict_row = result.output_rows[1]
        self.assertEqual(conflict_row.processingStatus, "IMPORTED_WITH_CONFLICT")

        review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned"))
        reviewed_cidrs = {item.cidr for item in review.items}
        self.assertIn("87.101.153.0/29", reviewed_cidrs)
        self.assertNotIn("87.101.153.4/30", reviewed_cidrs)


    def test_bulk_exact_duplicate_imports_as_conflict(self):
        parent_pool = app.pool_from_network(ip_network("87.101.152.0/24"), "Migration root", "Central")
        with app.connect() as connection:
            app.insert_pool(connection, parent_pool)
            app.sync_pool_resource(connection, parent_pool)

        csv_text = "\n".join([
            "assignmentType,cidr,size,status,assignmentDate,customerName,organizationName,organizationId,customerTypeId,regionId,cityId,fullName,mobileNumber,idNumber,email,customerId,serviceId,serviceDescription,accessTechnologyId,owner,assignmentPurpose,site",
            "BUSINESS,87.101.152.0/30,4,3,2026-07-29,First Customer,First Customer,1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,SVC-1,Test service,1,Business Customer,Test,Site A",
            "BUSINESS,87.101.152.0/30,4,3,2026-07-29,Second Customer,Second Customer,1234567890,2,14,1,Test Contact,966500000000,0000000000,test@example.com,1234567890,SVC-2,Test service,1,Business Customer,Test,Site B",
        ])
        result = app.process_assignment_bulk(csv_text)
        self.assertEqual(result.imported, 2)
        self.assertEqual(result.blocked, 0)
        self.assertEqual(result.output_rows[1].processingStatus, "IMPORTED_WITH_CONFLICT")
        self.assertIn("exactly duplicates existing assignment", result.output_rows[1].cstValidationErrors)
        with app.connect() as connection:
            assignment_count = connection.execute("SELECT COUNT(*) FROM assignments WHERE cidr = ?", ("87.101.152.0/30",)).fetchone()[0]
            resource_count = connection.execute("SELECT COUNT(*) FROM ip_resources WHERE cidr = ?", ("87.101.152.0/30",)).fetchone()[0]
        self.assertEqual(assignment_count, 2)
        self.assertEqual(resource_count, 1)



if __name__ == "__main__":
    unittest.main()
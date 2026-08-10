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

    def test_cst_payload_defaults_missing_or_invalid_business_email(self):
        cases = [
            ("128.127.225.0/30", ""),
            ("128.127.225.4/30", "bad-email"),
            ("128.127.225.8/30", "e.kashkash@it-absolute.com;"),
        ]
        for cidr, raw_email in cases:
            with self.subTest(raw_email=raw_email):
                resource = self.add_resource(cidr).model_copy(update={"email": raw_email, "contact_email": raw_email})
                payload = app.cst_payload_for_resource(resource, "SEND", "tx-email-test", "unit-test")
                record = app.cst_payload_record(payload)

                self.assertEqual(record["contact"]["email"], app.CST_FALLBACK_EMAIL)
                self.assertNotIn("contact.email", "; ".join(app.cst_data_quality_issues(resource, "SEND", payload)))

    def test_cst_send_payload_for_internal_assignment_is_minimal(self):
        resource = self.add_resource("128.127.225.12/30").model_copy(update={
            "ownership_type": "INTERNAL",
            "assignment_status_id": 2,
            "customer_name": "Salam Internal",
            "organization_name": "Should Not Be Sent",
            "organization_id": "1234567890",
            "customer_type_id": "2",
            "region_id": "14",
            "city_id": "1",
            "full_name": "Internal Contact",
            "mobile_number": "966500000000",
            "id_number": "0000000000",
            "email": "internal@example.com",
            "description": "Should Not Be Sent",
            "assignment_date": "2026-08-11",
            "update_date": "2026-08-11",
            "service_description": "Internal firewall management",
        })
        payload = app.cst_payload_for_resource(resource, "SEND", "tx-internal-test", "unit-test")
        record = app.cst_payload_record(payload)

        self.assertEqual(set(record), {
            "transactionId",
            "ipSubnet",
            "asn",
            "ipVersionId",
            "assignmentStatusId",
            "serviceDescription",
        })
        self.assertEqual(record["transactionId"], "tx-internal-test")
        self.assertEqual(record["ipSubnet"], "128.127.225.12/30")
        self.assertEqual(record["assignmentStatusId"], 2)
        self.assertEqual(record["serviceDescription"], "Internal firewall management")

    def test_minimal_internal_bulk_assignment_does_not_require_customer_fields(self):
        parent_pool = app.pool_from_network(ip_network("128.127.225.0/24"), "Internal root", "Central")
        with app.connect() as connection:
            app.insert_pool(connection, parent_pool)
            app.sync_pool_resource(connection, parent_pool)

        csv_text = "\n".join([
            "assignmentType,cidr,size,status,assignmentDate,serviceDescription",
            "INTERNAL,128.127.225.16/30,4,,2026-08-11,Internal firewall management",
        ])
        result = app.process_assignment_bulk(csv_text)

        self.assertEqual(result.imported, 1)
        self.assertEqual(result.blocked, 0)
        self.assertEqual(result.output_rows[0].processingStatus, "SUCCESS")
        self.assertEqual(result.output_rows[0].status, "2")
        self.assertEqual(result.output_rows[0].cstValidationErrors, "")
        self.assertEqual(result.output_rows[0].cstValidationWarnings, "")

        with app.connect() as connection:
            row = connection.execute(
                "SELECT * FROM ip_resources WHERE cidr = ?",
                ("128.127.225.16/30",),
            ).fetchone()
        self.assertIsNotNone(row)
        resource = app.resource_from_row(row)
        payload = app.cst_payload_for_resource(resource, "SEND", "tx-internal-bulk", "unit-test")
        record = app.cst_payload_record(payload)
        self.assertEqual(set(record), {
            "transactionId",
            "ipSubnet",
            "asn",
            "ipVersionId",
            "assignmentStatusId",
            "serviceDescription",
        })
        self.assertEqual(record["assignmentStatusId"], 2)

    def test_cst_batch_transaction_result_uses_individual_response(self):
        response = {
            "externalApiCalled": True,
            "accepted": False,
            "body": {
                "data": {
                    "success": [{"transactionId": "ok-tx"}],
                    "failure": [{"transactionId": "bad-tx", "message": "Internal Server Error"}],
                },
                "status": {"httpCode": "440", "status": "false"},
            },
        }

        ok_status, ok_error, ok_response = app.cst_batch_transaction_result("FAILED", "CST API HTTP 440", response, "ok-tx")
        bad_status, bad_error, bad_response = app.cst_batch_transaction_result("FAILED", "CST API HTTP 440", response, "bad-tx")

        self.assertEqual(ok_status, "SUCCESS")
        self.assertEqual(ok_error, "")
        self.assertTrue(ok_response["accepted"])
        self.assertEqual(ok_response["individualTransactionStatus"], "SUCCESS")
        self.assertEqual(bad_status, "FAILED")
        self.assertEqual(bad_error, "Internal Server Error")
        self.assertFalse(bad_response["accepted"])
        self.assertEqual(bad_response["individualTransactionStatus"], "FAILED")

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


    def test_review_orders_newest_bulk_assignment_candidates_first(self):
        old_resource = self.add_resource("128.127.224.0/25", "Old Bulk Customer", "SVC-OLD")
        new_resource = self.add_resource("128.127.225.128/30", "Newest Bulk Customer", "SVC-NEW")
        with app.connect() as connection:
            connection.execute("UPDATE ip_resources SET created_at = '2026-07-01T00:00:00+00:00' WHERE resource_uuid = ?", (old_resource.resource_uuid,))
            connection.execute("UPDATE ip_resources SET created_at = '2026-08-06T11:02:59+00:00' WHERE resource_uuid = ?", (new_resource.resource_uuid,))
        review = app.review_cst_migration_jobs(app.CstMigrationReviewRequest(resource_scope="assigned", page=1, page_size=1))
        self.assertEqual(review.total, 2)
        self.assertEqual(review.items[0].resource_uuid, new_resource.resource_uuid)

    def test_queued_update_job_creates_transaction_ledger_entry(self):
        resource = self.add_resource("128.127.225.0/30")
        transaction_id = str(uuid4())
        resource = resource.model_copy(update={"transaction_id": transaction_id})
        with app.connect() as connection:
            jobs = app.create_cst_sync_jobs(connection, [(resource, "UPDATE")], "MANUAL_LIR_MIGRATION", queue_only=True)
            ledger = connection.execute(
                "SELECT * FROM cst_transaction_ledger WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
        self.assertEqual(len(jobs), 1)
        self.assertIsNotNone(ledger)
        self.assertEqual(ledger["last_status"], "PENDING")
        self.assertEqual(ledger["batch_id"], jobs[0].batch_id)

    def test_cst_transactions_backfills_and_orders_pending_jobs_first(self):
        old_resource = self.add_resource("128.127.225.0/30", "Old Customer", "SVC-OLD")
        new_resource = self.add_resource("128.127.226.0/30", "New Customer", "SVC-NEW")
        old_transaction_id = str(uuid4())
        new_transaction_id = str(uuid4())
        with app.connect() as connection:
            app.create_cst_sync_jobs(
                connection,
                [(old_resource.model_copy(update={"transaction_id": old_transaction_id}), "UPDATE")],
                "MANUAL_LIR_MIGRATION",
                queue_only=True,
            )
            app.create_cst_sync_jobs(
                connection,
                [(new_resource.model_copy(update={"transaction_id": new_transaction_id}), "UPDATE")],
                "MANUAL_LIR_MIGRATION",
                queue_only=True,
            )
            connection.execute("DELETE FROM cst_transaction_ledger WHERE transaction_id = ?", (new_transaction_id,))
            connection.execute("UPDATE cst_transaction_ledger SET last_status = 'SUCCESS' WHERE transaction_id = ?", (old_transaction_id,))
        transactions = app.list_cst_transactions()
        transaction_ids = [transaction.transaction_id for transaction in transactions]
        self.assertIn(new_transaction_id, transaction_ids)
        self.assertLess(transaction_ids.index(new_transaction_id), transaction_ids.index(old_transaction_id))

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

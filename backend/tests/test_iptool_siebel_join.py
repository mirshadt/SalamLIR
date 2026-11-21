import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "generate_assignment_bulk_from_iptool_siebel.py"
CITY_MAP = SCRIPT.parent / "cst_city_lookup.csv"

IPTOOL_HEADER = ["Ip Address", "Order Number", "Product Type", "ProductClass", "CustomerName", "CustomerNumber", "CustomerType", "Subnet Type", "Number of IpAddress", "Status", "Subnet Mask"]
SIEBEL_HEADER = ["SERIAL_NUM", "SID_STATUS", "PRODUCT_NAME", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "X_ITC_B2B_COMMERCIAL_REGIS_NUM", "CON_PHONE_NUM", "CON_EMAIL", "FST_NAME", "LAST_NAME", "CITY"]


def iptool_row(ip: str, order: str, account: str) -> list[str]:
    return [ip, order, "BDI", "BDI(1:1)", f"Customer {account}", account, "CORP", "LAN1", "4", "Reserved", "255.255.255.252"]


def siebel_row(serial: str, account: str, status: str = "Active", product: str = "BDI") -> list[str]:
    return [serial, status, product, account, f"Customer {account}", "1010123456", "0501234567", "noc@example.com", "Net", "Ops", "Riyadh"]


class IpToolSiebelJoinTest(unittest.TestCase):
    def run_script(self, iptool_rows: list[list[str]], siebel_rows: list[list[str]]) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
        work = Path(tempfile.mkdtemp())
        for name, header, rows in (("iptool.csv", IPTOOL_HEADER, iptool_rows), ("siebel.csv", SIEBEL_HEADER, siebel_rows)):
            with open(work / name, "w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(header)
                writer.writerows(rows)
        subprocess.run(
            [sys.executable, str(SCRIPT), "--iptool", str(work / "iptool.csv"), "--siebel", str(work / "siebel.csv"),
             "--city-map", str(CITY_MAP), "--output", str(work / "out.csv"), "--missing-output", str(work / "missing.csv"),
             "--duplicates-output", str(work / "dups.csv")],
            check=True, capture_output=True,
        )
        output = {row["cidr"]: row for row in csv.DictReader(open(work / "out.csv", encoding="utf-8-sig"))}
        missing = {row["Ip Address"]: row["missingReason"] for row in csv.DictReader(open(work / "missing.csv", encoding="utf-8-sig"))}
        return output, missing

    def test_order_number_matches_serial_without_product_prefix(self):
        output, _ = self.run_script([iptool_row("87.101.155.24", "1000010114916", "25716")], [siebel_row("BDI1000010114916", "25716")])
        self.assertEqual(output["87.101.155.24/30"]["serviceId"], "BDI1000010114916")
        self.assertEqual(output["87.101.155.24/30"]["organizationId"], "1010123456")

    def test_mangled_order_uses_only_active_service_of_account(self):
        output, _ = self.run_script(
            [iptool_row("10.0.0.0", "1.00001E+12", "100")],
            [siebel_row("BDI1000010000001", "100"), siebel_row("BDI1000010000001", "100", product="BDI Link"), siebel_row("BDI1000010000009", "100", status="Inactive")],
        )
        self.assertEqual(output["10.0.0.0/30"]["serviceId"], "BDI1000010000001")
        self.assertIn("only active Siebel service", output["10.0.0.0/30"]["notes"])

    def test_mangled_order_with_several_services_is_rejected(self):
        output, missing = self.run_script(
            [iptool_row("10.0.0.0", "1.00001E+12", "100")],
            [siebel_row("BDI1000010000001", "100"), siebel_row("BDI1000010000002", "100")],
        )
        self.assertEqual(output, {})
        self.assertIn("2 active Siebel services", missing["10.0.0.0"])
        self.assertIn("BDI1000010000001, BDI1000010000002", missing["10.0.0.0"])

    def test_real_order_not_in_siebel_keeps_order_number_as_service_id(self):
        output, _ = self.run_script(
            [iptool_row("10.0.0.4", "11218581", "100")],
            [siebel_row("BDI1000010000001", "100"), siebel_row("BDI1000010000002", "100")],
        )
        self.assertEqual(output["10.0.0.4/30"]["serviceId"], "11218581")
        self.assertEqual(output["10.0.0.4/30"]["organizationId"], "1010123456")

    def test_inactive_suffixed_serial_does_not_shadow_exact_match(self):
        output, _ = self.run_script(
            [iptool_row("5.132.248.0", "10819035", "41195")],
            [siebel_row("10819035-RMF", "41195", status="Inactive"), siebel_row("10819035", "41195")],
        )
        self.assertEqual(output["5.132.248.0/30"]["serviceId"], "10819035")


if __name__ == "__main__":
    unittest.main()

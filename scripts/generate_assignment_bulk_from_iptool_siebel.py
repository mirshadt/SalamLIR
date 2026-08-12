#!/usr/bin/env python3
"""
Generate Salam LIR bulk-assignment import CSV by joining IP Tool data with Siebel data.

Default join:
  1. IP Tool "Order Number" -> Siebel "SERIAL_NUM", when SERIAL_NUM exists
  2. IP Tool "CustomerNumber" -> Siebel "ACCOUNT_NUMBER", for the simplified Siebel template
  3. IP Tool "CustomerName" -> Siebel "ACCOUNT_NAME", for reduced IP Tool templates without IDs

Outputs:
  1. Salam LIR bulk assignment CSV
  2. Missing Siebel records CSV for IP Tool rows that could not be joined
  3. Duplicate Siebel join-key report CSV

The script uses only Python standard libraries.
"""
from __future__ import annotations

import argparse
import csv
import ipaddress
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable

BULK_COLUMNS = [
    "assignmentType",
    "cidr",
    "startIp",
    "endIp",
    "size",
    "status",
    "assignmentDate",
    "customerName",
    "organizationName",
    "organizationId",
    "commercialRegId",
    "unifiedNumber",
    "customerTypeId",
    "customerType",
    "subnetType",
    "productClass",
    "regionId",
    "cityId",
    "fullName",
    "mobileNumber",
    "idNumber",
    "email",
    "contactName",
    "contactNumber",
    "contactEmail",
    "customerId",
    "serviceId",
    "serviceDescription",
    "accessTechnologyId",
    "owner",
    "assignmentPurpose",
    "site",
    "city",
    "region",
    "notes",
]

def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(errors="replace")


def sniff_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample[:8192], delimiters=",\t;|")
    except csv.Error:
        class DefaultDialect(csv.excel):
            delimiter = "\t" if "\t" in sample.splitlines()[0] else ","
        return DefaultDialect


def read_table(path: Path) -> list[dict[str, str]]:
    text = read_text(path)
    if not text.strip():
        return []
    dialect = sniff_dialect(text)
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    return [{str(k or "").strip(): str(v or "").strip() for k, v in row.items()} for row in rows]


def normalized_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def row_get(row: dict[str, str], *names: str) -> str:
    direct = {key.strip().lower(): value for key, value in row.items()}
    normalized = {normalized_header(key): value for key, value in row.items()}
    for name in names:
        if name.strip().lower() in direct and direct[name.strip().lower()].strip():
            return direct[name.strip().lower()].strip()
        key = normalized_header(name)
        if key in normalized and normalized[key].strip():
            return normalized[key].strip()
    return ""


def normalize_join_key(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"\.0$", "", text)
    text = text.replace(",", "")
    return re.sub(r"[^A-Za-z0-9-]", "", text).upper()


def digits_only(value: str) -> str:
    text = str(value or "")
    if "e+" in text.lower() or "e" in text.lower():
        try:
            text = str(int(float(text)))
        except ValueError:
            pass
    return re.sub(r"\D", "", text)


def valid_10_digit(value: str) -> str:
    digits = digits_only(value)
    return digits if len(digits) == 10 else ""


def normalize_sa_phone(value: str, fallback: str = "0000000000") -> tuple[str, str]:
    raw = str(value or "").strip()
    if not raw:
        return fallback, "missing phone normalized to fallback"
    without_ext = re.split(r"(?i)\b(?:ext|ex|extension)\b|#", raw, maxsplit=1)[0]
    digits = digits_only(without_ext)
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("9660") and len(digits) == 13:
        digits = "966" + digits[4:]

    normalized = ""
    if digits.startswith("966") and len(digits) in {11, 12}:
        normalized = digits
    elif digits.startswith("05") and len(digits) == 10:
        normalized = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        normalized = "966" + digits
    elif digits.startswith("01") and len(digits) == 10:
        normalized = "966" + digits[1:]
    elif digits.startswith("1") and len(digits) == 9:
        normalized = "966" + digits

    if normalized:
        warning = ""
        if without_ext != raw:
            warning = f"phone extension removed from {raw}"
        return normalized, warning
    return fallback, f"invalid phone {raw!r} normalized to fallback"


def normalized_email(value: str) -> str:
    text = str(value or "").strip()
    return text if "@" in text else ""


def cidr_from_iptool(row: dict[str, str]) -> str:
    cidr = row_get(row, "CIDR", "cidr")
    if cidr:
        return str(ipaddress.ip_network(cidr.strip(), strict=False))
    ip_value = row_get(row, "Ip Address", "IP Address", "ip_address")
    mask = row_get(row, "Subnet Mask", "subnet_mask")
    if ip_value and mask:
        return str(ipaddress.ip_network(f"{ip_value}/{mask}", strict=False))
    raise ValueError("missing CIDR and Ip Address/Subnet Mask")


def network_size(cidr: str, row: dict[str, str]) -> str:
    size = digits_only(row_get(row, "Number of IpAddress", "size", "Total", "total"))
    if size:
        return size
    return str(ipaddress.ip_network(cidr, strict=False).num_addresses)



def normalize_lir_customer_type(value: str) -> str:
    normalized = normalized_header(value).upper()
    if not normalized:
        return "NA"
    if normalized in {"CORP", "CORPORATE", "BUSINESS", "B2B", "ENTERPRISE", "GOV", "GOVERNMENT", "GOVERNMENTAL"}:
        return "CORP"
    if normalized in {"RESI", "RES", "RESIDENTIAL", "INDIVIDUAL", "CONSUMER", "HOME", "PERSONAL"}:
        return "RESI"
    if normalized in {"COMP", "COMPANY"}:
        return "COMP"
    return normalized if normalized in {"CORP", "RESI", "COMP", "NA"} else "NA"


def normalize_lir_subnet_type(value: str) -> str:
    normalized = normalized_header(value).upper()
    if not normalized:
        return "NA"
    if normalized in {"NA", *{f"LAN{index}" for index in range(1, 9)}, *{f"PTP{index}" for index in range(1, 4)}}:
        return normalized
    lan_match = re.fullmatch(r"LAN0*([1-8])", normalized)
    if lan_match:
        return f"LAN{lan_match.group(1)}"
    ptp_match = re.fullmatch(r"PTP0*([1-3])", normalized)
    if ptp_match:
        return f"PTP{ptp_match.group(1)}"
    return "NA"

def location_from_iptool(row: dict[str, str]) -> tuple[str, str, str]:
    site = row_get(row, "ShipToAddress", "Ship To Address", "ship_to_address")
    city = row_get(row, "City", "city")
    region = row_get(row, "Region", "region")
    if site and (not city or not region):
        parts = [part.strip() for part in site.split(",") if part.strip()]
        if len(parts) >= 2 and not city:
            city = parts[-1]
        if len(parts) >= 3 and not region:
            region = parts[-2]
    return city, region, site


def customer_type_id_from_iptool(row: dict[str, str], default_customer_type_id: str) -> str:
    value = row_get(row, "CustomerType", "Customer Type", "customer_type")
    normalized = normalized_header(value)
    if normalized in {"gov", "government", "governmental"}:
        return "1"
    if normalized in {"corp", "corporate", "business", "b2b", "enterprise", "nongovernment", "private"}:
        return "2"
    return default_customer_type_id



def load_simple_map(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    mapping: dict[str, str] = {}
    for row in read_table(path):
        source = row_get(row, "source", "name", "value", "text", "region", "city")
        target = row_get(row, "id", "target", "cstId", "cst_id")
        if source and target:
            mapping[normalized_header(source)] = target
    return mapping


def map_lookup(mapping: dict[str, str], value: str) -> str:
    return mapping.get(normalized_header(value), "") if value else ""


CST_REGION_BY_NAME = {
    "riyadh": "1",
    "riyadhregion": "1",
    "qassim": "2",
    "makkah": "3",
    "makkahregion": "3",
    "almadinah": "4",
    "madinah": "4",
    "madinahregion": "4",
    "easternregion": "5",
    "easternprovince": "5",
    "aljouf": "6",
    "jouf": "6",
    "tabuk": "7",
    "northernborder": "8",
    "thenorthernborder": "8",
    "hail": "9",
    "asir": "10",
    "najran": "11",
    "baha": "12",
    "jazan": "13",
    "jizan": "13",
    "central": "14",
    "centralregion": "14",
    "western": "15",
    "westernregion": "15",
    "eastern": "16",
    "east": "16",
}

CST_CITY_BY_NAME = {
    "riyadh": "41",
    "alriyadh": "41",
    "makkah": "11",
    "mecca": "11",
    "jeddah": "65",
    "madinah": "54",
    "medina": "54",
    "almadinah": "54",
    "dammam": "61",
    "khobar": "95",
    "alkhobar": "95",
    "dhahran": "154",
    "aldhahran": "154",
    "jubail": "37",
    "aljubail": "37",
    "qatif": "70",
    "qateef": "70",
    "ahsa": "56",
    "alhasa": "56",
    "hasa": "56",
    "buraidah": "40",
    "buraydah": "40",
    "hail": "2",
    "haiel": "2",
    "khamismushait": "45",
    "khamiesmushait": "45",
    "najran": "78",
    "abha": "83",
    "tabuk": "16",
    "jazan": "20",
    "jizan": "20",
    "sakaka": "10",
    "arar": "112",
    "hafralbatin": "81",
    "yanbu": "6",
    "taif": "13",
    "taief": "13",
    "algurayat": "5",
    "alqurayat": "5",
    "qurayat": "5",
    "gurayat": "5",
}

CST_CITY_REGION_BY_ID = {
    "41": "1",
    "11": "3",
    "65": "3",
    "54": "4",
    "61": "5",
    "95": "5",
    "154": "10",
    "37": "5",
    "70": "5",
    "56": "5",
    "40": "2",
    "2": "9",
    "45": "10",
    "78": "11",
    "83": "10",
    "16": "7",
    "20": "13",
    "10": "6",
    "112": "8",
    "81": "5",
    "6": "4",
    "13": "3",
    "5": "6",
}


def lookup_builtin(mapping: dict[str, str], value: str) -> str:
    key = normalized_header(value)
    if not key:
        return ""
    if key.isdigit():
        return key
    return mapping.get(key, "")


def resolve_region_id(region_text: str, city_id: str, region_map: dict[str, str], default_region_id: str) -> str:
    return (
        map_lookup(region_map, region_text)
        or lookup_builtin(CST_REGION_BY_NAME, region_text)
        or CST_CITY_REGION_BY_ID.get(city_id, "")
        or default_region_id
    )


def resolve_city_id(city_text: str, city_map: dict[str, str], default_city_id: str) -> str:
    return map_lookup(city_map, city_text) or lookup_builtin(CST_CITY_BY_NAME, city_text) or default_city_id or "1"


def siebel_score(row: dict[str, str]) -> int:
    score = 0
    product = row_get(row, "PRODUCT_NAME")
    status = row_get(row, "SID_STATUS", "STATUS_CD")
    if status.lower() == "active":
        score += 20
    if product and "link" not in product.lower():
        score += 10
    if valid_10_digit(row_get(row, "X_ITC_B2B_COMMERCIAL_REGIS_NUM")):
        score += 5
    if valid_10_digit(row_get(row, "X_ITC_B2B_UNIFIED_NUMBER")):
        score += 5
    if normalized_email(row_get(row, "CON_EMAIL", "MAIN_EMAIL_ADDR")):
        score += 3
    return score


def build_siebel_index(rows: list[dict[str, str]], join_column: str) -> tuple[dict[str, dict[str, str]], dict[str, list[dict[str, str]]]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = normalize_join_key(row_get(row, join_column))
        if key:
            grouped[key].append(row)
    selected = {key: sorted(items, key=siebel_score, reverse=True)[0] for key, items in grouped.items()}
    duplicates = {key: items for key, items in grouped.items() if len(items) > 1}
    return selected, duplicates


def contact_name(siebel: dict[str, str]) -> str:
    parts = [row_get(siebel, "PER_TITLE"), row_get(siebel, "FST_NAME"), row_get(siebel, "LAST_NAME")]
    name = " ".join(part.strip() for part in parts if part and part.strip())
    return name or row_get(siebel, "X_ITC_B2B_AP_NAME")

def organization_identifier(siebel: dict[str, str], iptool: dict[str, str]) -> str:
    for value in (
        row_get(siebel, "X_ITC_B2B_COMMERCIAL_REGIS_NUM"),
        row_get(siebel, "X_ITC_B2B_UNIFIED_NUMBER"),
        row_get(siebel, "X_ITC_B2B_AP_IDENTITY_ID"),
        row_get(iptool, "CustomerNumber", "Customer Number"),
    ):
        valid = valid_10_digit(value)
        if valid:
            return valid
    return ""


def make_bulk_row(
    iptool: dict[str, str],
    siebel: dict[str, str],
    args: argparse.Namespace,
    region_map: dict[str, str],
    city_map: dict[str, str],
) -> dict[str, str]:
    cidr = cidr_from_iptool(iptool)
    iptool_city, iptool_region, iptool_site = location_from_iptool(iptool)

    customer_name = row_get(siebel, "ACCOUNT_NAME") or row_get(iptool, "CustomerName", "Customer Name") or "Business Customer"
    customer_id = row_get(siebel, "ACCOUNT_NUMBER") or row_get(iptool, "CustomerNumber", "Customer Number")
    org_id = organization_identifier(siebel, iptool) or customer_id
    commercial_reg = valid_10_digit(row_get(siebel, "X_ITC_B2B_COMMERCIAL_REGIS_NUM"))
    unified = valid_10_digit(row_get(siebel, "X_ITC_B2B_UNIFIED_NUMBER"))

    region_text = row_get(siebel, "ACCOUNT_REGION", "REGION", "Region") or iptool_region
    city_text = row_get(siebel, "CITY", "ACCOUNT_CITY", "City") or iptool_city
    city_id = resolve_city_id(city_text, city_map, args.city_id)
    region_id = resolve_region_id(region_text, city_id, region_map, args.region_id)

    phone_source = row_get(siebel, "CON_PHONE_NUM", "MAIN_PH_NUM") or row_get(iptool, "MobileNumber", "Mobile Number", "ContactNumber", "Contact Number")
    phone, _phone_warning = normalize_sa_phone(phone_source, args.invalid_phone_fallback)
    main_phone_source = row_get(siebel, "MAIN_PH_NUM", "CON_PHONE_NUM") or row_get(iptool, "ContactNumber", "Contact Number", "MobileNumber", "Mobile Number")
    main_phone, _main_phone_warning = normalize_sa_phone(main_phone_source, args.invalid_phone_fallback)

    email = (
        normalized_email(row_get(siebel, "CON_EMAIL"))
        or normalized_email(row_get(siebel, "MAIN_EMAIL_ADDR"))
        or normalized_email(row_get(iptool, "Email", "ContactEmail", "Contact Email"))
        or args.default_email
    )
    name = (
        contact_name(siebel)
        or row_get(iptool, "ContactName", "Contact Name", "FullName", "Full Name")
        or args.default_contact_name
        or customer_name
        or "Business Contact"
    )

    service_id = row_get(siebel, "SERIAL_NUM") or normalize_join_key(row_get(iptool, args.iptool_join_column))
    product_type = row_get(iptool, "Product Type", "ProductType", "product_type")
    product_class = row_get(iptool, "ProductClass", "Product Class", "product_class")
    service_description = row_get(siebel, "PRODUCT_NAME") or product_type or product_class
    site = row_get(siebel, "ADDR_NAME", "ADDRESS", "SITE") or iptool_site

    return {
        "assignmentType": "BUSINESS",
        "cidr": cidr,
        "startIp": "",
        "endIp": "",
        "size": network_size(cidr, iptool),
        "status": args.assignment_status,
        "assignmentDate": args.assignment_date,
        "customerName": customer_name,
        "organizationName": customer_name,
        "organizationId": org_id,
        "commercialRegId": commercial_reg,
        "unifiedNumber": unified,
        "customerTypeId": customer_type_id_from_iptool(iptool, args.customer_type_id),
        "customerType": normalize_lir_customer_type(row_get(iptool, "CustomerType", "Customer Type", "customer_type")),
        "subnetType": normalize_lir_subnet_type(row_get(iptool, "Subnet Type", "SubnetType", "subnet_type")),
        "productClass": product_class,
        "regionId": region_id,
        "cityId": city_id,
        "fullName": name,
        "mobileNumber": phone,
        "idNumber": digits_only(row_get(siebel, "CONTACT_ID_NUM")) or args.default_id_number,
        "email": email,
        "contactName": name,
        "contactNumber": main_phone or phone,
        "contactEmail": email,
        "customerId": customer_id,
        "serviceId": service_id,
        "serviceDescription": service_description,
        "accessTechnologyId": args.access_technology_id,
        "owner": "Business Customer",
        "assignmentPurpose": service_description or product_class,
        "site": site,
        "city": city_text,
        "region": region_text,
        "notes": "Assigned to Business",
    }

def write_csv(path: Path, rows: Iterable[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Join IP Tool and Siebel exports into Salam LIR bulk assignment CSV.")
    parser.add_argument("--iptool", required=True, type=Path, help="IP Tool CSV/TSV export path")
    parser.add_argument("--siebel", required=True, type=Path, help="Siebel CSV/TSV export path")
    parser.add_argument("--output", type=Path, default=Path("bulk_assignments_from_iptool_siebel.csv"))
    parser.add_argument("--missing-output", type=Path, default=Path("missing_siebel_records.csv"))
    parser.add_argument("--duplicates-output", type=Path, default=Path("duplicate_siebel_join_keys.csv"))
    parser.add_argument("--join-mode", choices=["auto", "service", "account", "customer"], default="auto", help="auto tries service join first, then account, then customer name. customer supports reduced IP Tool templates without IDs.")
    parser.add_argument("--iptool-join-column", default="Order Number", help="IP Tool service/order join column used for service join")
    parser.add_argument("--siebel-join-column", default="SERIAL_NUM", help="Siebel service join column used when available")
    parser.add_argument("--iptool-account-column", default="CustomerNumber", help="IP Tool account/customer join column used for simplified Siebel exports")
    parser.add_argument("--siebel-account-column", default="ACCOUNT_NUMBER", help="Siebel account join column used for simplified Siebel exports")
    parser.add_argument("--iptool-customer-column", default="CustomerName", help="IP Tool customer-name join column used for reduced IP Tool exports")
    parser.add_argument("--siebel-customer-column", default="ACCOUNT_NAME", help="Siebel customer-name join column used for reduced IP Tool exports")
    parser.add_argument("--assignment-date", default=date.today().isoformat())
    parser.add_argument("--assignment-status", default="3", help="CST LIRAssignmentStatusId. Default 3 Business")
    parser.add_argument("--customer-type-id", default="2")
    parser.add_argument("--region-id", default="", help="Default CST regionId if no region map match")
    parser.add_argument("--city-id", default="1", help="Default CST cityId if no city map match. Default 1.")
    parser.add_argument("--region-map", type=Path, help="Optional CSV map with source,id columns")
    parser.add_argument("--city-map", type=Path, help="Optional CSV map with source,id columns")
    parser.add_argument("--access-technology-id", default="1")
    parser.add_argument("--default-id-number", default="0000000000")
    parser.add_argument("--default-contact-name", default="Business Contact", help="Fallback contact name when neither Siebel nor IP Tool has a contact name")
    parser.add_argument("--default-email", default="", help="Fallback contact email when neither Siebel nor IP Tool has an email")
    parser.add_argument("--invalid-phone-fallback", default="0000000000")
    parser.add_argument("--include-non-public", action="store_true", help="Include IP Tool rows where PublicIP is not Yes")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    iptool_rows = read_table(args.iptool)
    siebel_rows = read_table(args.siebel)
    region_map = load_simple_map(args.region_map)
    city_map = load_simple_map(args.city_map)
    service_by_key, duplicate_service = build_siebel_index(siebel_rows, args.siebel_join_column)
    account_by_key, duplicate_account = build_siebel_index(siebel_rows, args.siebel_account_column)
    customer_by_key, duplicate_customer = build_siebel_index(siebel_rows, args.siebel_customer_column)

    output_rows: list[dict[str, str]] = []
    missing_rows: list[dict[str, str]] = []
    errors: list[str] = []

    for index, iptool in enumerate(iptool_rows, start=2):
        public_value = row_get(iptool, "PublicIP", "Public IP")
        if public_value and public_value.strip().lower() not in {"yes", "y", "true", "1"} and not args.include_non_public:
            continue
        service_key = normalize_join_key(row_get(iptool, args.iptool_join_column))
        account_key = normalize_join_key(row_get(iptool, args.iptool_account_column, "Customer Number", "CustomerNumber"))
        customer_key = normalize_join_key(row_get(iptool, args.iptool_customer_column, "Customer Name", "CustomerName"))
        siebel = None
        join_type = ""
        join_key = ""
        if args.join_mode in {"auto", "service"} and service_key:
            siebel = service_by_key.get(service_key)
            if siebel:
                join_type = "service"
                join_key = service_key
        if siebel is None and args.join_mode in {"auto", "account"} and account_key:
            siebel = account_by_key.get(account_key)
            if siebel:
                join_type = "account"
                join_key = account_key
        if siebel is None and args.join_mode in {"auto", "customer"} and customer_key:
            siebel = customer_by_key.get(customer_key)
            if siebel:
                join_type = "customer"
                join_key = customer_key
        if not siebel:
            missing = dict(iptool)
            missing["normalizedServiceJoinKey"] = service_key
            missing["normalizedAccountJoinKey"] = account_key
            missing["normalizedCustomerJoinKey"] = customer_key
            missing["missingReason"] = (
                f"No Siebel row found. Tried {args.iptool_join_column}->{args.siebel_join_column}={service_key or '<blank>'}, "
                f"{args.iptool_account_column}->{args.siebel_account_column}={account_key or '<blank>'}, "
                f"and {args.iptool_customer_column}->{args.siebel_customer_column}={customer_key or '<blank>'}."
            )
            missing_rows.append(missing)
            continue
        try:
            output = make_bulk_row(iptool, siebel, args, region_map, city_map)
            output_rows.append(output)
        except Exception as exc:
            missing = dict(iptool)
            missing["normalizedServiceJoinKey"] = service_key
            missing["normalizedAccountJoinKey"] = account_key
            missing["normalizedCustomerJoinKey"] = customer_key
            missing["matchedJoinType"] = join_type
            missing["matchedJoinKey"] = join_key
            missing["missingReason"] = f"Matched Siebel but failed to build output row: {exc}"
            missing_rows.append(missing)
            errors.append(f"IP Tool row {index}, {join_type} key {join_key}: {exc}")

    write_csv(args.output, output_rows, BULK_COLUMNS)
    missing_headers = sorted({key for row in missing_rows for key in row.keys()}) or ["normalizedServiceJoinKey", "normalizedAccountJoinKey", "normalizedCustomerJoinKey", "missingReason"]
    write_csv(args.missing_output, missing_rows, missing_headers)

    duplicate_rows: list[dict[str, str]] = []
    for join_type, duplicates, selected_index in (
        ("service", duplicate_service, service_by_key),
        ("account", duplicate_account, account_by_key),
        ("customer", duplicate_customer, customer_by_key),
    ):
        for key, rows in duplicates.items():
            selected = selected_index[key]
            selected_row_id = row_get(selected, "ROW_ID")
            for row_number, row in enumerate(rows, start=1):
                selected_marker = "yes" if selected_row_id and row_get(row, "ROW_ID") == selected_row_id else "yes" if not selected_row_id and row is selected else "no"
                duplicate_rows.append({
                    "joinType": join_type,
                    "normalizedJoinKey": key,
                    "selected": selected_marker,
                    "score": str(siebel_score(row)),
                    "duplicateRowNumber": str(row_number),
                    "SERIAL_NUM": row_get(row, "SERIAL_NUM"),
                    "ROW_ID": row_get(row, "ROW_ID"),
                    "PRODUCT_NAME": row_get(row, "PRODUCT_NAME"),
                    "SID_STATUS": row_get(row, "SID_STATUS", "STATUS_CD"),
                    "ACCOUNT_NAME": row_get(row, "ACCOUNT_NAME"),
                    "ACCOUNT_NUMBER": row_get(row, "ACCOUNT_NUMBER"),
                })
    write_csv(args.duplicates_output, duplicate_rows, [
        "joinType", "normalizedJoinKey", "selected", "score", "duplicateRowNumber", "SERIAL_NUM", "ROW_ID", "PRODUCT_NAME", "SID_STATUS", "ACCOUNT_NAME", "ACCOUNT_NUMBER"
    ])

    print(f"IP Tool rows read: {len(iptool_rows)}")
    print(f"Siebel rows read: {len(siebel_rows)}")
    print(f"Bulk assignment rows written: {len(output_rows)} -> {args.output}")
    print(f"Missing/error rows written: {len(missing_rows)} -> {args.missing_output}")
    print(f"Duplicate Siebel key rows written: {len(duplicate_rows)} -> {args.duplicates_output}")
    if errors:
        print("Build warnings/errors:")
        for error in errors[:20]:
            print(f"- {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

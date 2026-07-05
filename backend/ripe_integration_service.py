from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from ipaddress import IPv4Address, summarize_address_range
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class RipeApiConfig:
    base_url: str
    username: str = ""
    password: str = ""
    read_timeout: int = 30
    default_maintainer: str = "ITC-NOC-MNT"


@dataclass(frozen=True)
class RipeApiResult:
    success: bool
    status_code: int
    message: str
    response_body: str
    request_object: dict[str, Any]


def _base_url(config: RipeApiConfig) -> str:
    return str(config.base_url or "https://rest.db.ripe.net").rstrip("/")


def _timeout(config: RipeApiConfig) -> int:
    try:
        return max(1, int(config.read_timeout))
    except (TypeError, ValueError):
        return 30


def _add_auth(request: Request, config: RipeApiConfig) -> None:
    if not config.username or not config.password:
        return
    token = base64.b64encode(f"{config.username}:{config.password}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {token}")


def _request_json(url: str, config: RipeApiConfig) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json"})
    _add_auth(request, config)
    with urlopen(request, timeout=_timeout(config)) as response:
        return json.loads(response.read().decode("utf-8"))


def attributes_by_name(ripe_object: dict[str, Any]) -> dict[str, str]:
    attributes = ripe_object.get("attributes", {}).get("attribute", [])
    values: dict[str, str] = {}
    for attribute in attributes:
        name = str(attribute.get("name", ""))
        value = str(attribute.get("value", ""))
        if not name:
            continue
        if name in values and value:
            values[name] = f"{values[name]} | {value}"
        else:
            values[name] = value
    return values


def cidrs_for_inetnum(value: str) -> str:
    parsed = inetnum_range(value)
    if parsed is None:
        return ""
    start_ip, end_ip = parsed
    return ", ".join(str(network) for network in summarize_address_range(start_ip, end_ip))


def inetnum_range(value: str) -> tuple[IPv4Address, IPv4Address] | None:
    if " - " not in value:
        return None
    start_value, end_value = value.split(" - ", 1)
    try:
        return IPv4Address(start_value.strip()), IPv4Address(end_value.strip())
    except ValueError:
        return None


def inetnum_in_range(value: str, start_value: str, end_value: str) -> bool:
    parsed = inetnum_range(value)
    if parsed is None:
        return False
    start_ip, end_ip = parsed
    try:
        parent_start = IPv4Address(start_value)
        parent_end = IPv4Address(end_value)
    except ValueError:
        return False
    return int(parent_start) <= int(start_ip) and int(end_ip) <= int(parent_end)


def cidr_for_root_range(start_ip: IPv4Address, end_ip: IPv4Address) -> str:
    networks = list(summarize_address_range(start_ip, end_ip))
    return str(networks[0]) if len(networks) == 1 else ", ".join(str(network) for network in networks)


def cidr_parts(value: str) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def objects_to_rows(objects: list[dict[str, Any]]) -> list[dict[str, str | int]]:
    rows: list[dict[str, str | int]] = []
    for ripe_object in objects:
        values = attributes_by_name(ripe_object)
        inetnum = values.get("inetnum", "")
        rows.append(
            {
                "cidr": cidrs_for_inetnum(inetnum),
                "object_type": str(ripe_object.get("type", "inetnum")),
                "object_source": str(ripe_object.get("source", {}).get("id", "ripe")),
                "object_href": str(ripe_object.get("link", {}).get("href", "")),
                **values,
            }
        )
    return rows


def query_objects_by_inverse(config: RipeApiConfig, inverse_attribute: str, maintainer: str, include_no_referenced: bool = True) -> tuple[list[dict[str, Any]], str]:
    query_params: dict[str, str] = {
        "source": "ripe",
        "type-filter": "inetnum",
        "inverse-attribute": inverse_attribute,
        "query-string": maintainer,
    }
    if include_no_referenced:
        query_params["flags"] = "no-referenced"
    url = f"{_base_url(config)}/search.json?{urlencode(query_params)}"
    try:
        payload = _request_json(url, config)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"{inverse_attribute} query failed: {exc}"
    objects = payload.get("objects", {}).get("object", [])
    return objects, f"{inverse_attribute} query returned {len(objects)} inetnum objects"


def query_inetnum_rows_for_range(config: RipeApiConfig, start_ip: str, end_ip: str) -> tuple[list[dict[str, str | int]], str]:
    query = urlencode(
        {
            "source": "ripe",
            "type-filter": "inetnum",
            "flags": ["M", "no-referenced"],
            "query-string": f"{start_ip} - {end_ip}",
        },
        doseq=True,
    )
    url = f"{_base_url(config)}/search.json?{query}"
    try:
        payload = _request_json(url, config)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"RIPE Database query did not complete: {exc}"
    rows = objects_to_rows(payload.get("objects", {}).get("object", []))
    return rows, f"Retrieved {len(rows)} RIPE inetnum rows from {_base_url(config)} for {start_ip} - {end_ip}."


def query_mnt_lower_rows_in_range(config: RipeApiConfig, start_ip: str, end_ip: str) -> tuple[list[dict[str, str | int]], str]:
    maintainer = config.default_maintainer or "ITC-NOC-MNT"
    query = urlencode(
        {
            "source": "ripe",
            "type-filter": "inetnum",
            "inverse-attribute": "mnt-lower",
            "query-string": maintainer,
        }
    )
    url = f"{_base_url(config)}/search.json?{query}"
    try:
        payload = _request_json(url, config)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"RIPE Database mnt-lower query did not complete: {exc}"
    all_rows = objects_to_rows(payload.get("objects", {}).get("object", []))
    rows = [row for row in all_rows if inetnum_in_range(str(row.get("inetnum", "")), start_ip, end_ip)]
    return rows, f"Retrieved {len(rows)} of {len(all_rows)} RIPE inetnum rows for mnt-lower {maintainer} within {start_ip} - {end_ip}."


def inetnum_classification(status: str) -> str:
    normalized = str(status or "").strip().upper()
    return "ASSIGNMENT" if normalized.startswith("ASSIGNED") else "ALLOCATION"


def query_assignment_rows_by_maintainer(config: RipeApiConfig) -> tuple[list[dict[str, str | int]], str]:
    maintainer = config.default_maintainer or "ITC-NOC-MNT"
    ripe_objects, message = query_objects_by_inverse(config, "mnt-by", maintainer)
    source_rows = objects_to_rows(ripe_objects)
    assignment_rows: list[dict[str, str | int]] = []
    for row in source_rows:
        classification = inetnum_classification(str(row.get("status", "")))
        if classification != "ASSIGNMENT":
            continue
        row["classification"] = classification
        row["matched_inverse_attributes"] = "mnt-by"
        assignment_rows.append(row)

    def row_start(item: dict[str, str | int]) -> int:
        parsed = inetnum_range(str(item.get("inetnum", "")))
        return int(parsed[0]) if parsed else 0

    assignment_rows.sort(key=row_start)
    return (
        assignment_rows,
        f"Retrieved {len(assignment_rows)} RIPE inetnum assignment rows for maintainer {maintainer} using inverse-attribute=mnt-by. Source rows scanned: {len(source_rows)}. {message}",
    )


def netname_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_]+", "_", str(value or "").strip().upper())
    token = re.sub(r"_+", "_", token).strip("_")
    return token or "LIR_ASSIGNMENT"


def assignment_description(assignment: dict[str, Any]) -> str:
    target_type = str(assignment.get("assignment_target_type", "") or "").lower()
    if "customer" in target_type:
        return "Assigned to Customer"
    return (
        str(assignment.get("assignment_description", "") or "").strip()
        or str(assignment.get("service_description", "") or "").strip()
        or "Assigned to Customer"
    )


def assignment_object(assignment: dict[str, Any], maintainer: str) -> dict[str, Any]:
    organization_name = assignment.get("organization_name") or assignment.get("customer_name") or assignment.get("assignment_name") or assignment.get("cidr")
    ripe_name = netname_token(str(organization_name or ""))
    return {
        "objects": {
            "object": [
                {
                    "type": "inetnum",
                    "attributes": {
                        "attribute": [
                            {"name": "inetnum", "value": f"{assignment.get('start')} - {assignment.get('end')}"},
                            {"name": "netname", "value": ripe_name},
                            {"name": "descr", "value": assignment_description(assignment)},
                            {"name": "country", "value": "SA"},
                            {"name": "admin-c", "value": "IR1052-RIPE"},
                            {"name": "tech-c", "value": "IR1052-RIPE"},
                            {"name": "status", "value": "ASSIGNED PA"},
                            {"name": "mnt-by", "value": maintainer or "ITC-NOC-MNT"},
                            {"name": "source", "value": "RIPE"},
                        ]
                    },
                }
            ]
        }
    }


def post_assignment(config: RipeApiConfig, assignment: dict[str, Any]) -> RipeApiResult:
    request_object = assignment_object(assignment, config.default_maintainer or "ITC-NOC-MNT")
    if not config.username or not config.password:
        return RipeApiResult(False, 0, "RIPE username/password is not configured", "", request_object)
    request = Request(
        f"{_base_url(config)}/ripe/inetnum",
        data=json.dumps(request_object).encode("utf-8"),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    _add_auth(request, config)
    try:
        with urlopen(request, timeout=_timeout(config)) as response:
            body = response.read().decode("utf-8", errors="replace")
            status_code = int(response.status)
            return RipeApiResult(200 <= status_code < 300, status_code, "RIPE assignment object created", body, request_object)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return RipeApiResult(False, int(exc.code), f"RIPE push failed with HTTP {exc.code}", body, request_object)
    except (URLError, TimeoutError, ValueError) as exc:
        return RipeApiResult(False, 0, f"RIPE push failed: {exc}", "", request_object)


def delete_assignment(config: RipeApiConfig, start_ip: str, end_ip: str) -> RipeApiResult:
    inetnum = f"{start_ip} - {end_ip}"
    delete_url = f"{_base_url(config)}/ripe/inetnum/{quote(inetnum, safe='')}"
    request_object = {"method": "DELETE", "url": delete_url, "inetnum": inetnum}
    if not config.username or not config.password:
        return RipeApiResult(False, 0, "RIPE username/password is not configured", "", request_object)
    request = Request(delete_url, method="DELETE", headers={"Accept": "application/json"})
    _add_auth(request, config)
    try:
        with urlopen(request, timeout=_timeout(config)) as response:
            body = response.read().decode("utf-8", errors="replace")
            status_code = int(response.status)
            return RipeApiResult(200 <= status_code < 300, status_code, "RIPE assignment object removed", body, request_object)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return RipeApiResult(False, int(exc.code), f"RIPE removal failed with HTTP {exc.code}", body, request_object)
    except (URLError, TimeoutError, ValueError) as exc:
        return RipeApiResult(False, 0, f"RIPE removal failed: {exc}", "", request_object)
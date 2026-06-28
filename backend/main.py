from datetime import datetime, time as datetime_time, timedelta, timezone
import base64
import csv
import hashlib
import hmac
import json
from io import StringIO
from ipaddress import IPv4Address, IPv4Network, ip_network, summarize_address_range
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.ipam_core_services.audit_service import AuditContext, AuditService


DB_PATH = Path(__file__).with_name("ipam.db")
PUBLIC_FAVICON_PATH = Path(__file__).resolve().parent.parent / "public" / "favicon.png"
DB_BUSY_TIMEOUT_MS = 30_000
DB_WRITE_LOCK = threading.RLock()
CST_SCHEDULER_LOCK = threading.Lock()
CST_SCHEDULER_STARTED = False
DEFAULT_SERVICE_PROVIDER_ID = "5"
DEFAULT_SERVICE_PROVIDER_NAME = "Salam"
DEFAULT_ASN = "AS35753"
AUDIT_SERVICE = AuditService(lambda: now_iso())

app = FastAPI(title="NetAtlas IPAM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PoolCreate(BaseModel):
    cidr: str = Field(..., examples=["10.0.0.0/8"])
    name: str = "Imported allocation"
    region: str = "Unassigned region"
    description: str = ""
    category: str = "IP Subnet"
    lifecycle_state: str = "Active"
    resource_status: str = "Available"
    operational_state: str = "Enabled"
    administrative_state: str = "Unlocked"
    usage_state: str = "Idle"
    resource_specification_id: str = "RS-IP-SUBNET"
    resource_specification_name: str = "IPv4 Subnet Logical Resource"
    resource_type: str = "LogicalResource.IPSubnet"
    resource_role: str = "ParentPool"
    address_family: str = "IPv4"
    ip_version: str = "4"
    parent_resource_id: str = ""
    parent_cidr: str = ""
    allocation_policy: str = "Boundary partitioning"
    reservation_policy: str = "Manual approval"
    vrf_name: str = ""
    route_distinguisher: str = ""
    route_target: str = ""
    vlan_id: str = ""
    asn: str = ""
    site_id: str = ""
    site_name: str = ""
    location_name: str = ""
    owner: str = "IPAM"
    cost_center: str = ""
    security_zone: str = ""
    provider: str = ""
    source_system: str = "NetAtlas IPAM"
    external_id: str = ""
    href: str = ""
    version: str = "1.0"
    start_date: str = ""
    end_date: str = ""
    last_audit_at: str = ""
    tags: str = ""


class Pool(PoolCreate):
    id: str
    cidr: str
    prefix: int
    size: int
    start: str
    end: str
    source: str = "API"
    created_at: str


class PoolUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    region: str | None = None
    lifecycle_state: str | None = None
    resource_status: str | None = None
    owner: str | None = None
    cost_center: str | None = None
    security_zone: str | None = None
    tags: str | None = None


class AssignmentCreate(BaseModel):
    cidr: str = Field(..., examples=["10.24.16.0/24"])
    assignment_status_id: int = 3
    service_provider_id: str = DEFAULT_SERVICE_PROVIDER_ID
    service_provider_name: str = DEFAULT_SERVICE_PROVIDER_NAME
    action_flag: str = "N"
    cst_sync_status: str = "PENDING"
    ripe_sync_status: str = "PENDING"
    assignment_target_type: str = "business_customer"
    assignment_name: str = ""
    assignment_description: str = ""
    resource_relationship_type: str = "ResourceAssignment"
    logical_resource_id: str = ""
    resource_specification_id: str = "RS-IP-SUBNET"
    resource_specification_name: str = "IPv4 Subnet Logical Resource"
    resource_type: str = "LogicalResource.IPSubnet"
    resource_category: str = "IP Subnet"
    resource_role: str = "AssignedSubnet"
    resource_lifecycle_state: str = "Active"
    resource_usage_state: str = "Allocated"
    resource_operational_state: str = "Enabled"
    resource_administrative_state: str = "Unlocked"
    service_specification_id: str = ""
    service_specification_name: str = "L3 Connectivity Service"
    service_specification_type: str = "CustomerFacingServiceSpecification"
    service_instance_id: str = ""
    service_id: str = ""
    service_instance_name: str = ""
    service_type: str = "CustomerFacingService"
    service_category: str = "L3 Service"
    service_order_id: str = ""
    service_characteristics: str = ""
    product_specification_id: str = ""
    product_specification_name: str = ""
    product_offering_id: str = ""
    product_offering_name: str = ""
    product_instance_id: str = ""
    customer_id: str = ""
    customer_name: str
    customer_type: str = "Enterprise"
    organization_name: str = ""
    organization_id: str = ""
    customer_type_id: str = ""
    region_id: str = ""
    city_id: str = ""
    full_name: str = ""
    mobile_number: str = ""
    id_number: str = ""
    email: str = ""
    customer_account_id: str = ""
    customer_segment: str = "Enterprise"
    commercial_reg_id: str
    unified_number: str
    contact_number: str
    contact_email: str = ""
    city: str
    region: str
    contact_name: str
    internal_consumer_type: str = ""
    internal_business_unit: str = ""
    internal_application_id: str = ""
    internal_application_name: str = ""
    internal_environment: str = ""
    internal_owner_team: str = ""
    internal_cost_center: str = ""
    internal_project_code: str = ""
    internal_change_request_id: str = ""
    internal_justification: str = ""
    l3_service: str = "MPLS L3VPN"
    service: str = "L3 service allocation"
    owner: str = "Network service desk"
    site: str = "Unassigned site"
    site_id: str = ""
    location_name: str = ""
    latitude: str = ""
    longitude: str = ""
    vrf_name: str = ""
    vlan_id: str = ""
    asn: str = ""
    routing_domain: str = ""
    route_distinguisher: str = ""
    route_target: str = ""
    network_slice: str = ""
    security_zone: str = ""
    gateway_ip: str = ""
    dns_profile: str = ""
    dhcp_scope: str = ""
    nat_policy: str = ""
    qos_profile: str = ""
    access_technology_id: str = ""
    access_technology: str = ""
    service_description: str = ""
    requested_by: str = ""
    approved_by: str = ""
    approval_reference: str = ""
    reserved_until: str = ""
    assignment_purpose: str = ""
    environment: str = "Production"
    status: str = "Planned"
    assignment_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())
    notes: str = ""


class Assignment(AssignmentCreate):
    id: str
    cidr: str
    prefix: int
    size: int
    start: str
    end: str
    first_usable: str
    last_usable: str
    created_at: str


class PartitionRequest(BaseModel):
    pool_id: str | None = None
    cidr: str | None = None
    target_prefix: int
    direction: str = Field("start", examples=["start"])


class JoinRequest(BaseModel):
    left_pool_id: str | None = None
    right_pool_id: str | None = None
    left_cidr: str | None = None
    right_cidr: str | None = None


class Conflict(BaseModel):
    severity: str
    title: str
    detail: str
    ranges: list[str]


class StatusUpdate(BaseModel):
    status: str = Field(..., examples=["Quarantined"])


class PoolRange(BaseModel):
    cidr: str
    kind: str
    size: int
    start: str
    end: str
    status: str | None = None
    assignment_id: str | None = None
    customer_name: str | None = None
    l3_service: str | None = None
    assignment_date: str | None = None


class PoolRanges(BaseModel):
    pool: Pool
    assigned: list[PoolRange]
    unassigned: list[PoolRange]


class ContinuousRange(BaseModel):
    start: str | None = None
    end: str | None = None
    size: int = 0
    label: str = "No remaining free pool"
    resource_uuid: str | None = None


class PartitionResult(BaseModel):
    allocated: Assignment
    remaining: ContinuousRange
    message: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "operator"


class PasswordUpdate(BaseModel):
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    status: str
    created_at: str


class AuditEvent(BaseModel):
    id: str
    user: str
    timestamp: str
    action: str
    entity_type: str
    entity_id: str
    old_value: str = ""
    new_value: str = ""
    source_system: str = "ipam-core-services"
    request_id: str = ""


class BulkCsvRequest(BaseModel):
    csv_text: str
    file_name: str = ""


class BulkOutputRow(BaseModel):
    inputRowNumber: int
    processingStatus: str
    processingMessage: str
    generatedResourceUuid: str = ""
    generatedVersionUuid: str = ""
    generatedCidr: str = ""
    generatedSize: int = 0
    status: str = ""
    assignmentDate: str = ""
    customerName: str = ""


class BulkImportResult(BaseModel):
    imported: int
    blocked: int
    errors: list[str]
    output_rows: list[BulkOutputRow] = []


class BulkBatch(BaseModel):
    id: str
    operation_type: str
    status: str
    file_name: str = ""
    total_rows: int = 0
    success_count: int = 0
    failure_count: int = 0
    imported_count: int = 0
    blocked_count: int = 0
    started_at: str
    completed_at: str = ""
    duration_ms: int = 0
    error_summary: str = ""
    result_json: str = ""
    created_by: str = "ipam-admin"


class RipeConfigUpdate(BaseModel):
    base_url: str = "https://rest.db.ripe.net"
    auth_type: str = "Basic Authentication"
    username: str = ""
    password: str = ""
    connection_timeout: int = 10
    read_timeout: int = 30
    default_maintainer: str = "ITC-NOC-MNT"


class RipeConfigOut(BaseModel):
    base_url: str
    auth_type: str
    username: str
    password_configured: bool
    connection_timeout: int
    read_timeout: int
    default_maintainer: str
    updated_at: str


class RipeAllocatedPool(BaseModel):
    id: str
    pool_name: str
    cidr: str
    start_ip: str
    end_ip: str
    allocation_type: str = "RIPE Allocated Pool"
    source: str = "RIPE Database"
    created_date: str
    created_at: str


class RipeAllocatedPoolCreate(BaseModel):
    pool_name: str
    cidr: str
    start_ip: str = ""
    end_ip: str = ""
    allocation_type: str = "RIPE Allocated Pool"
    source: str = "RIPE Database"
    created_date: str = ""


class RipeAllocatedPoolBulkRequest(BaseModel):
    csv_text: str
    file_name: str = ""


class RipeAllocatedPoolBulkResult(BaseModel):
    imported: int
    blocked: int
    errors: list[str]
    pools: list[RipeAllocatedPool] = []


class RipeReportRequest(BaseModel):
    date_from: str = ""
    date_to: str = ""
    report_type: str = "RIPE Assignment Report"


class RipeReportResponse(BaseModel):
    pool: RipeAllocatedPool | None = None
    report_type: str
    date_from: str = ""
    date_to: str = ""
    maintainer: str = ""
    rows: list[dict[str, str | int]] = []
    message: str = ""


class RipeDiscoveredRootPool(BaseModel):
    pool_name: str
    allocation_range: str
    cidr: str
    total_ips: int
    start_ip: str
    end_ip: str
    ripe_maintainer: str
    ripe_status: str = ""
    source: str = "RIPE Database"
    local_sync_status: str
    cst_sync_status: str = "Not Synced"
    last_sync_date: str = ""
    object_href: str = ""


class RipeDiscoveryResponse(BaseModel):
    maintainer: str
    rows: list[RipeDiscoveredRootPool]
    message: str = ""


class RipeDiscoverySyncRequest(BaseModel):
    pool_name: str
    allocation_range: str = ""
    cidr: str
    start_ip: str
    end_ip: str
    ripe_maintainer: str
    ripe_status: str = ""
    object_href: str = ""


class RipePushResponse(BaseModel):
    success: bool
    status_code: int = 0
    assignment_id: str
    cidr: str
    ripe_sync_status: str
    message: str
    request_object: dict
    response_body: str = ""


class ResourceRecord(BaseModel):
    resource_uuid: str
    version_uuid: str
    parent_resource_uuid: str = ""
    parent_version_uuid: str = ""
    transaction_id: str = ""
    cidr: str
    prefix: int
    start_ip: str
    end_ip: str
    size: int
    ip_version: int = 1
    ownership_type: str
    status: str
    cidr_role: str = "SUBNET"
    service_provider_id: str = DEFAULT_SERVICE_PROVIDER_ID
    service_provider_name: str = DEFAULT_SERVICE_PROVIDER_NAME
    asn: str = DEFAULT_ASN
    assignment_status_id: int = 1
    service_id: str = ""
    organization_name: str = ""
    organization_id: str = ""
    customer_type_id: str = ""
    region_id: str = ""
    city_id: str = ""
    full_name: str = ""
    mobile_number: str = ""
    id_number: str = ""
    email: str = ""
    customer_name: str = ""
    assignment_date: str = ""
    update_date: str = ""
    access_technology_id: str = ""
    access_technology: str = ""
    service_description: str = ""
    description: str = ""
    action_flag: str = "N"
    cst_sync_status: str = "PENDING"
    ripe_sync_status: str = "PENDING"
    ip_type: str = "PUBLIC"
    root_pool_uuid: str = ""
    source_entity_type: str = ""
    source_entity_id: str = ""
    created_at: str
    updated_at: str


class AssignmentDetailRecord(BaseModel):
    id: str
    resource_uuid: str
    version_uuid: str
    assignment_type: str
    assignment_status_id: int = 3
    assignment_date: str
    service_id: str = ""
    customer_name: str = ""
    organization_name: str = ""
    organization_id: str = ""
    customer_type_id: str = ""
    region_id: str = ""
    city_id: str = ""
    full_name: str = ""
    mobile_number: str = ""
    id_number: str = ""
    email: str = ""
    commercial_reg_id: str = ""
    unified_number: str = ""
    contact_number: str = ""
    contact_email: str = ""
    city: str = ""
    region: str = ""
    contact_name: str = ""
    service_instance_id: str = ""
    service_instance_name: str = ""
    service_type: str = ""
    service_category: str = ""
    l3_service: str = ""
    service: str = ""
    access_technology_id: str = ""
    access_technology: str = ""
    service_description: str = ""
    owner: str = ""
    purpose: str = ""
    created_at: str
    updated_at: str



class CstConfig(BaseModel):
    id: str = "default"
    enabled: bool = True
    service_provider_id: str = DEFAULT_SERVICE_PROVIDER_ID
    auto_execute: bool = True
    scheduled_sync_enabled: bool = True
    schedule_time: str = "00:30"
    schedule_timezone: str = "Asia/Riyadh"
    last_scheduled_run_date: str = ""
    last_scheduled_run_at: str = ""
    batch_size_limit: int = 500
    hourly_request_limit: int = 1000
    updated_at: str


class CstConfigUpdate(BaseModel):
    enabled: bool | None = None
    service_provider_id: str | None = None
    auto_execute: bool | None = None
    scheduled_sync_enabled: bool | None = None
    schedule_time: str | None = None
    schedule_timezone: str | None = None
    batch_size_limit: int | None = None
    hourly_request_limit: int | None = None


class CstSyncBatch(BaseModel):
    id: str
    workflow_type: str
    status: str
    total_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    blocked_jobs: int = 0
    created_at: str
    completed_at: str = ""


class CstSyncJob(BaseModel):
    id: str
    batch_id: str
    resource_uuid: str
    transaction_id: str
    operation: str
    sequence_no: int = 1
    depends_on_job_id: str = ""
    cidr: str
    service_provider_id: str
    payload_json: str = ""
    response_json: str = ""
    status: str = "PENDING"
    attempt_count: int = 0
    last_error: str = ""
    created_at: str
    updated_at: str


class CstTransactionLedger(BaseModel):
    transaction_id: str
    cidr: str
    resource_uuid: str
    service_provider_id: str
    first_used_at: str
    last_status: str
    retired_at: str = ""
    retired_reason: str = ""
    batch_id: str = ""
    correlation_id: str = ""


class CstSyncSummary(BaseModel):
    enabled: bool = True
    auto_execute: bool = True
    scheduled_sync_enabled: bool = True
    schedule_time: str = "00:30"
    schedule_timezone: str = "Asia/Riyadh"
    last_scheduled_run_date: str = ""
    last_scheduled_run_at: str = ""
    total_jobs: int = 0
    pending_jobs: int = 0
    running_jobs: int = 0
    success_jobs: int = 0
    failed_jobs: int = 0
    blocked_jobs: int = 0
    total_transactions: int = 0
    last_batch_at: str = ""


class CstSchedulerRun(BaseModel):
    id: str
    target_date: str
    scheduled_for: str
    status: str
    batch_id: str = ""
    total_jobs: int = 0
    message: str = ""
    triggered_by: str = "scheduler"
    started_at: str
    completed_at: str = ""


class ResourceWithAssignment(ResourceRecord):
    assignment: AssignmentDetailRecord | None = None


SUPPORTED_RESOURCE_STATUSES = {"ASSIGNED_TO_BUSINESS", "RESERVED", "AVAILABLE", "RETIRED"}
SUPPORTED_OWNERSHIP_TYPES = {"BUSINESS", "INDIVIDUAL", "INTERNAL", "INFRASTRUCTURE", "POOL"}
CST_SYNC_STATUSES = {"NOT_CONFIGURED", "NOT_REQUIRED", "PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED"}
RIPE_SYNC_STATUSES = {"PENDING", "SUCCESS", "FAILED", "NOT_REQUIRED"}
ACTION_FLAGS = {"N", "U", "D", "S", "F"}


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=DB_BUSY_TIMEOUT_MS / 1000)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout = {DB_BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 150_000)
    return salt, digest.hex()


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    _, actual_hash = hash_password(password, salt)
    return hmac.compare_digest(actual_hash, expected_hash)


def encryption_key() -> bytes:
    secret = os.environ.get("RIPE_CONFIG_SECRET") or f"{DB_PATH.resolve()}:{secrets.token_hex(0)}"
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    data = value.encode("utf-8")
    key = encryption_key()
    encrypted = bytes(byte ^ key[index % len(key)] for index, byte in enumerate(data))
    return base64.urlsafe_b64encode(encrypted).decode("ascii")


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        data = base64.urlsafe_b64decode(value.encode("ascii"))
    except ValueError:
        return ""
    key = encryption_key()
    decrypted = bytes(byte ^ key[index % len(key)] for index, byte in enumerate(data))
    return decrypted.decode("utf-8", errors="ignore")


def normalize_network(cidr: str) -> IPv4Network:
    try:
        network = ip_network(cidr, strict=False)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CIDR: {cidr}") from exc

    if network.version != 4:
        raise HTTPException(status_code=400, detail="Only IPv4 CIDR is supported in this prototype")
    return network


def usable_bounds(network: IPv4Network) -> tuple[str, str]:
    if network.prefixlen >= 31:
        return str(network.network_address), str(network.broadcast_address)
    return str(network.network_address + 1), str(network.broadcast_address - 1)


def pool_from_network(network: IPv4Network, name: str, region: str, source: str = "API") -> Pool:
    return Pool(
        id=str(uuid4()),
        cidr=str(network),
        prefix=network.prefixlen,
        size=network.num_addresses,
        start=str(network.network_address),
        end=str(network.broadcast_address),
        name=name,
        region=region,
        source=source,
        created_at=now_iso(),
    )


def assignment_from_network(network: IPv4Network, payload: AssignmentCreate) -> Assignment:
    first_usable, last_usable = usable_bounds(network)
    assignment_id = str(uuid4())
    data = payload.model_dump(exclude={"cidr"})
    data["assignment_status_id"] = normalize_assignment_status_id(data.get("assignment_status_id"), payload)
    data["service_provider_id"] = data.get("service_provider_id") or DEFAULT_SERVICE_PROVIDER_ID
    data["service_provider_name"] = data.get("service_provider_name") or DEFAULT_SERVICE_PROVIDER_NAME
    data["asn"] = data.get("asn") or DEFAULT_ASN
    data["service_id"] = data.get("service_id") or data.get("service_instance_id") or ""
    data["service_description"] = data.get("service_description") or data.get("service") or data.get("assignment_purpose") or ""
    data["logical_resource_id"] = data.get("logical_resource_id") or assignment_id
    data["assignment_name"] = data.get("assignment_name") or f"Subnet assignment {network}"
    data["service_instance_name"] = data.get("service_instance_name") or data.get("service") or f"Service for {network}"
    if data["assignment_status_id"] == 4 or (data.get("assignment_target_type") or "").lower() == "individual":
        data["full_name"] = ""
        data["mobile_number"] = ""
        data["id_number"] = ""
        data["email"] = ""
    return Assignment(
        id=assignment_id,
        cidr=str(network),
        prefix=network.prefixlen,
        size=network.num_addresses,
        start=str(network.network_address),
        end=str(network.broadcast_address),
        first_usable=first_usable,
        last_usable=last_usable,
        created_at=now_iso(),
        **data,
    )


def network_of(item: Pool | Assignment) -> IPv4Network:
    return normalize_network(item.cidr)


def pool_from_row(row: sqlite3.Row) -> Pool:
    return Pool(**dict(row))


def assignment_from_row(row: sqlite3.Row) -> Assignment:
    return Assignment(**dict(row))


def audit_from_row(row: sqlite3.Row) -> AuditEvent:
    return AuditEvent(**dict(row))


def bulk_batch_from_row(row: sqlite3.Row) -> BulkBatch:
    return BulkBatch(**dict(row))


def ripe_config_from_row(row: sqlite3.Row) -> RipeConfigOut:
    data = dict(row)
    return RipeConfigOut(
        base_url=data["base_url"],
        auth_type=data["auth_type"],
        username=data["username"],
        password_configured=bool(data["encrypted_password"]),
        connection_timeout=data["connection_timeout"],
        read_timeout=data["read_timeout"],
        default_maintainer=data["default_maintainer"],
        updated_at=data["updated_at"],
    )


def ripe_allocated_pool_from_row(row: sqlite3.Row) -> RipeAllocatedPool:
    return RipeAllocatedPool(**dict(row))


def resource_from_row(row: sqlite3.Row) -> ResourceRecord:
    return ResourceRecord(**dict(row))


def assignment_detail_from_row(row: sqlite3.Row) -> AssignmentDetailRecord:
    return AssignmentDetailRecord(**dict(row))


def stable_uuid(*parts: str) -> str:
    return str(uuid5(NAMESPACE_URL, ":".join(parts)))


def new_version_uuid() -> str:
    return str(uuid4())


def normalize_resource_status(value: str, *, default: str = "AVAILABLE") -> str:
    normalized = (value or default).strip().upper().replace(" ", "_").replace("-", "_")
    mapping = {
        "1": "ASSIGNED_TO_BUSINESS",
        "ASSIGNED": "ASSIGNED_TO_BUSINESS",
        "ASSIGNED_TO_BUSINESS": "ASSIGNED_TO_BUSINESS",
        "ACTIVE": "ASSIGNED_TO_BUSINESS",
        "PLANNED": "ASSIGNED_TO_BUSINESS",
        "2": "RESERVED",
        "RESERVED": "RESERVED",
        "BLOCKED": "RESERVED",
        "QUARANTINED": "RESERVED",
        "3": "AVAILABLE",
        "AVAILABLE": "AVAILABLE",
        "FREE": "AVAILABLE",
        "4": "RETIRED",
        "RETIRED": "RETIRED",
        "RETIRING": "RETIRED",
    }
    status = mapping.get(normalized)
    if status not in SUPPORTED_RESOURCE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unsupported CIDR status: {value}")
    return status


def assignment_status_id_name(value: int) -> str:
    return {
        1: "Unassigned",
        2: "Internal",
        3: "Business",
        4: "Individual",
    }.get(value, "Unknown")


def normalize_assignment_status_id(value: int | str | None, assignment: AssignmentCreate | None = None) -> int:
    if value in (None, ""):
        if assignment:
            target = (assignment.assignment_target_type or "").lower()
            if "internal" in target:
                return 2
            if "individual" in target or (assignment.customer_type or "").lower() == "individual":
                return 4
        return 3
    try:
        status_id = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"assignmentStatusId must be 1, 2, 3, or 4: {value}") from exc
    if status_id not in {1, 2, 3, 4}:
        raise HTTPException(status_code=400, detail="assignmentStatusId must be 1 (Unassigned), 2 (Internal), 3 (Business), or 4 (Individual)")
    return status_id


def validate_cst_lir_assignment(payload: AssignmentCreate) -> None:
    status_id = normalize_assignment_status_id(payload.assignment_status_id, payload)
    if payload.action_flag not in ACTION_FLAGS:
        raise HTTPException(status_code=400, detail=f"actionFlag must be one of {sorted(ACTION_FLAGS)}")
    if payload.cst_sync_status not in CST_SYNC_STATUSES:
        raise HTTPException(status_code=400, detail=f"cstSyncStatus must be one of {sorted(CST_SYNC_STATUSES)}")
    if payload.ripe_sync_status not in RIPE_SYNC_STATUSES:
        raise HTTPException(status_code=400, detail=f"ripeSyncStatus must be one of {sorted(RIPE_SYNC_STATUSES)}")
    if status_id == 2 and not (payload.service_description or payload.service or payload.assignment_purpose).strip():
        raise HTTPException(status_code=400, detail="serviceDescription is mandatory when assignmentStatusId = 2 (Internal)")
    if status_id == 3 and not (payload.service_id or payload.service_instance_id).strip():
        raise HTTPException(status_code=400, detail="serviceId is mandatory when assignmentStatusId = 3 (Business)")


def status_to_assignment_status(status: str) -> str:
    normalized = normalize_resource_status(status)
    if normalized == "ASSIGNED_TO_BUSINESS":
        return "Active"
    if normalized == "RESERVED":
        return "Reserved"
    if normalized == "RETIRED":
        return "Retiring"
    return "Available"


def ownership_from_assignment(assignment: Assignment) -> str:
    if assignment.assignment_status_id == 4:
        return "INDIVIDUAL"
    if assignment.assignment_status_id == 2:
        return "INTERNAL"
    if assignment.assignment_status_id == 3:
        return "BUSINESS"
    target = (assignment.assignment_target_type or "").lower()
    if "individual" in target or assignment.customer_type.lower() == "individual":
        return "INDIVIDUAL"
    if "internal" in target:
        return "INTERNAL"
    if "infra" in target or assignment.internal_consumer_type.lower() == "infrastructure":
        return "INFRASTRUCTURE"
    return "BUSINESS"


def individual_assignment(assignment: Assignment) -> bool:
    return assignment.assignment_status_id == 4 or (assignment.assignment_target_type or "").lower() == "individual"


def assignment_released_after_ripe_removal(assignment: Assignment) -> bool:
    return (
        assignment.status == "Retiring"
        and assignment.action_flag == "D"
        and str(assignment.ripe_sync_status or "").upper() in {"SUCCESS", "SYNCHRONIZED"}
    )


def root_pool_for_network(network: IPv4Network, connection: sqlite3.Connection | None = None) -> Pool | None:
    if connection:
        pools = [pool_from_row(row) for row in connection.execute("SELECT * FROM pools").fetchall()]
    else:
        pools = list_pools_from_db()
    candidates = [pool for pool in pools if network.subnet_of(network_of(pool))]
    return min(candidates, key=lambda pool: network_of(pool).prefixlen, default=None)


def pool_resource_uuid(pool: Pool) -> str:
    return stable_uuid("resource", "pool", pool.id, pool.cidr)


def assignment_resource_uuid(assignment: Assignment) -> str:
    return stable_uuid("resource", "assignment", assignment.id, assignment.cidr)


def resource_record_for_pool(pool: Pool, existing: ResourceRecord | None = None) -> ResourceRecord:
    status = normalize_resource_status(pool.resource_status or pool.lifecycle_state or "Available")
    updated_at = now_iso()
    default_cst_sync_status = "PENDING" if status != "RETIRED" else "NOT_REQUIRED"
    default_ripe_sync_status = "PENDING" if network_of(pool).is_global else "NOT_REQUIRED"
    return ResourceRecord(
        resource_uuid=existing.resource_uuid if existing else pool_resource_uuid(pool),
        version_uuid=new_version_uuid() if existing else stable_uuid("version", "pool", pool.id, pool.cidr, pool.created_at),
        parent_resource_uuid="",
        parent_version_uuid="",
        transaction_id=pool.external_id or pool.id,
        cidr=pool.cidr,
        prefix=pool.prefix,
        start_ip=pool.start,
        end_ip=pool.end,
        size=pool.size,
        ip_version=1,
        ownership_type="POOL",
        status=status,
        cidr_role="ROOT_POOL" if not pool.parent_resource_id and not pool.parent_cidr else "POOL",
        service_provider_id=DEFAULT_SERVICE_PROVIDER_ID,
        service_provider_name=DEFAULT_SERVICE_PROVIDER_NAME,
        asn=pool.asn or DEFAULT_ASN,
        assignment_status_id=1,
        customer_name="",
        assignment_date="",
        update_date=updated_at,
        description=pool.description or pool.name,
        action_flag=existing.action_flag if existing and existing.cst_sync_status == "SUCCESS" else "N" if not existing else "U",
        cst_sync_status=existing.cst_sync_status if existing else default_cst_sync_status,
        ripe_sync_status=existing.ripe_sync_status if existing else default_ripe_sync_status,
        ip_type="PRIVATE" if network_of(pool).is_private else "PUBLIC",
        root_pool_uuid=existing.root_pool_uuid if existing and existing.root_pool_uuid else pool_resource_uuid(pool),
        source_entity_type="pool",
        source_entity_id=pool.id,
        created_at=existing.created_at if existing else pool.created_at,
        updated_at=updated_at,
    )


def resource_record_for_assignment(assignment: Assignment, existing: ResourceRecord | None = None, connection: sqlite3.Connection | None = None) -> ResourceRecord:
    network = network_of(assignment)
    root_pool = root_pool_for_network(network, connection)
    root_pool_uuid = pool_resource_uuid(root_pool) if root_pool else ""
    parent_resource_uuid = "" if existing and existing.resource_uuid == root_pool_uuid else root_pool_uuid
    updated_at = now_iso()
    status_id = normalize_assignment_status_id(assignment.assignment_status_id, assignment)
    service_id = assignment.service_id or assignment.service_instance_id
    hide_individual_identity = individual_assignment(assignment)
    return ResourceRecord(
        resource_uuid=existing.resource_uuid if existing else assignment_resource_uuid(assignment),
        version_uuid=new_version_uuid() if existing else stable_uuid("version", "assignment", assignment.id, assignment.cidr, assignment.created_at),
        parent_resource_uuid=parent_resource_uuid,
        parent_version_uuid="",
        transaction_id=assignment.logical_resource_id or assignment.id,
        cidr=assignment.cidr,
        prefix=assignment.prefix,
        start_ip=assignment.start,
        end_ip=assignment.end,
        size=assignment.size,
        ip_version=1,
        ownership_type=ownership_from_assignment(assignment),
        status=normalize_resource_status(assignment.status),
        cidr_role="HOST" if assignment.prefix == 32 else "SUBNET",
        service_provider_id=assignment.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
        service_provider_name=assignment.service_provider_name or DEFAULT_SERVICE_PROVIDER_NAME,
        asn=assignment.asn or DEFAULT_ASN,
        assignment_status_id=status_id,
        service_id=service_id,
        organization_name=assignment.organization_name or assignment.customer_name,
        organization_id=assignment.organization_id or assignment.customer_id,
        customer_type_id=assignment.customer_type_id,
        region_id=assignment.region_id,
        city_id=assignment.city_id,
        full_name="" if hide_individual_identity else assignment.full_name,
        mobile_number="" if hide_individual_identity else assignment.mobile_number or assignment.contact_number,
        id_number="" if hide_individual_identity else assignment.id_number,
        email="" if hide_individual_identity else assignment.email or assignment.contact_email,
        customer_name=assignment.customer_name,
        assignment_date=assignment.assignment_date,
        update_date=updated_at,
        access_technology_id=assignment.access_technology_id,
        access_technology=assignment.access_technology,
        service_description=assignment.service_description or assignment.service or assignment.assignment_purpose,
        description=assignment.notes or assignment.assignment_description,
        action_flag=assignment.action_flag or ("N" if not existing else "U"),
        cst_sync_status=assignment.cst_sync_status or "PENDING",
        ripe_sync_status=assignment.ripe_sync_status or ("PENDING" if network.is_global else "NOT_REQUIRED"),
        ip_type="PRIVATE" if network.is_private else "PUBLIC",
        root_pool_uuid=existing.root_pool_uuid if existing and existing.root_pool_uuid else root_pool_uuid,
        source_entity_type="assignment",
        source_entity_id=assignment.id,
        created_at=existing.created_at if existing else assignment.created_at,
        updated_at=updated_at,
    )


def assignment_detail_record_for_assignment(assignment: Assignment, resource: ResourceRecord, existing: AssignmentDetailRecord | None = None) -> AssignmentDetailRecord:
    hide_individual_identity = individual_assignment(assignment)
    return AssignmentDetailRecord(
        id=existing.id if existing else f"assignment-detail-{uuid4().hex[:12]}",
        resource_uuid=resource.resource_uuid,
        version_uuid=resource.version_uuid,
        assignment_type=assignment.assignment_target_type,
        assignment_status_id=normalize_assignment_status_id(assignment.assignment_status_id, assignment),
        assignment_date=assignment.assignment_date,
        service_id=assignment.service_id or assignment.service_instance_id,
        customer_name=assignment.customer_name,
        organization_name=assignment.organization_name or assignment.customer_name,
        organization_id=assignment.organization_id or assignment.customer_id,
        customer_type_id=assignment.customer_type_id,
        region_id=assignment.region_id,
        city_id=assignment.city_id,
        full_name="" if hide_individual_identity else assignment.full_name,
        mobile_number="" if hide_individual_identity else assignment.mobile_number or assignment.contact_number,
        id_number="" if hide_individual_identity else assignment.id_number,
        email="" if hide_individual_identity else assignment.email or assignment.contact_email,
        commercial_reg_id=assignment.commercial_reg_id,
        unified_number=assignment.unified_number,
        contact_number=assignment.contact_number,
        contact_email=assignment.contact_email,
        city=assignment.city,
        region=assignment.region,
        contact_name=assignment.contact_name,
        service_instance_id=assignment.service_instance_id,
        service_instance_name=assignment.service_instance_name,
        service_type=assignment.service_type,
        service_category=assignment.service_category,
        l3_service=assignment.l3_service,
        service=assignment.service,
        access_technology_id=assignment.access_technology_id,
        access_technology=assignment.access_technology,
        service_description=assignment.service_description or assignment.service or assignment.assignment_purpose,
        owner=assignment.owner,
        purpose=assignment.assignment_purpose,
        created_at=existing.created_at if existing else assignment.created_at,
        updated_at=now_iso(),
    )


def upsert_resource_record(connection: sqlite3.Connection, resource: ResourceRecord) -> None:
    data = resource.model_dump()
    columns = list(data.keys())
    update_sql = ", ".join(f"{column} = excluded.{column}" for column in columns if column != "resource_uuid")
    connection.execute(
        f"""
        INSERT INTO ip_resources ({", ".join(columns)})
        VALUES ({", ".join(f":{column}" for column in columns)})
        ON CONFLICT(resource_uuid) DO UPDATE SET {update_sql}
        """,
        data,
    )


def upsert_assignment_detail(connection: sqlite3.Connection, detail: AssignmentDetailRecord) -> None:
    data = detail.model_dump()
    columns = list(data.keys())
    update_sql = ", ".join(f"{column} = excluded.{column}" for column in columns if column != "id")
    connection.execute(
        f"""
        INSERT INTO assignment_details ({", ".join(columns)})
        VALUES ({", ".join(f":{column}" for column in columns)})
        ON CONFLICT(id) DO UPDATE SET {update_sql}
        """,
        data,
    )


def find_resource_by_source(connection: sqlite3.Connection, entity_type: str, entity_id: str) -> ResourceRecord | None:
    row = connection.execute(
        "SELECT * FROM ip_resources WHERE source_entity_type = ? AND source_entity_id = ?",
        (entity_type, entity_id),
    ).fetchone()
    return resource_from_row(row) if row else None


def find_resource_by_cidr(connection: sqlite3.Connection, cidr: str) -> ResourceRecord | None:
    row = connection.execute("SELECT * FROM ip_resources WHERE cidr = ?", (cidr,)).fetchone()
    return resource_from_row(row) if row else None


def sync_pool_resource(connection: sqlite3.Connection, pool: Pool) -> ResourceRecord:
    existing = find_resource_by_source(connection, "pool", pool.id) or find_resource_by_cidr(connection, pool.cidr)
    resource = resource_record_for_pool(pool, existing)
    upsert_resource_record(connection, resource)
    return resource


def sync_assignment_resource(connection: sqlite3.Connection, assignment: Assignment) -> ResourceRecord:
    existing = find_resource_by_source(connection, "assignment", assignment.id) or find_resource_by_cidr(connection, assignment.cidr)
    resource = resource_record_for_assignment(assignment, existing, connection)
    upsert_resource_record(connection, resource)
    existing_detail_row = connection.execute(
        "SELECT * FROM assignment_details WHERE resource_uuid = ?",
        (resource.resource_uuid,),
    ).fetchone()
    detail = assignment_detail_record_for_assignment(
        assignment,
        resource,
        assignment_detail_from_row(existing_detail_row) if existing_detail_row else None,
    )
    upsert_assignment_detail(connection, detail)
    return resource


def sync_normalized_inventory(connection: sqlite3.Connection) -> None:
    for row in connection.execute("SELECT * FROM pools").fetchall():
        sync_pool_resource(connection, pool_from_row(row))
    for row in connection.execute("SELECT * FROM assignments").fetchall():
        sync_assignment_resource(connection, assignment_from_row(row))


def normalized_inventory_needs_sync(connection: sqlite3.Connection) -> bool:
    source_count = connection.execute("SELECT COUNT(*) FROM pools").fetchone()[0]
    source_count += connection.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
    resource_count = connection.execute(
        "SELECT COUNT(*) FROM ip_resources WHERE source_entity_type IN ('pool', 'assignment')"
    ).fetchone()[0]
    return source_count != resource_count


def add_missing_columns(connection: sqlite3.Connection, table: str, model: type[BaseModel]) -> None:
    existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    for field_name, field in model.model_fields.items():
        if field_name in existing:
            continue
        default_value = field.default
        if default_value is None:
            default_value = ""
        if isinstance(default_value, bool):
            column_type = "INTEGER"
            default_sql = "1" if default_value else "0"
        elif isinstance(default_value, (int, float)):
            column_type = "INTEGER" if isinstance(default_value, int) else "REAL"
            default_sql = str(default_value)
        else:
            column_type = "TEXT"
            default_sql = "'" + str(default_value).replace("'", "''") + "'"
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {field_name} {column_type} NOT NULL DEFAULT {default_sql}")


def record_audit(
    connection: sqlite3.Connection,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: str = "",
    new_value: str = "",
    user: str = "ipam-admin",
    source_system: str = "ipam-core-services",
    request_id: str = "",
) -> None:
    AUDIT_SERVICE.record(
        connection,
        action,
        entity_type,
        entity_id,
        old_value,
        new_value,
        AuditContext(user=user, source_system=source_system, request_id=request_id),
    )



def cst_config_from_row(row: sqlite3.Row) -> CstConfig:
    values = dict(row)
    return CstConfig(
        id=str(values.get("id", "default")),
        enabled=bool(values.get("enabled", 1)),
        service_provider_id=str(values.get("service_provider_id") or DEFAULT_SERVICE_PROVIDER_ID),
        auto_execute=bool(values.get("auto_execute", 1)),
        scheduled_sync_enabled=bool(values.get("scheduled_sync_enabled", 1)),
        schedule_time=str(values.get("schedule_time") or "00:30"),
        schedule_timezone=str(values.get("schedule_timezone") or "Asia/Riyadh"),
        last_scheduled_run_date=str(values.get("last_scheduled_run_date") or ""),
        last_scheduled_run_at=str(values.get("last_scheduled_run_at") or ""),
        batch_size_limit=int(values.get("batch_size_limit") or 500),
        hourly_request_limit=int(values.get("hourly_request_limit") or 1000),
        updated_at=str(values.get("updated_at") or ""),
    )


def cst_batch_from_row(row: sqlite3.Row) -> CstSyncBatch:
    return CstSyncBatch(**dict(row))


def cst_job_from_row(row: sqlite3.Row) -> CstSyncJob:
    return CstSyncJob(**dict(row))


def cst_ledger_from_row(row: sqlite3.Row) -> CstTransactionLedger:
    return CstTransactionLedger(**dict(row))


def cst_scheduler_run_from_row(row: sqlite3.Row) -> CstSchedulerRun:
    return CstSchedulerRun(**dict(row))


def ensure_cst_config(connection: sqlite3.Connection) -> CstConfig:
    row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    if row is None:
        connection.execute(
            """
            INSERT INTO cst_config (
              id, enabled, service_provider_id, auto_execute, scheduled_sync_enabled,
              schedule_time, schedule_timezone, last_scheduled_run_date, last_scheduled_run_at,
              batch_size_limit, hourly_request_limit, updated_at
            )
            VALUES ('default', 1, ?, 1, 1, '00:30', 'Asia/Riyadh', '', '', 500, 1000, ?)
            """,
            (DEFAULT_SERVICE_PROVIDER_ID, now_iso()),
        )
        row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    return cst_config_from_row(row)


def resource_requires_cst(resource: ResourceRecord) -> bool:
    return resource.ip_type == "PUBLIC" and resource.status != "RETIRED"


def cst_transaction_id_for_resource(connection: sqlite3.Connection, resource: ResourceRecord, operation: str, batch_id: str, correlation_id: str) -> str:
    existing = connection.execute(
        """
        SELECT transaction_id, retired_at
        FROM cst_transaction_ledger
        WHERE resource_uuid = ?
        ORDER BY first_used_at DESC
        LIMIT 1
        """,
        (resource.resource_uuid,),
    ).fetchone()
    if existing and operation != "SEND":
        return str(existing["transaction_id"])
    if existing and not str(existing["retired_at"] or ""):
        return str(existing["transaction_id"])

    service_provider_id = resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID
    while True:
        candidate = str(uuid4())
        duplicate = connection.execute(
            "SELECT 1 FROM cst_transaction_ledger WHERE transaction_id = ?",
            (candidate,),
        ).fetchone()
        if duplicate is None:
            break
    created_at = now_iso()
    connection.execute(
        """
        INSERT INTO cst_transaction_ledger (
          transaction_id, cidr, resource_uuid, service_provider_id, first_used_at,
          last_status, retired_at, retired_reason, batch_id, correlation_id
        )
        VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)
        """,
        (candidate, resource.cidr, resource.resource_uuid, service_provider_id, created_at, "PENDING", batch_id, correlation_id),
    )
    return candidate


def cst_payload_for_resource(resource: ResourceRecord, operation: str, transaction_id: str, correlation_id: str) -> dict:
    return {
        "transactionId": transaction_id,
        "correlationId": correlation_id,
        "operation": operation,
        "resourceUuid": resource.resource_uuid,
        "versionUuid": resource.version_uuid,
        "cidr": resource.cidr,
        "startIp": resource.start_ip,
        "endIp": resource.end_ip,
        "prefix": resource.prefix,
        "size": resource.size,
        "ipVersion": resource.ip_version,
        "serviceProviderId": resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
        "serviceProviderName": resource.service_provider_name or DEFAULT_SERVICE_PROVIDER_NAME,
        "asn": resource.asn or DEFAULT_ASN,
        "assignmentStatusId": resource.assignment_status_id,
        "assignmentStatus": assignment_status_id_name(resource.assignment_status_id),
        "ownershipType": resource.ownership_type,
        "resourceStatus": resource.status,
        "serviceId": resource.service_id,
        "organizationName": resource.organization_name or resource.customer_name,
        "organizationId": resource.organization_id,
        "customerTypeId": resource.customer_type_id,
        "regionId": resource.region_id,
        "cityId": resource.city_id,
        "assignmentDate": resource.assignment_date,
        "updateDate": resource.update_date,
        "sourceEntityType": resource.source_entity_type,
        "sourceEntityId": resource.source_entity_id,
    }



def cst_resource_from_network(
    network: IPv4Network,
    resource_uuid: str,
    source_entity_type: str,
    source_entity_id: str,
    description: str,
    transaction_id: str = "",
) -> ResourceRecord:
    timestamp = now_iso()
    return ResourceRecord(
        resource_uuid=resource_uuid,
        version_uuid=new_version_uuid(),
        parent_resource_uuid="",
        parent_version_uuid="",
        transaction_id=transaction_id,
        cidr=str(network),
        prefix=network.prefixlen,
        start_ip=str(network.network_address),
        end_ip=str(network.broadcast_address),
        size=network.num_addresses,
        ip_version=1,
        ownership_type="POOL",
        status="AVAILABLE",
        cidr_role="SUBNET",
        service_provider_id=DEFAULT_SERVICE_PROVIDER_ID,
        service_provider_name=DEFAULT_SERVICE_PROVIDER_NAME,
        asn=DEFAULT_ASN,
        assignment_status_id=1,
        description=description,
        action_flag="N",
        cst_sync_status="PENDING",
        ripe_sync_status="NOT_REQUIRED",
        ip_type="PRIVATE" if network.is_private else "PUBLIC",
        root_pool_uuid="",
        source_entity_type=source_entity_type,
        source_entity_id=source_entity_id,
        created_at=timestamp,
        updated_at=timestamp,
    )


def cst_resource_from_ledger(row: sqlite3.Row) -> ResourceRecord:
    network = normalize_network(str(row["cidr"]))
    return cst_resource_from_network(
        network,
        str(row["resource_uuid"]),
        "cst_lir_ledger",
        str(row["transaction_id"]),
        "Existing CST LIR object scheduled for replacement",
        str(row["transaction_id"]),
    )


def remaining_networks_after_subtract(container: IPv4Network, allocated: IPv4Network) -> list[IPv4Network]:
    remaining: list[IPv4Network] = []
    if int(container.network_address) < int(allocated.network_address):
        remaining.extend(summarize_address_range(container.network_address, IPv4Address(int(allocated.network_address) - 1)))
    if int(allocated.broadcast_address) < int(container.broadcast_address):
        remaining.extend(summarize_address_range(IPv4Address(int(allocated.broadcast_address) + 1), container.broadcast_address))
    return remaining


def active_cst_containers_for_network(connection: sqlite3.Connection, network: IPv4Network) -> list[sqlite3.Row]:
    rows = connection.execute(
        """
        SELECT *
        FROM cst_transaction_ledger
        WHERE retired_at = ''
          AND last_status = 'SUCCESS'
        ORDER BY first_used_at DESC
        """
    ).fetchall()
    containers: list[tuple[int, sqlite3.Row]] = []
    for row in rows:
        try:
            ledger_network = normalize_network(str(row["cidr"]))
        except HTTPException:
            continue
        if network.subnet_of(ledger_network):
            containers.append((ledger_network.prefixlen, row))
    containers.sort(key=lambda item: item[0], reverse=True)
    return [row for _prefix, row in containers[:1]]


def create_cst_assignment_create_jobs(
    connection: sqlite3.Connection,
    assignment: Assignment,
    assignment_resource: ResourceRecord,
    workflow_type: str,
) -> list[CstSyncJob]:
    assigned_network = network_of(assignment)
    operations: list[tuple[ResourceRecord, str]] = []
    for row in active_cst_containers_for_network(connection, assigned_network):
        container_resource = cst_resource_from_ledger(row)
        container_network = normalize_network(str(row["cidr"]))
        operations.append((container_resource, "DELETE"))
        for fragment in remaining_networks_after_subtract(container_network, assigned_network):
            fragment_uuid = stable_uuid("cst-fragment", str(row["transaction_id"]), assignment.id, str(fragment))
            operations.append(
                (
                    cst_resource_from_network(
                        fragment,
                        fragment_uuid,
                        "cst_remaining_fragment",
                        f"{assignment.id}:{fragment}",
                        f"Remaining unassigned CST fragment after assigning {assignment.cidr}",
                    ),
                    "SEND",
                )
            )
    operations.append((assignment_resource, "SEND"))
    return create_cst_sync_jobs(connection, operations, workflow_type)
def create_cst_sync_jobs(
    connection: sqlite3.Connection,
    resource_operations: list[tuple[ResourceRecord, str]],
    workflow_type: str,
) -> list[CstSyncJob]:
    eligible = [(resource, operation) for resource, operation in resource_operations if resource.ip_type == "PUBLIC"]
    if not eligible:
        return []

    config = ensure_cst_config(connection)
    batch_id = f"cst-batch-{uuid4().hex[:12]}"
    correlation_id = f"cst-corr-{uuid4().hex[:12]}"
    created_at = now_iso()
    connection.execute(
        """
        INSERT INTO cst_sync_batches (
          id, workflow_type, status, total_jobs, completed_jobs, failed_jobs,
          blocked_jobs, created_at, completed_at
        )
        VALUES (?, ?, 'RUNNING', ?, 0, 0, 0, ?, '')
        """,
        (batch_id, workflow_type, len(eligible), created_at),
    )

    jobs: list[CstSyncJob] = []
    for sequence_no, (resource, operation) in enumerate(eligible, start=1):
        transaction_id = cst_transaction_id_for_resource(connection, resource, operation, batch_id, correlation_id)
        payload = cst_payload_for_resource(resource, operation, transaction_id, correlation_id)
        if not config.enabled:
            status = "BLOCKED"
            last_error = "CST integration is disabled in Administration"
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
        elif config.scheduled_sync_enabled and not workflow_type.startswith("CST_DAILY_DAY_MINUS_1"):
            status = "PENDING"
            last_error = ""
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": True, "message": f"Queued for daily CST sync at {config.schedule_time} {config.schedule_timezone}"}
        elif config.auto_execute:
            status = "SUCCESS"
            last_error = ""
            response = {
                "temporaryStorage": True,
                "externalApiCalled": False,
                "accepted": True,
                "message": "Stored in local CST transaction table. External CST API integration is pending.",
                "processedAt": now_iso(),
            }
        else:
            status = "PENDING"
            last_error = ""
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": True, "message": "Queued locally for CST processing"}

        updated_at = now_iso()
        job = CstSyncJob(
            id=f"cst-job-{uuid4().hex[:12]}",
            batch_id=batch_id,
            resource_uuid=resource.resource_uuid,
            transaction_id=transaction_id,
            operation=operation,
            sequence_no=sequence_no,
            cidr=resource.cidr,
            service_provider_id=resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
            payload_json=json.dumps(payload, sort_keys=True),
            response_json=json.dumps(response, sort_keys=True),
            status=status,
            attempt_count=1 if status == "SUCCESS" else 0,
            last_error=last_error,
            created_at=created_at,
            updated_at=updated_at,
        )
        data = job.model_dump()
        columns = list(data.keys())
        connection.execute(
            f"INSERT INTO cst_sync_jobs ({', '.join(columns)}) VALUES ({', '.join(f':{column}' for column in columns)})",
            data,
        )
        retired_at = updated_at if operation == "DELETE" and status == "SUCCESS" else ""
        retired_reason = "Removed from CST LIR registry" if retired_at else ""
        connection.execute(
            """
            UPDATE cst_transaction_ledger
            SET cidr = ?, last_status = ?, retired_at = COALESCE(NULLIF(?, ''), retired_at),
                retired_reason = COALESCE(NULLIF(?, ''), retired_reason), batch_id = ?, correlation_id = ?
            WHERE transaction_id = ?
            """,
            (resource.cidr, status, retired_at, retired_reason, batch_id, correlation_id, transaction_id),
        )
        action_flag = "D" if operation == "DELETE" and status == "SUCCESS" else "S" if status == "SUCCESS" else "F" if status in {"FAILED", "BLOCKED"} else "U"
        connection.execute(
            """
            UPDATE ip_resources
            SET transaction_id = ?, cst_sync_status = ?, action_flag = ?, update_date = ?, updated_at = ?
            WHERE resource_uuid = ?
            """,
            (transaction_id, status, action_flag, updated_at, updated_at, resource.resource_uuid),
        )
        if resource.source_entity_type == "assignment":
            connection.execute(
                "UPDATE assignments SET cst_sync_status = ?, action_flag = ? WHERE id = ?",
                (status, action_flag, resource.source_entity_id),
            )
        jobs.append(job)

    completed_jobs = sum(1 for job in jobs if job.status == "SUCCESS")
    failed_jobs = sum(1 for job in jobs if job.status == "FAILED")
    blocked_jobs = sum(1 for job in jobs if job.status == "BLOCKED")
    batch_status = "SUCCESS" if completed_jobs == len(jobs) else "BLOCKED" if blocked_jobs else "FAILED" if failed_jobs else "PENDING"
    connection.execute(
        """
        UPDATE cst_sync_batches
        SET status = ?, completed_jobs = ?, failed_jobs = ?, blocked_jobs = ?, completed_at = ?
        WHERE id = ?
        """,
        (batch_status, completed_jobs, failed_jobs, blocked_jobs, now_iso() if batch_status != "PENDING" else "", batch_id),
    )
    return jobs


def retry_cst_jobs(connection: sqlite3.Connection, job_rows: list[sqlite3.Row]) -> list[CstSyncJob]:
    updated_jobs: list[CstSyncJob] = []
    for row in job_rows:
        job = cst_job_from_row(row)
        response = {
            "temporaryStorage": True,
            "externalApiCalled": False,
            "accepted": True,
            "message": "Retry stored locally. External CST API integration is pending.",
            "processedAt": now_iso(),
        }
        updated_at = now_iso()
        connection.execute(
            """
            UPDATE cst_sync_jobs
            SET status = 'SUCCESS', attempt_count = attempt_count + 1, last_error = '', response_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(response, sort_keys=True), updated_at, job.id),
        )
        connection.execute(
            "UPDATE cst_transaction_ledger SET last_status = 'SUCCESS', batch_id = ? WHERE transaction_id = ?",
            (job.batch_id, job.transaction_id),
        )
        action_flag = "D" if job.operation == "DELETE" else "S"
        retired_at = updated_at if job.operation == "DELETE" else ""
        retired_reason = "Removed from CST LIR registry" if retired_at else ""
        connection.execute(
            """
            UPDATE cst_transaction_ledger
            SET retired_at = COALESCE(NULLIF(?, ''), retired_at), retired_reason = COALESCE(NULLIF(?, ''), retired_reason)
            WHERE transaction_id = ?
            """,
            (retired_at, retired_reason, job.transaction_id),
        )
        connection.execute(
            "UPDATE ip_resources SET cst_sync_status = 'SUCCESS', transaction_id = ?, action_flag = ?, updated_at = ? WHERE resource_uuid = ?",
            (job.transaction_id, action_flag, updated_at, job.resource_uuid),
        )
        updated = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job.id,)).fetchone()
        updated_jobs.append(cst_job_from_row(updated))
    for batch_id in {job.batch_id for job in updated_jobs}:
        rows = connection.execute("SELECT status FROM cst_sync_jobs WHERE batch_id = ?", (batch_id,)).fetchall()
        total = len(rows)
        completed = sum(1 for item in rows if item["status"] == "SUCCESS")
        failed = sum(1 for item in rows if item["status"] == "FAILED")
        blocked = sum(1 for item in rows if item["status"] == "BLOCKED")
        status = "SUCCESS" if completed == total else "BLOCKED" if blocked else "FAILED" if failed else "PENDING"
        connection.execute(
            "UPDATE cst_sync_batches SET status = ?, completed_jobs = ?, failed_jobs = ?, blocked_jobs = ?, completed_at = ? WHERE id = ?",
            (status, completed, failed, blocked, now_iso() if status == "SUCCESS" else "", batch_id),
        )
    return updated_jobs


def cst_schedule_timezone(config: CstConfig) -> ZoneInfo:
    try:
        return ZoneInfo(config.schedule_timezone or "Asia/Riyadh")
    except Exception:
        return ZoneInfo("Asia/Riyadh")


def parse_cst_schedule_time(value: str) -> datetime_time:
    try:
        hour_text, minute_text = str(value or "00:30").split(":", 1)
        return datetime_time(hour=int(hour_text), minute=int(minute_text[:2]))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="CST schedule time must use HH:MM format") from exc


def cst_local_day_bounds_utc(target_date: str, timezone_name: str) -> tuple[str, str]:
    try:
        target = datetime.fromisoformat(target_date).date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="target_date must use YYYY-MM-DD format") from exc
    try:
        zone = ZoneInfo(timezone_name or "Asia/Riyadh")
    except Exception:
        zone = ZoneInfo("Asia/Riyadh")
    start_local = datetime.combine(target, datetime_time.min, zone)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def run_cst_day_minus_one_sync(target_date: str = "", triggered_by: str = "manual") -> CstSchedulerRun:
    with DB_WRITE_LOCK:
        with connect() as connection:
            config = ensure_cst_config(connection)
            zone = cst_schedule_timezone(config)
            if not target_date:
                target_date = (datetime.now(zone).date() - timedelta(days=1)).isoformat()
            existing = connection.execute(
                "SELECT * FROM cst_scheduler_runs WHERE target_date = ?",
                (target_date,),
            ).fetchone()
            if existing:
                return cst_scheduler_run_from_row(existing)

            started_at = now_iso()
            scheduled_for_date = (datetime.fromisoformat(target_date).date() + timedelta(days=1)).isoformat()
            scheduled_for = f"{scheduled_for_date} {config.schedule_time} {config.schedule_timezone}"
            run_id = f"cst-schedule-{uuid4().hex[:12]}"
            batch_id = f"cst-batch-{uuid4().hex[:12]}"
            start_utc, end_utc = cst_local_day_bounds_utc(target_date, config.schedule_timezone)
            job_rows = connection.execute(
                """
                SELECT *
                FROM cst_sync_jobs
                WHERE status IN ('PENDING', 'FAILED', 'BLOCKED')
                  AND created_at >= ?
                  AND created_at < ?
                ORDER BY created_at, sequence_no
                """,
                (start_utc, end_utc),
            ).fetchall()
            total_jobs = len(job_rows)
            connection.execute(
                """
                INSERT INTO cst_scheduler_runs (
                  id, target_date, scheduled_for, status, batch_id, total_jobs,
                  message, triggered_by, started_at, completed_at
                )
                VALUES (?, ?, ?, 'RUNNING', ?, ?, '', ?, ?, '')
                """,
                (run_id, target_date, scheduled_for, batch_id, total_jobs, triggered_by, started_at),
            )
            connection.execute(
                """
                INSERT INTO cst_sync_batches (
                  id, workflow_type, status, total_jobs, completed_jobs, failed_jobs,
                  blocked_jobs, created_at, completed_at
                )
                VALUES (?, ?, 'RUNNING', ?, 0, 0, 0, ?, '')
                """,
                (batch_id, f"CST_DAILY_DAY_MINUS_1:{target_date}", total_jobs, started_at),
            )
            if total_jobs:
                for sequence_no, row in enumerate(job_rows, start=1):
                    connection.execute(
                        "UPDATE cst_sync_jobs SET batch_id = ?, sequence_no = ?, updated_at = ? WHERE id = ?",
                        (batch_id, sequence_no, started_at, row["id"]),
                    )
                updated_rows = connection.execute(
                    "SELECT * FROM cst_sync_jobs WHERE batch_id = ? ORDER BY sequence_no",
                    (batch_id,),
                ).fetchall()
                retry_cst_jobs(connection, updated_rows)
                message = f"Processed {total_jobs} CST job(s) created on {target_date}."
            else:
                connection.execute(
                    "UPDATE cst_sync_batches SET status = 'SUCCESS', completed_at = ? WHERE id = ?",
                    (now_iso(), batch_id),
                )
                message = f"No pending CST jobs found for {target_date}."
            completed_at = now_iso()
            connection.execute(
                "UPDATE cst_scheduler_runs SET status = 'SUCCESS', message = ?, completed_at = ? WHERE id = ?",
                (message, completed_at, run_id),
            )
            record_audit(connection, "CST Daily Day-1 Sync", "cst_scheduler_run", run_id, "", json.dumps({"target_date": target_date, "jobs": total_jobs, "batch_id": batch_id, "triggered_by": triggered_by}))
            row = connection.execute("SELECT * FROM cst_scheduler_runs WHERE id = ?", (run_id,)).fetchone()
            return cst_scheduler_run_from_row(row)


def run_due_cst_daily_schedule() -> None:
    with CST_SCHEDULER_LOCK:
        with connect() as connection:
            config = ensure_cst_config(connection)
            if not config.enabled or not config.scheduled_sync_enabled:
                return
            zone = cst_schedule_timezone(config)
            local_now = datetime.now(zone)
            schedule_time = parse_cst_schedule_time(config.schedule_time)
            scheduled_at = datetime.combine(local_now.date(), schedule_time, zone)
            if local_now < scheduled_at:
                return
            if config.last_scheduled_run_date == local_now.date().isoformat():
                return
            target_date = (local_now.date() - timedelta(days=1)).isoformat()
        run_cst_day_minus_one_sync(target_date, "scheduler")
        with connect() as connection:
            connection.execute(
                "UPDATE cst_config SET last_scheduled_run_date = ?, last_scheduled_run_at = ?, updated_at = ? WHERE id = 'default'",
                (datetime.now(zone).date().isoformat(), now_iso(), now_iso()),
            )


def cst_scheduler_loop() -> None:
    while True:
        try:
            run_due_cst_daily_schedule()
        except Exception:
            pass
        time.sleep(60)


@app.on_event("startup")
def start_cst_scheduler() -> None:
    global CST_SCHEDULER_STARTED
    if CST_SCHEDULER_STARTED:
        return
    CST_SCHEDULER_STARTED = True
    thread = threading.Thread(target=cst_scheduler_loop, name="cst-daily-scheduler", daemon=True)
    thread.start()
def migrate_legacy_cst_transaction_ids(connection: sqlite3.Connection) -> None:
    legacy_rows = connection.execute(
        "SELECT transaction_id FROM cst_transaction_ledger WHERE transaction_id LIKE 'CST-%'"
    ).fetchall()
    for row in legacy_rows:
        old_id = str(row["transaction_id"])
        while True:
            new_id = str(uuid4())
            duplicate = connection.execute(
                "SELECT 1 FROM cst_transaction_ledger WHERE transaction_id = ?",
                (new_id,),
            ).fetchone()
            if duplicate is None:
                break
        connection.execute(
            "UPDATE cst_sync_jobs SET transaction_id = ?, payload_json = REPLACE(payload_json, ?, ?), response_json = REPLACE(response_json, ?, ?) WHERE transaction_id = ?",
            (new_id, old_id, new_id, old_id, new_id, old_id),
        )
        connection.execute(
            "UPDATE ip_resources SET transaction_id = ? WHERE transaction_id = ?",
            (new_id, old_id),
        )
        connection.execute(
            "UPDATE cst_transaction_ledger SET transaction_id = ? WHERE transaction_id = ?",
            (new_id, old_id),
        )
def insert_pool(connection: sqlite3.Connection, pool: Pool) -> None:
    data = pool.model_dump()
    columns = list(data.keys())
    column_sql = ", ".join(columns)
    value_sql = ", ".join(f":{column}" for column in columns)
    connection.execute(
        f"INSERT INTO pools ({column_sql}) VALUES ({value_sql})",
        data,
    )


def insert_assignment(connection: sqlite3.Connection, assignment: Assignment) -> None:
    data = assignment.model_dump()
    columns = list(data.keys())
    column_sql = ", ".join(columns)
    value_sql = ", ".join(f":{column}" for column in columns)
    connection.execute(
        f"INSERT INTO assignments ({column_sql}) VALUES ({value_sql})",
        data,
    )


def init_db() -> None:
    with connect() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS pools (
              id TEXT PRIMARY KEY,
              cidr TEXT NOT NULL UNIQUE,
              prefix INTEGER NOT NULL,
              size INTEGER NOT NULL,
              start TEXT NOT NULL,
              end TEXT NOT NULL,
              name TEXT NOT NULL,
              region TEXT NOT NULL,
              source TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assignments (
              id TEXT PRIMARY KEY,
              cidr TEXT NOT NULL UNIQUE,
              prefix INTEGER NOT NULL,
              size INTEGER NOT NULL,
              start TEXT NOT NULL,
              end TEXT NOT NULL,
              first_usable TEXT NOT NULL,
              last_usable TEXT NOT NULL,
              customer_name TEXT NOT NULL,
              commercial_reg_id TEXT NOT NULL,
              unified_number TEXT NOT NULL,
              contact_number TEXT NOT NULL,
              city TEXT NOT NULL,
              region TEXT NOT NULL,
              contact_name TEXT NOT NULL,
              l3_service TEXT NOT NULL,
              service TEXT NOT NULL,
              owner TEXT NOT NULL,
              site TEXT NOT NULL,
              environment TEXT NOT NULL,
              status TEXT NOT NULL,
              assignment_date TEXT NOT NULL,
              notes TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pools_cidr ON pools (cidr);
            CREATE INDEX IF NOT EXISTS idx_assignments_cidr ON assignments (cidr);
            CREATE INDEX IF NOT EXISTS idx_assignments_customer ON assignments (customer_name);

            CREATE TABLE IF NOT EXISTS ip_resources (
              resource_uuid TEXT PRIMARY KEY,
              version_uuid TEXT NOT NULL,
              parent_resource_uuid TEXT NOT NULL,
              parent_version_uuid TEXT NOT NULL,
              cidr TEXT NOT NULL UNIQUE,
              prefix INTEGER NOT NULL,
              start_ip TEXT NOT NULL,
              end_ip TEXT NOT NULL,
              size INTEGER NOT NULL,
              ownership_type TEXT NOT NULL,
              status TEXT NOT NULL,
              customer_name TEXT NOT NULL,
              assignment_date TEXT NOT NULL,
              ip_type TEXT NOT NULL,
              root_pool_uuid TEXT NOT NULL,
              source_entity_type TEXT NOT NULL,
              source_entity_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ip_resources_cidr ON ip_resources (cidr);
            CREATE INDEX IF NOT EXISTS idx_ip_resources_status ON ip_resources (status);
            CREATE INDEX IF NOT EXISTS idx_ip_resources_root ON ip_resources (root_pool_uuid);
            CREATE INDEX IF NOT EXISTS idx_ip_resources_source ON ip_resources (source_entity_type, source_entity_id);

            CREATE TABLE IF NOT EXISTS assignment_details (
              id TEXT PRIMARY KEY,
              resource_uuid TEXT NOT NULL,
              version_uuid TEXT NOT NULL,
              assignment_type TEXT NOT NULL,
              assignment_date TEXT NOT NULL,
              customer_name TEXT NOT NULL,
              commercial_reg_id TEXT NOT NULL,
              unified_number TEXT NOT NULL,
              contact_number TEXT NOT NULL,
              contact_email TEXT NOT NULL,
              city TEXT NOT NULL,
              region TEXT NOT NULL,
              contact_name TEXT NOT NULL,
              service_instance_id TEXT NOT NULL,
              service_instance_name TEXT NOT NULL,
              service_type TEXT NOT NULL,
              service_category TEXT NOT NULL,
              l3_service TEXT NOT NULL,
              service TEXT NOT NULL,
              owner TEXT NOT NULL,
              purpose TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(resource_uuid) REFERENCES ip_resources(resource_uuid)
            );

            CREATE INDEX IF NOT EXISTS idx_assignment_details_customer ON assignment_details (customer_name);
            CREATE INDEX IF NOT EXISTS idx_assignment_details_resource ON assignment_details (resource_uuid);

            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

            CREATE TABLE IF NOT EXISTS audit_events (
              id TEXT PRIMARY KEY,
              user TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              action TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              old_value TEXT NOT NULL,
              new_value TEXT NOT NULL,
              source_system TEXT NOT NULL DEFAULT 'ipam-core-services',
              request_id TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events (timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events (entity_type, entity_id);

            CREATE TABLE IF NOT EXISTS bulk_batches (
              id TEXT PRIMARY KEY,
              operation_type TEXT NOT NULL,
              status TEXT NOT NULL,
              file_name TEXT NOT NULL,
              total_rows INTEGER NOT NULL,
              success_count INTEGER NOT NULL,
              failure_count INTEGER NOT NULL,
              imported_count INTEGER NOT NULL,
              blocked_count INTEGER NOT NULL,
              started_at TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              duration_ms INTEGER NOT NULL,
              error_summary TEXT NOT NULL,
              result_json TEXT NOT NULL,
              created_by TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_bulk_batches_started ON bulk_batches (started_at);
            CREATE INDEX IF NOT EXISTS idx_bulk_batches_status ON bulk_batches (status);

            CREATE TABLE IF NOT EXISTS ripe_config (
              id TEXT PRIMARY KEY,
              base_url TEXT NOT NULL,
              auth_type TEXT NOT NULL,
              username TEXT NOT NULL,
              encrypted_password TEXT NOT NULL,
              connection_timeout INTEGER NOT NULL,
              read_timeout INTEGER NOT NULL,
              default_maintainer TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ripe_allocated_pools (
              id TEXT PRIMARY KEY,
              pool_name TEXT NOT NULL,
              cidr TEXT NOT NULL UNIQUE,
              start_ip TEXT NOT NULL,
              end_ip TEXT NOT NULL,
              allocation_type TEXT NOT NULL,
              source TEXT NOT NULL,
              created_date TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ripe_allocated_pools_cidr ON ripe_allocated_pools (cidr);
            CREATE INDEX IF NOT EXISTS idx_ripe_allocated_pools_created ON ripe_allocated_pools (created_date);

            CREATE TABLE IF NOT EXISTS cst_config (
              id TEXT PRIMARY KEY,
              enabled INTEGER NOT NULL,
              service_provider_id TEXT NOT NULL,
              auto_execute INTEGER NOT NULL,
              scheduled_sync_enabled INTEGER NOT NULL DEFAULT 1,
              schedule_time TEXT NOT NULL DEFAULT '00:30',
              schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
              last_scheduled_run_date TEXT NOT NULL DEFAULT '',
              last_scheduled_run_at TEXT NOT NULL DEFAULT '',
              batch_size_limit INTEGER NOT NULL,
              hourly_request_limit INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cst_sync_batches (
              id TEXT PRIMARY KEY,
              workflow_type TEXT NOT NULL,
              status TEXT NOT NULL,
              total_jobs INTEGER NOT NULL,
              completed_jobs INTEGER NOT NULL,
              failed_jobs INTEGER NOT NULL,
              blocked_jobs INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              completed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cst_sync_jobs (
              id TEXT PRIMARY KEY,
              batch_id TEXT NOT NULL,
              resource_uuid TEXT NOT NULL,
              transaction_id TEXT NOT NULL,
              operation TEXT NOT NULL,
              sequence_no INTEGER NOT NULL,
              depends_on_job_id TEXT NOT NULL,
              cidr TEXT NOT NULL,
              service_provider_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              response_json TEXT NOT NULL,
              status TEXT NOT NULL,
              attempt_count INTEGER NOT NULL,
              last_error TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cst_transaction_ledger (
              transaction_id TEXT PRIMARY KEY,
              cidr TEXT NOT NULL,
              resource_uuid TEXT NOT NULL,
              service_provider_id TEXT NOT NULL,
              first_used_at TEXT NOT NULL,
              last_status TEXT NOT NULL,
              retired_at TEXT NOT NULL,
              retired_reason TEXT NOT NULL,
              batch_id TEXT NOT NULL,
              correlation_id TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cst_batches_created ON cst_sync_batches (created_at);
            CREATE INDEX IF NOT EXISTS idx_cst_batches_status ON cst_sync_batches (status);
            CREATE INDEX IF NOT EXISTS idx_cst_jobs_batch ON cst_sync_jobs (batch_id);
            CREATE INDEX IF NOT EXISTS idx_cst_jobs_status ON cst_sync_jobs (status);
            CREATE INDEX IF NOT EXISTS idx_cst_jobs_transaction ON cst_sync_jobs (transaction_id);
            CREATE INDEX IF NOT EXISTS idx_cst_ledger_cidr ON cst_transaction_ledger (cidr);
            CREATE INDEX IF NOT EXISTS idx_cst_ledger_status ON cst_transaction_ledger (last_status);
            CREATE INDEX IF NOT EXISTS idx_cst_ledger_resource ON cst_transaction_ledger (resource_uuid);

            CREATE TABLE IF NOT EXISTS cst_scheduler_runs (
              id TEXT PRIMARY KEY,
              target_date TEXT NOT NULL UNIQUE,
              scheduled_for TEXT NOT NULL,
              status TEXT NOT NULL,
              batch_id TEXT NOT NULL,
              total_jobs INTEGER NOT NULL,
              message TEXT NOT NULL,
              triggered_by TEXT NOT NULL,
              started_at TEXT NOT NULL,
              completed_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cst_scheduler_runs_started ON cst_scheduler_runs (started_at);
                    """
                )
        add_missing_columns(connection, "cst_config", CstConfig)
        migrate_legacy_cst_transaction_ids(connection)

        cst_config_count = connection.execute("SELECT COUNT(*) FROM cst_config").fetchone()[0]
        if cst_config_count == 0:
            connection.execute(
                """
                INSERT INTO cst_config (
                  id, enabled, service_provider_id, auto_execute, scheduled_sync_enabled,
                  schedule_time, schedule_timezone, last_scheduled_run_date, last_scheduled_run_at,
                  batch_size_limit, hourly_request_limit, updated_at
                )
                VALUES ('default', 1, ?, 1, 1, '00:30', 'Asia/Riyadh', '', '', 500, 1000, ?)
                """,
                (DEFAULT_SERVICE_PROVIDER_ID, now_iso()),
            )

        user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count == 0:
            salt, password_hash = hash_password("Adminirshad@324")
            connection.execute(
                """
                INSERT INTO users (id, username, password_salt, password_hash, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (f"user-{uuid4().hex[:10]}", "ipam-admin", salt, password_hash, "admin", "Active", now_iso()),
            )

        if normalized_inventory_needs_sync(connection):
            sync_normalized_inventory(connection)


def list_pools_from_db() -> list[Pool]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM pools ORDER BY created_at DESC").fetchall()
    return [pool_from_row(row) for row in rows]


def parse_reserved_until(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def release_expired_reservations(connection: sqlite3.Connection) -> int:
    now = datetime.now(timezone.utc)
    rows = connection.execute(
        "SELECT * FROM assignments WHERE status = 'Reserved' AND reserved_until IS NOT NULL AND reserved_until != ''"
    ).fetchall()
    released = 0
    for row in rows:
        assignment = assignment_from_row(row)
        reserved_until = parse_reserved_until(assignment.reserved_until)
        if not reserved_until or reserved_until > now:
            continue
        resource = find_resource_by_source(connection, "assignment", assignment.id)
        connection.execute("DELETE FROM assignments WHERE id = ?", (assignment.id,))
        if resource:
            connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (resource.resource_uuid,))
            connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (resource.resource_uuid,))
        record_audit(
            connection,
            "Reservation Auto Release",
            "assignment",
            assignment.id,
            assignment.model_dump_json(),
            f"Reserved until {assignment.reserved_until} expired; released to available subnet inventory",
        )
        released += 1
    return released


def list_assignments_from_db() -> list[Assignment]:
    with connect() as connection:
        release_expired_reservations(connection)
        rows = connection.execute("SELECT * FROM assignments ORDER BY created_at DESC").fetchall()
    return [assignment_from_row(row) for row in rows]


def find_pool(identifier: str | None, cidr: str | None) -> Pool:
    normalized_cidr = str(normalize_network(cidr)) if cidr else None
    with connect() as connection:
        row = None
        if identifier:
            row = connection.execute("SELECT * FROM pools WHERE id = ?", (identifier,)).fetchone()
        if row is None and normalized_cidr:
            row = connection.execute("SELECT * FROM pools WHERE cidr = ?", (normalized_cidr,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Pool not found")
    return pool_from_row(row)


def find_assignment(assignment_id: str) -> Assignment:
    with connect() as connection:
        row = connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return assignment_from_row(row)


def free_ranges_for_pool(pool: Pool, assignments: list[Assignment]) -> list[PoolRange]:
    pool_network = network_of(pool)
    ranges: list[PoolRange] = []
    for start, end in free_intervals_for_network(pool_network, assignments):
        for network in summarize_address_range(start, end):
            ranges.append(
                PoolRange(
                    cidr=str(network),
                    kind="unassigned",
                    size=network.num_addresses,
                    start=str(network.network_address),
                    end=str(network.broadcast_address),
                )
            )
            if len(ranges) >= 512:
                return ranges
    return ranges


def free_intervals_for_network(pool_network: IPv4Network, assignments: list[Assignment]) -> list[tuple[IPv4Address, IPv4Address]]:
    contained = sorted(
        (
            assignment
            for assignment in assignments
            if not assignment_released_after_ripe_removal(assignment) and network_of(assignment).subnet_of(pool_network)
        ),
        key=lambda assignment: int(network_of(assignment).network_address),
    )
    free_intervals: list[tuple[IPv4Address, IPv4Address]] = []
    cursor = pool_network.network_address

    for assignment in contained:
        assigned_network = network_of(assignment)
        if int(assigned_network.network_address) > int(cursor):
            free_intervals.append((cursor, IPv4Address(int(assigned_network.network_address) - 1)))
        next_cursor = IPv4Address(int(assigned_network.broadcast_address) + 1)
        if int(next_cursor) > int(cursor):
            cursor = next_cursor

    if int(cursor) <= int(pool_network.broadcast_address):
        free_intervals.append((cursor, pool_network.broadcast_address))

    return free_intervals


def assigned_ranges_for_pool(pool: Pool, assignments: list[Assignment]) -> list[PoolRange]:
    pool_network = network_of(pool)
    ranges: list[PoolRange] = []
    for assignment in assignments:
        if assignment_released_after_ripe_removal(assignment):
            continue
        assignment_network = network_of(assignment)
        if assignment_network.subnet_of(pool_network):
            ranges.append(
                PoolRange(
                    cidr=assignment.cidr,
                    kind="assigned",
                    size=assignment.size,
                    start=assignment.start,
                    end=assignment.end,
                    status=assignment.status,
                    assignment_id=assignment.id,
                    customer_name=assignment.customer_name,
                    l3_service=assignment.l3_service,
                    assignment_date=assignment.assignment_date,
                )
            )
    return sorted(ranges, key=lambda item: int(normalize_network(item.cidr).network_address))


def user_from_row(row: sqlite3.Row) -> UserOut:
    return UserOut(
        id=row["id"],
        username=row["username"],
        role=row["role"],
        status=row["status"],
        created_at=row["created_at"],
    )


def list_users_from_db() -> list[UserOut]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
    return [user_from_row(row) for row in rows]


def csv_rows(csv_text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(StringIO(csv_text.strip()))
    if not reader.fieldnames:
        return []
    return [{key: (value or "").strip() for key, value in row.items()} for row in reader]


def csv_data_row_count(csv_text: str) -> int:
    lines = [line for line in csv_text.splitlines() if line.strip()]
    return max(0, len(lines) - 1)


def csv_value(row: dict[str, str], *keys: str) -> str:
    normalized = {key.lower(): value for key, value in row.items()}
    for key in keys:
        value = normalized.get(key.lower())
        if value is not None:
            return value.strip()
    return ""


def parse_ipv4(value: str, label: str) -> IPv4Address:
    try:
        return IPv4Address(value.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {value}") from exc


def pool_networks_from_bulk_row(row: dict[str, str]) -> tuple[list[IPv4Network], str, str]:
    cidr = csv_value(row, "cidr")
    if cidr:
        return [normalize_network(cidr)], csv_value(row, "name") or "Bulk imported pool", csv_value(row, "region") or "Unassigned region"

    start_value = csv_value(row, "StartIP", "start_ip", "start")
    end_value = csv_value(row, "EndIP", "end_ip", "end")
    total_value = csv_value(row, "Total", "total")
    if not start_value and not end_value and not total_value:
        raise HTTPException(status_code=400, detail="Missing required pool columns. Use either cidr,name,region or StartIP,EndIP,Total")
    if not start_value or not end_value or not total_value:
        raise HTTPException(status_code=400, detail="Range import requires StartIP, EndIP, and Total")

    start_ip = parse_ipv4(start_value, "StartIP")
    end_ip = parse_ipv4(end_value, "EndIP")
    if int(start_ip) > int(end_ip):
        raise HTTPException(status_code=400, detail=f"StartIP {start_ip} must be less than or equal to EndIP {end_ip}")

    try:
        expected_total = int(total_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Total must be a whole number: {total_value}") from exc
    actual_total = int(end_ip) - int(start_ip) + 1
    if expected_total != actual_total:
        raise HTTPException(status_code=400, detail=f"Total {expected_total} does not match StartIP-EndIP size {actual_total}")

    networks = list(summarize_address_range(start_ip, end_ip))
    return networks, csv_value(row, "name") or f"Bulk range {start_ip}-{end_ip}", csv_value(row, "region") or "Unassigned region"


def ripe_allocated_pool_from_payload(payload: RipeAllocatedPoolCreate) -> RipeAllocatedPool:
    network = normalize_network(payload.cidr)
    start_ip = payload.start_ip or str(network.network_address)
    end_ip = payload.end_ip or str(network.broadcast_address)
    if parse_ipv4(start_ip, "start_ip") != network.network_address:
        raise HTTPException(status_code=400, detail=f"start_ip must match CIDR network address {network.network_address}")
    if parse_ipv4(end_ip, "end_ip") != network.broadcast_address:
        raise HTTPException(status_code=400, detail=f"end_ip must match CIDR broadcast address {network.broadcast_address}")
    return RipeAllocatedPool(
        id=f"ripe-pool-{uuid4().hex[:12]}",
        pool_name=payload.pool_name or f"RIPE allocation {network}",
        cidr=str(network),
        start_ip=start_ip,
        end_ip=end_ip,
        allocation_type=payload.allocation_type or "RIPE Allocated Pool",
        source=payload.source or "RIPE Database",
        created_date=payload.created_date or datetime.now(timezone.utc).date().isoformat(),
        created_at=now_iso(),
    )


def ripe_allocated_pool_payload_from_row(row: dict[str, str]) -> RipeAllocatedPoolCreate:
    cidr = csv_value(row, "cidr", "CIDR", "allocation", "Allocation")
    start_ip = csv_value(row, "start_ip", "StartIP", "startIp", "start")
    end_ip = csv_value(row, "end_ip", "EndIP", "endIp", "end")
    if not cidr:
        if not start_ip or not end_ip:
            raise HTTPException(status_code=400, detail="RIPE allocated pool rows require cidr or start_ip/end_ip")
        start = parse_ipv4(start_ip, "start_ip")
        end = parse_ipv4(end_ip, "end_ip")
        networks = list(summarize_address_range(start, end))
        if len(networks) != 1:
            raise HTTPException(status_code=400, detail=f"RIPE allocated pool range {start}-{end} must describe one CIDR")
        cidr = str(networks[0])
    return RipeAllocatedPoolCreate(
        pool_name=csv_value(row, "pool_name", "Pool Name", "name", "netname") or f"RIPE allocation {cidr}",
        cidr=cidr,
        start_ip=start_ip,
        end_ip=end_ip,
        allocation_type=csv_value(row, "allocation_type", "Allocation Type") or "RIPE Allocated Pool",
        source=csv_value(row, "source", "Source") or "RIPE Database",
        created_date=csv_value(row, "created_date", "Created Date", "createdDate") or datetime.now(timezone.utc).date().isoformat(),
    )


def attributes_by_name(ripe_object: dict) -> dict[str, str]:
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
    if " - " not in value:
        return ""
    start_value, end_value = value.split(" - ", 1)
    try:
        start_ip = IPv4Address(start_value.strip())
        end_ip = IPv4Address(end_value.strip())
    except ValueError:
        return ""
    return ", ".join(str(network) for network in summarize_address_range(start_ip, end_ip))


def inetnum_range(value: str) -> tuple[IPv4Address, IPv4Address] | None:
    if " - " not in value:
        return None
    start_value, end_value = value.split(" - ", 1)
    try:
        return IPv4Address(start_value.strip()), IPv4Address(end_value.strip())
    except ValueError:
        return None


def inetnum_in_pool(value: str, pool: RipeAllocatedPool) -> bool:
    parsed = inetnum_range(value)
    if parsed is None:
        return False
    start_ip, end_ip = parsed
    try:
        pool_start = IPv4Address(pool.start_ip)
        pool_end = IPv4Address(pool.end_ip)
    except ValueError:
        return False
    return int(pool_start) <= int(start_ip) and int(end_ip) <= int(pool_end)


def cidr_for_root_range(start_ip: IPv4Address, end_ip: IPv4Address) -> str:
    networks = list(summarize_address_range(start_ip, end_ip))
    return str(networks[0]) if len(networks) == 1 else ", ".join(str(network) for network in networks)


def cidr_parts(value: str) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def update_tag_string(tags: str, updates: dict[str, str]) -> str:
    pairs: dict[str, str] = {}
    for part in str(tags or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        if key:
            pairs[key] = value.strip()
    pairs.update({key: value for key, value in updates.items() if key})
    return ";".join(f"{key}={value}" for key, value in pairs.items())


def ripe_objects_to_rows(objects: list[dict]) -> list[dict[str, str | int]]:
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


def query_ripe_objects_by_inverse(config_row: sqlite3.Row, inverse_attribute: str, maintainer: str, include_no_referenced: bool = True) -> tuple[list[dict], str]:
    base_url = str(config_row["base_url"]).rstrip("/")
    query_params = {
        "source": "ripe",
        "type-filter": "inetnum",
        "inverse-attribute": inverse_attribute,
        "query-string": maintainer,
    }
    if include_no_referenced:
        query_params["flags"] = "no-referenced"
    query = urlencode(query_params)
    request = Request(f"{base_url}/search.json?{query}", headers={"Accept": "application/json"})
    username = str(config_row["username"] or "")
    password = decrypt_secret(str(config_row["encrypted_password"] or ""))
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        request.add_header("Authorization", f"Basic {token}")
    try:
        with urlopen(request, timeout=max(1, int(config_row["read_timeout"]))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"{inverse_attribute} query failed: {exc}"
    return payload.get("objects", {}).get("object", []), f"{inverse_attribute} query returned {len(payload.get('objects', {}).get('object', []))} inetnum objects"




def discovered_root_pools(config_row: sqlite3.Row) -> RipeDiscoveryResponse:
    maintainer = str(config_row["default_maintainer"] or "ITC-NOC-MNT")
    mnt_by_objects, mnt_by_message = query_ripe_objects_by_inverse(config_row, "mnt-by", maintainer, include_no_referenced=False)
    mnt_lower_objects, mnt_lower_message = query_ripe_objects_by_inverse(config_row, "mnt-lower", maintainer, include_no_referenced=False)
    by_inetnum: dict[str, dict] = {}
    for ripe_object in [*mnt_by_objects, *mnt_lower_objects]:
        values = attributes_by_name(ripe_object)
        inetnum = values.get("inetnum", "")
        parsed = inetnum_range(inetnum)
        if parsed is None:
            continue
        by_inetnum[inetnum] = ripe_object

    candidates: list[tuple[int, int, dict, dict[str, str]]] = []
    for ripe_object in by_inetnum.values():
        values = attributes_by_name(ripe_object)
        parsed = inetnum_range(values.get("inetnum", ""))
        if parsed is None:
            continue
        start_ip, end_ip = parsed
        candidates.append((int(start_ip), int(end_ip), ripe_object, values))

    # Largest ranges first; when equal, keep stable address order. Any later range fully
    # contained in a retained larger range is a child/subnet, not a RIPE root pool.
    candidates.sort(key=lambda item: (-(item[1] - item[0] + 1), item[0], item[1]))
    roots: list[tuple[int, int, dict, dict[str, str]]] = []
    for start, end, ripe_object, values in candidates:
        if any(root_start <= start and end <= root_end for root_start, root_end, _root_object, _root_values in roots):
            continue
        roots.append((start, end, ripe_object, values))
    roots.sort(key=lambda item: (item[0], item[1]))

    current_discovery_cidrs = {part for start, end, _ripe_object, _values in roots for part in cidr_parts(cidr_for_root_range(IPv4Address(start), IPv4Address(end)))}
    discovery_time = now_iso()
    with connect() as connection:
        pool_rows = connection.execute("SELECT id, cidr, created_at, last_audit_at, source_system, tags FROM pools").fetchall()
        for row in pool_rows:
            if row["source_system"] != "RIPE IP Pools Discovery":
                continue
            presence = "Current" if row["cidr"] in current_discovery_cidrs else "Stale"
            connection.execute(
                "UPDATE pools SET tags = ?, last_audit_at = ? WHERE id = ?",
                (
                    update_tag_string(
                        str(row["tags"] or ""),
                        {
                            "ripe_discovery_presence": presence,
                            "ripe_discovery_seen_at": discovery_time if presence == "Current" else str(row["last_audit_at"] or ""),
                            "ripe_discovery_checked_at": discovery_time,
                        },
                    ),
                    discovery_time,
                    row["id"],
                ),
            )
        resource_rows = connection.execute(
            "SELECT source_entity_id, cst_sync_status FROM ip_resources WHERE source_entity_type = 'pool'"
        ).fetchall()
    local_by_cidr = {row["cidr"]: row for row in pool_rows}
    cst_by_pool_id = {row["source_entity_id"]: row["cst_sync_status"] for row in resource_rows}

    rows: list[RipeDiscoveredRootPool] = []
    for start, end, ripe_object, values in roots:
        start_ip = IPv4Address(start)
        end_ip = IPv4Address(end)
        cidr = cidr_for_root_range(start_ip, end_ip)
        parts = cidr_parts(cidr)
        local_rows = [local_by_cidr[part] for part in parts if part in local_by_cidr]
        all_synced = bool(parts) and len(local_rows) == len(parts)
        local_sync_status = "LIR Synced" if all_synced else "Partially Synced" if local_rows else "Not Synced"
        cst_statuses = [str(cst_by_pool_id.get(row["id"], "PENDING")) for row in local_rows]
        all_cst_synced = all_synced and bool(cst_statuses) and all(status == "SUCCESS" for status in cst_statuses)
        any_cst_synced = any(status == "SUCCESS" for status in cst_statuses)
        cst_sync_status = "CST Synced" if all_cst_synced else "Partially Synced" if any_cst_synced else "Not Synced"
        last_sync_date = ""
        if local_rows:
            last_sync_date = max(str(row["last_audit_at"] or row["created_at"]) for row in local_rows)
        rows.append(
            RipeDiscoveredRootPool(
                pool_name=values.get("netname") or f"RIPE Root Pool {cidr}",
                allocation_range=f"{start_ip} - {end_ip}",
                cidr=cidr,
                total_ips=end - start + 1,
                start_ip=str(start_ip),
                end_ip=str(end_ip),
                ripe_maintainer=maintainer,
                ripe_status=values.get("status", ""),
                source="RIPE Database",
                local_sync_status=local_sync_status,
                cst_sync_status=cst_sync_status,
                last_sync_date=last_sync_date,
                object_href=str(ripe_object.get("link", {}).get("href", "")),
            )
        )
    return RipeDiscoveryResponse(
        maintainer=maintainer,
        rows=rows,
        message=f"{mnt_by_message}; {mnt_lower_message}. Merged and de-duplicated maintainer inetnum objects, sorted largest ranges first, then retained {len(rows)} RIPE root pools after containment filtering for maintainer {maintainer}.",
    )


def query_ripe_inetnum_rows(pool: RipeAllocatedPool, config_row: sqlite3.Row) -> tuple[list[dict[str, str | int]], str]:
    base_url = str(config_row["base_url"]).rstrip("/")
    query = urlencode(
        {
            "source": "ripe",
            "type-filter": "inetnum",
            "flags": ["M", "no-referenced"],
            "query-string": f"{pool.start_ip} - {pool.end_ip}",
        },
        doseq=True,
    )
    request = Request(f"{base_url}/search.json?{query}", headers={"Accept": "application/json"})
    username = str(config_row["username"] or "")
    password = decrypt_secret(str(config_row["encrypted_password"] or ""))
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        request.add_header("Authorization", f"Basic {token}")
    try:
        with urlopen(request, timeout=max(1, int(config_row["read_timeout"]))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"RIPE Database query did not complete: {exc}"

    rows = ripe_objects_to_rows(payload.get("objects", {}).get("object", []))
    return rows, f"Retrieved {len(rows)} RIPE inetnum rows from {base_url} for {pool.start_ip} - {pool.end_ip}."


def query_ripe_mnt_lower_rows(pool: RipeAllocatedPool, config_row: sqlite3.Row) -> tuple[list[dict[str, str | int]], str]:
    base_url = str(config_row["base_url"]).rstrip("/")
    maintainer = str(config_row["default_maintainer"] or "ITC-NOC-MNT")
    query = urlencode(
        {
            "source": "ripe",
            "type-filter": "inetnum",
            "inverse-attribute": "mnt-lower",
            "query-string": maintainer,
        }
    )
    request = Request(f"{base_url}/search.json?{query}", headers={"Accept": "application/json"})
    username = str(config_row["username"] or "")
    password = decrypt_secret(str(config_row["encrypted_password"] or ""))
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        request.add_header("Authorization", f"Basic {token}")
    try:
        with urlopen(request, timeout=max(1, int(config_row["read_timeout"]))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return [], f"RIPE Database mnt-lower query did not complete: {exc}"

    all_rows = ripe_objects_to_rows(payload.get("objects", {}).get("object", []))
    rows = [row for row in all_rows if inetnum_in_pool(str(row.get("inetnum", "")), pool)]
    return (
        rows,
        f"Retrieved {len(rows)} of {len(all_rows)} RIPE inetnum rows for mnt-lower {maintainer} within {pool.start_ip} - {pool.end_ip}.",
    )

def ripe_inetnum_classification(status: str) -> str:
    normalized = str(status or "").strip().upper()
    return "ASSIGNMENT" if normalized.startswith("ASSIGNED") else "ALLOCATION"


def query_ripe_assignment_rows_by_maintainer(config_row: sqlite3.Row) -> tuple[list[dict[str, str | int]], str]:
    maintainer = str(config_row["default_maintainer"] or "ITC-NOC-MNT")
    ripe_objects, message = query_ripe_objects_by_inverse(config_row, "mnt-by", maintainer)
    source_rows = ripe_objects_to_rows(ripe_objects)
    assignment_rows: list[dict[str, str | int]] = []
    for row in source_rows:
        classification = ripe_inetnum_classification(str(row.get("status", "")))
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

def ripe_netname_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_]+", "_", str(value or "").strip().upper())
    token = re.sub(r"_+", "_", token).strip("_")
    return token or "LIR_ASSIGNMENT"


def ripe_assignment_description(assignment: Assignment) -> str:
    target_type = str(getattr(assignment, "assignment_target_type", "") or "").lower()
    if "customer" in target_type:
        return "Assigned to Customer"
    return (
        str(getattr(assignment, "assignment_description", "") or "").strip()
        or str(getattr(assignment, "service_description", "") or "").strip()
        or "Assigned to Customer"
    )


def ripe_assignment_object(assignment: Assignment, maintainer: str) -> dict:
    organization_name = assignment.organization_name or assignment.customer_name or assignment.assignment_name or assignment.cidr
    ripe_name = ripe_netname_token(organization_name)
    ripe_description = ripe_assignment_description(assignment)
    return {
        "objects": {
            "object": [
                {
                    "type": "inetnum",
                    "attributes": {
                        "attribute": [
                            {"name": "inetnum", "value": f"{assignment.start} - {assignment.end}"},
                            {"name": "netname", "value": ripe_name},
                            {"name": "descr", "value": ripe_description},
                            {"name": "country", "value": "SA"},
                            {"name": "admin-c", "value": "IR1052-RIPE"},
                            {"name": "tech-c", "value": "IR1052-RIPE"},
                            {"name": "status", "value": "ASSIGNED PA"},
                            {"name": "mnt-by", "value": maintainer or DEFAULT_SERVICE_PROVIDER_NAME},
                            {"name": "source", "value": "RIPE"},
                        ]
                    },
                }
            ]
        }
    }


def post_ripe_assignment(assignment: Assignment, config_row: sqlite3.Row) -> tuple[bool, int, str, str, dict]:
    username = str(config_row["username"] or "")
    password = decrypt_secret(str(config_row["encrypted_password"] or ""))
    request_object = ripe_assignment_object(assignment, str(config_row["default_maintainer"] or "ITC-NOC-MNT"))
    if not username or not password:
        return False, 0, "RIPE username/password is not configured", "", request_object

    base_url = str(config_row["base_url"]).rstrip("/")
    request = Request(
        f"{base_url}/ripe/inetnum",
        data=json.dumps(request_object).encode("utf-8"),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {token}")
    try:
        with urlopen(request, timeout=max(1, int(config_row["read_timeout"]))) as response:
            body = response.read().decode("utf-8", errors="replace")
            status_code = int(response.status)
            return 200 <= status_code < 300, status_code, "RIPE assignment object created", body, request_object
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return False, int(exc.code), f"RIPE push failed with HTTP {exc.code}", body, request_object
    except (URLError, TimeoutError, ValueError) as exc:
        return False, 0, f"RIPE push failed: {exc}", "", request_object


def delete_ripe_assignment(assignment: Assignment, config_row: sqlite3.Row) -> tuple[bool, int, str, str, dict]:
    username = str(config_row["username"] or "")
    password = decrypt_secret(str(config_row["encrypted_password"] or ""))
    inetnum = f"{assignment.start} - {assignment.end}"
    base_url = str(config_row["base_url"]).rstrip("/")
    delete_url = f"{base_url}/ripe/inetnum/{quote(inetnum, safe='')}"
    request_object = {"method": "DELETE", "url": delete_url, "inetnum": inetnum}
    if not username or not password:
        return False, 0, "RIPE username/password is not configured", "", request_object

    request = Request(
        delete_url,
        method="DELETE",
        headers={"Accept": "application/json"},
    )
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {token}")
    try:
        with urlopen(request, timeout=max(1, int(config_row["read_timeout"]))) as response:
            body = response.read().decode("utf-8", errors="replace")
            status_code = int(response.status)
            return 200 <= status_code < 300, status_code, "RIPE assignment object removed", body, request_object
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return False, int(exc.code), f"RIPE removal failed with HTTP {exc.code}", body, request_object
    except (URLError, TimeoutError, ValueError) as exc:
        return False, 0, f"RIPE removal failed: {exc}", "", request_object


def bulk_assignment_networks_from_row(row: dict[str, str]) -> tuple[list[IPv4Network], bool]:
    cidr = csv_value(row, "cidr")
    size_value = csv_value(row, "size", "Total", "total")
    start_value = csv_value(row, "startIp", "StartIP", "start_ip", "start")
    end_value = csv_value(row, "endIp", "EndIP", "end_ip", "end")
    is_pr_format = bool(size_value and (cidr or (start_value and end_value)))

    if cidr:
        network = normalize_network(cidr)
        if size_value:
            try:
                expected_size = int(size_value)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"size must be a whole number: {size_value}") from exc
            if expected_size != network.num_addresses:
                raise HTTPException(status_code=400, detail=f"size {expected_size} does not match CIDR size {network.num_addresses}")
        return [network], is_pr_format

    if not start_value or not end_value:
        raise HTTPException(status_code=400, detail="Missing required assignment columns. Use cidr,size,status,assignmentDate,customerName or startIp,endIp,size,status,assignmentDate,customerName")
    if not size_value:
        raise HTTPException(status_code=400, detail="Range assignment import requires size")

    start_ip = parse_ipv4(start_value, "startIp")
    end_ip = parse_ipv4(end_value, "endIp")
    if int(start_ip) > int(end_ip):
        raise HTTPException(status_code=400, detail=f"startIp {start_ip} must be less than or equal to endIp {end_ip}")

    try:
        expected_size = int(size_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"size must be a whole number: {size_value}") from exc
    actual_size = int(end_ip) - int(start_ip) + 1
    if expected_size != actual_size:
        raise HTTPException(status_code=400, detail=f"size {expected_size} does not match calculated IP count {actual_size}")
    return list(summarize_address_range(start_ip, end_ip)), is_pr_format


def bulk_assignment_status(row: dict[str, str], is_pr_format: bool) -> tuple[int, str]:
    status_value = csv_value(row, "status")
    if not status_value:
        status_id = 3
    else:
        status_id = normalize_assignment_status_id(status_value)
    assignment_status = "Reserved" if status_id == 1 else "Active"
    return status_id, assignment_status


def assignment_payload_from_bulk_row(row: dict[str, str], network: IPv4Network, assignment_status_id: int, assignment_status: str) -> AssignmentCreate:
    assignment_date = csv_value(row, "assignmentDate", "assignment_date")
    customer_name = csv_value(row, "customerName", "customer_name", "organizationName", "organization_name", "fullName", "full_name")
    service_id = csv_value(row, "serviceId", "service_id", "service_instance_id")
    service_description = csv_value(row, "serviceDescription", "service_description", "service")
    if not assignment_date:
        raise HTTPException(status_code=400, detail="assignmentDate is mandatory")
    if assignment_status_id == 3 and not service_id:
        raise HTTPException(status_code=400, detail="serviceId is mandatory when assignmentStatusId = 3 (Business)")
    if assignment_status_id == 2 and not service_description:
        raise HTTPException(status_code=400, detail="serviceDescription is mandatory when assignmentStatusId = 2 (Internal)")
    customer_name = customer_name or assignment_status_id_name(assignment_status_id)
    target_type = "internal" if assignment_status_id == 2 else "business_customer"
    if assignment_status_id == 4:
        target_type = "individual"
    return AssignmentCreate(
        cidr=str(network),
        assignment_status_id=assignment_status_id,
        assignment_target_type=target_type,
        service_id=service_id,
        service_instance_id=service_id,
        customer_name=customer_name,
        organization_name=csv_value(row, "organizationName", "organization_name"),
        organization_id=csv_value(row, "organizationId", "organization_id"),
        customer_type_id=csv_value(row, "customerTypeId", "customer_type_id"),
        region_id=csv_value(row, "regionId", "region_id"),
        city_id=csv_value(row, "cityId", "city_id"),
        full_name=csv_value(row, "fullName", "full_name"),
        mobile_number=csv_value(row, "mobileNumber", "mobile_number"),
        id_number=csv_value(row, "idNumber", "id_number"),
        email=csv_value(row, "email"),
        commercial_reg_id=csv_value(row, "commercial_reg_id", "commercialRegId") or "N/A",
        unified_number=csv_value(row, "unified_number", "unifiedNumber") or "N/A",
        contact_number=csv_value(row, "contact_number", "contactNumber") or "N/A",
        city=csv_value(row, "city") or "N/A",
        region=csv_value(row, "region") or "N/A",
        contact_name=csv_value(row, "contact_name", "contactName") or "N/A",
        l3_service=csv_value(row, "l3_service", "l3Service") or "MPLS L3VPN",
        service=service_description or "L3 service allocation",
        service_description=service_description,
        access_technology_id=csv_value(row, "accessTechnologyId", "access_technology_id"),
        access_technology=csv_value(row, "accessTechnology", "access_technology"),
        owner=csv_value(row, "owner") or "Network service desk",
        site=csv_value(row, "site") or "Unassigned site",
        environment=csv_value(row, "environment") or "Production",
        status=assignment_status,
        assignment_date=assignment_date,
        notes=csv_value(row, "notes"),
    )


def validate_parent_pool(candidate: IPv4Network, excluded_pool_ids: set[str] | None = None) -> None:
    excluded_pool_ids = excluded_pool_ids or set()
    for pool in list_pools_from_db():
        if pool.id in excluded_pool_ids:
            continue
        if candidate.overlaps(network_of(pool)):
            raise HTTPException(status_code=409, detail=f"{candidate} overlaps parent pool {pool.cidr}")


def validate_assignment(candidate: IPv4Network) -> None:
    parent = next(
        (
            pool
            for pool in list_pools_from_db()
            if candidate.subnet_of(network_of(pool)) and candidate.prefixlen >= network_of(pool).prefixlen
        ),
        None,
    )
    if parent is None:
        raise HTTPException(status_code=409, detail=f"{candidate} is outside managed parent pools")

    for assignment in list_assignments_from_db():
        if assignment_released_after_ripe_removal(assignment):
            continue
        if candidate.overlaps(network_of(assignment)):
            raise HTTPException(
                status_code=409,
                detail=f"{candidate} overlaps {assignment.customer_name} allocation {assignment.cidr}",
            )


def active_child_resources(connection: sqlite3.Connection, root_resource_uuid: str) -> list[ResourceRecord]:
    rows = connection.execute(
        """
        SELECT * FROM ip_resources
        WHERE root_pool_uuid = ?
          AND resource_uuid != ?
          AND status IN ('ASSIGNED_TO_BUSINESS', 'RESERVED', 'AVAILABLE')
        """,
        (root_resource_uuid, root_resource_uuid),
    ).fetchall()
    return [resource_from_row(row) for row in rows]


def allocated_child_resources(connection: sqlite3.Connection, root_resource_uuid: str) -> list[ResourceRecord]:
    rows = connection.execute(
        """
        SELECT * FROM ip_resources
        WHERE root_pool_uuid = ?
          AND resource_uuid != ?
          AND status IN ('ASSIGNED_TO_BUSINESS', 'RESERVED')
        """,
        (root_resource_uuid, root_resource_uuid),
    ).fetchall()
    return [resource_from_row(row) for row in rows]


def assert_resource_can_change(connection: sqlite3.Connection, entity_type: str, entity_id: str) -> ResourceRecord | None:
    resource = find_resource_by_source(connection, entity_type, entity_id)
    if resource and resource.status == "RETIRED":
        raise HTTPException(status_code=409, detail=f"Retired CIDR {resource.cidr} cannot be modified")
    return resource


@app.get("/health")
def health() -> dict[str, int | bool | str]:
    with connect() as connection:
        pool_count = connection.execute("SELECT COUNT(*) FROM pools").fetchone()[0]
        assignment_count = connection.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
        resource_count = connection.execute("SELECT COUNT(*) FROM ip_resources").fetchone()[0]
    return {"ok": True, "pools": pool_count, "assignments": assignment_count, "resources": resource_count, "database": str(DB_PATH)}


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(PUBLIC_FAVICON_PATH, media_type="image/png")


@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    with connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    if row is None or row["status"] != "Active" or not verify_password(payload.password, row["password_salt"], row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return LoginResponse(token=f"demo-{uuid4().hex}", username=row["username"], role=row["role"])


@app.get("/users", response_model=list[UserOut])
def list_users() -> list[UserOut]:
    return list_users_from_db()


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate) -> UserOut:
    if payload.role not in {"admin", "operator", "viewer"}:
        raise HTTPException(status_code=400, detail="Role must be admin, operator, or viewer")
    salt, password_hash = hash_password(payload.password)
    user_id = f"user-{uuid4().hex[:10]}"
    try:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO users (id, username, password_salt, password_hash, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, payload.username, salt, password_hash, payload.role, "Active", now_iso()),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    with connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return user_from_row(row)


@app.patch("/users/{user_id}/status", response_model=UserOut)
def update_user_status(user_id: str, payload: StatusUpdate) -> UserOut:
    if payload.status not in {"Active", "Disabled"}:
        raise HTTPException(status_code=400, detail="User status must be Active or Disabled")
    with connect() as connection:
        result = connection.execute("UPDATE users SET status = ? WHERE id = ?", (payload.status, user_id))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return user_from_row(row)


@app.patch("/users/{user_id}/password", response_model=UserOut)
def update_user_password(user_id: str, payload: PasswordUpdate) -> UserOut:
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    salt, password_hash = hash_password(payload.password)
    with connect() as connection:
        result = connection.execute(
            "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?",
            (salt, password_hash, user_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return user_from_row(row)


@app.get("/ripe/config", response_model=RipeConfigOut)
def get_ripe_config() -> RipeConfigOut:
    with connect() as connection:
        row = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="RIPE configuration not initialized")
    return ripe_config_from_row(row)


@app.put("/ripe/config", response_model=RipeConfigOut)
def update_ripe_config(payload: RipeConfigUpdate) -> RipeConfigOut:
    if payload.auth_type != "Basic Authentication":
        raise HTTPException(status_code=400, detail="Only Basic Authentication is supported")
    if payload.connection_timeout <= 0 or payload.read_timeout <= 0:
        raise HTTPException(status_code=400, detail="Timeout values must be greater than zero")
    with connect() as connection:
        existing = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
        encrypted_password = encrypt_secret(payload.password) if payload.password else (existing["encrypted_password"] if existing else "")
        connection.execute(
            """
            INSERT INTO ripe_config (
              id, base_url, auth_type, username, encrypted_password,
              connection_timeout, read_timeout, default_maintainer, updated_at
            )
            VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              base_url = excluded.base_url,
              auth_type = excluded.auth_type,
              username = excluded.username,
              encrypted_password = excluded.encrypted_password,
              connection_timeout = excluded.connection_timeout,
              read_timeout = excluded.read_timeout,
              default_maintainer = excluded.default_maintainer,
              updated_at = excluded.updated_at
            """,
            (
                payload.base_url.rstrip("/"),
                payload.auth_type,
                payload.username,
                encrypted_password,
                payload.connection_timeout,
                payload.read_timeout,
                payload.default_maintainer,
                now_iso(),
            ),
        )
        row = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
        record_audit(connection, "RIPE Configuration Updated", "ripe_config", "default", "", ripe_config_from_row(row).model_dump_json())
    return ripe_config_from_row(row)


@app.get("/ripe/allocated-pools", response_model=list[RipeAllocatedPool])
def list_ripe_allocated_pools() -> list[RipeAllocatedPool]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM ripe_allocated_pools ORDER BY created_date DESC, cidr ASC").fetchall()
    return [ripe_allocated_pool_from_row(row) for row in rows]


@app.post("/ripe/allocated-pools", response_model=RipeAllocatedPool, status_code=201)
def create_ripe_allocated_pool(payload: RipeAllocatedPoolCreate) -> RipeAllocatedPool:
    pool = ripe_allocated_pool_from_payload(payload)
    with connect() as connection:
        try:
            connection.execute(
                """
                INSERT INTO ripe_allocated_pools (
                  id, pool_name, cidr, start_ip, end_ip, allocation_type, source, created_date, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                tuple(pool.model_dump().values()),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail=f"RIPE allocated pool already exists: {pool.cidr}") from exc
        record_audit(connection, "RIPE Allocated Pool Imported", "ripe_allocated_pool", pool.id, "", pool.model_dump_json())
    return pool


@app.post("/ripe/allocated-pools/bulk", response_model=RipeAllocatedPoolBulkResult)
def bulk_import_ripe_allocated_pools(payload: RipeAllocatedPoolBulkRequest) -> RipeAllocatedPoolBulkResult:
    imported: list[RipeAllocatedPool] = []
    errors: list[str] = []
    with connect() as connection:
        for index, row in enumerate(csv_rows(payload.csv_text), start=2):
            try:
                pool = ripe_allocated_pool_from_payload(ripe_allocated_pool_payload_from_row(row))
                connection.execute(
                    """
                    INSERT INTO ripe_allocated_pools (
                      id, pool_name, cidr, start_ip, end_ip, allocation_type, source, created_date, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(cidr) DO UPDATE SET
                      pool_name = excluded.pool_name,
                      start_ip = excluded.start_ip,
                      end_ip = excluded.end_ip,
                      allocation_type = excluded.allocation_type,
                      source = excluded.source,
                      created_date = excluded.created_date
                    """,
                    tuple(pool.model_dump().values()),
                )
                imported.append(pool)
            except HTTPException as exc:
                errors.append(f"row {index}: {exc.detail}")
            except sqlite3.IntegrityError as exc:
                errors.append(f"row {index}: {exc}")
        record_audit(connection, "RIPE Allocated Pool Bulk Import", "ripe_allocated_pool", payload.file_name, "", json.dumps({"imported": len(imported), "errors": errors}))
    return RipeAllocatedPoolBulkResult(imported=len(imported), blocked=len(errors), errors=errors, pools=imported)


@app.post("/ripe/reports/query", response_model=RipeReportResponse)
def query_ripe_report(payload: RipeReportRequest) -> RipeReportResponse:
    with connect() as connection:
        config_row = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
    if config_row is None:
        raise HTTPException(status_code=404, detail="RIPE configuration not initialized")
    config = ripe_config_from_row(config_row)
    rows, message = query_ripe_assignment_rows_by_maintainer(config_row)
    return RipeReportResponse(
        pool=None,
        report_type="RIPE Assignment Report",
        date_from=payload.date_from,
        date_to=payload.date_to,
        maintainer=config.default_maintainer,
        rows=rows,
        message=message,
    )

@app.get("/ripe/discovery/root-pools", response_model=RipeDiscoveryResponse)
def discover_ripe_root_pools() -> RipeDiscoveryResponse:
    with connect() as connection:
        config_row = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
    if config_row is None:
        raise HTTPException(status_code=404, detail="RIPE configuration not initialized")
    return discovered_root_pools(config_row)


@app.post("/ripe/discovery/root-pools/sync", response_model=list[Pool], status_code=201)
def sync_ripe_root_pool(payload: RipeDiscoverySyncRequest) -> list[Pool]:
    cidrs = cidr_parts(payload.cidr)
    if not cidrs:
        raise HTTPException(status_code=400, detail="Discovered pool does not include a CIDR value")
    networks = [normalize_network(cidr) for cidr in cidrs]
    if [str(network) for network in networks] != cidrs:
        raise HTTPException(status_code=400, detail=f"Discovered CIDR value is not normalized: {payload.cidr}")
    with connect() as connection:
        existing = connection.execute(
            f"SELECT cidr FROM pools WHERE cidr IN ({','.join('?' for _ in cidrs)})",
            cidrs,
        ).fetchall()
        if existing:
            existing_cidrs = ", ".join(row["cidr"] for row in existing)
            raise HTTPException(status_code=409, detail=f"RIPE allocation already synchronized for CIDR(s): {existing_cidrs}")
    for network in networks:
        validate_parent_pool(network)

    synced: list[Pool] = []
    sync_time = now_iso()
    with connect() as connection:
        for index, network in enumerate(networks, start=1):
            suffix = f" {index}" if len(networks) > 1 else ""
            pool = pool_from_network(network, f"{payload.pool_name or 'RIPE Root Pool'}{suffix}", "SA", "RIPE")
            data = pool.model_dump()
            data.update(
                {
                    "description": f"RIPE IP Pools Discovery root allocation {payload.start_ip} - {payload.end_ip}",
                    "category": "IP Subnet",
                    "resource_role": "ParentPool",
                    "allocation_policy": "Boundary partitioning",
                    "owner": payload.ripe_maintainer,
                    "provider": "RIPE",
                    "source_system": "RIPE IP Pools Discovery",
                    "external_id": payload.allocation_range or f"{payload.start_ip} - {payload.end_ip}",
                    "href": payload.object_href,
                    "last_audit_at": sync_time,
                    "tags": f"source=RIPE;pool_type=Public;discovery_method=RIPE IP Pools Discovery;ripe_maintainer={payload.ripe_maintainer};sync_status=Synced;ripe_status={payload.ripe_status};ripe_discovery_presence=Current;ripe_discovery_seen_at={sync_time}",
                }
            )
            pool = Pool(**data)
            insert_pool(connection, pool)
            sync_pool_resource(connection, pool)
            record_audit(connection, "RIPE Root Pool Synced", "pool", pool.id, "", pool.model_dump_json())
            synced.append(pool)
    return synced


@app.post("/ripe/discovery/root-pools/cst-sync", response_model=list[Pool])
def sync_ripe_root_pool_to_cst(payload: RipeDiscoverySyncRequest) -> list[Pool]:
    cidrs = cidr_parts(payload.cidr)
    if not cidrs:
        raise HTTPException(status_code=400, detail="Discovered pool does not include a CIDR value")
    networks = [normalize_network(cidr) for cidr in cidrs]
    if [str(network) for network in networks] != cidrs:
        raise HTTPException(status_code=400, detail=f"Discovered CIDR value is not normalized: {payload.cidr}")

    synced: list[Pool] = []
    sync_time = now_iso()
    with connect() as connection:
        pool_rows = connection.execute(
            f"SELECT * FROM pools WHERE cidr IN ({','.join('?' for _ in cidrs)})",
            cidrs,
        ).fetchall()
        found_cidrs = {row["cidr"] for row in pool_rows}
        missing = [cidr for cidr in cidrs if cidr not in found_cidrs]
        if missing:
            raise HTTPException(status_code=409, detail=f"Sync to Local LIR first for CIDR(s): {', '.join(missing)}")

        for row in pool_rows:
            before = pool_from_row(row)
            resource = sync_pool_resource(connection, before)
            create_cst_sync_jobs(connection, [(resource, "SEND")], "RIPE_ROOT_POOL_CST_SYNC")
            connection.execute(
                "UPDATE pools SET tags = ?, last_audit_at = ? WHERE id = ?",
                (
                    update_tag_string(
                        before.tags,
                        {
                            "cst_lir_sync_status": "Synced",
                            "cst_lir_sync_date": sync_time,
                        },
                    ),
                    sync_time,
                    before.id,
                ),
            )
            updated_row = connection.execute("SELECT * FROM pools WHERE id = ?", (before.id,)).fetchone()
            after = pool_from_row(updated_row)
            record_audit(connection, "RIPE Root Pool CST LIR Synced", "pool", after.id, before.model_dump_json(), after.model_dump_json())
            synced.append(after)
    return synced


@app.post("/ripe/assignments/{assignment_id}/push", response_model=RipePushResponse)
def push_assignment_to_ripe(assignment_id: str) -> RipePushResponse:
    assignment = find_assignment(assignment_id)
    if not network_of(assignment).is_global:
        raise HTTPException(status_code=400, detail="Only public assignments can be pushed to RIPE")
    with connect() as connection:
        config_row = connection.execute("SELECT * FROM ripe_config WHERE id = 'default'").fetchone()
    if config_row is None:
        raise HTTPException(status_code=404, detail="RIPE configuration not initialized")

    removing = assignment.status == "Retiring"
    success, status_code, message, response_body, request_object = (
        delete_ripe_assignment(assignment, config_row) if removing else post_ripe_assignment(assignment, config_row)
    )
    new_status = "SUCCESS" if success else "FAILED"
    new_action_flag = "D" if success and removing else "S" if success else "F"
    with connect() as connection:
        before = find_assignment(assignment_id)
        if success and removing:
            resource = find_resource_by_source(connection, "assignment", assignment_id)
            connection.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
            if resource:
                connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (resource.resource_uuid,))
                connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (resource.resource_uuid,))
        else:
            connection.execute(
                "UPDATE assignments SET ripe_sync_status = ?, action_flag = ? WHERE id = ?",
                (new_status, new_action_flag, assignment_id),
            )
            after = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
            sync_assignment_resource(connection, after)
        record_audit(
            connection,
            "RIPE Assignment Removal" if removing else "RIPE Assignment Push",
            "assignment",
            assignment_id,
            before.model_dump_json(),
            json.dumps(
                {
                    "status": new_status,
                    "action_flag": new_action_flag,
                    "http_status": status_code,
                    "message": message,
                    "request_object": request_object,
                    "response_body": response_body,
                }
            ),
        )
    return RipePushResponse(
        success=success,
        status_code=status_code,
        assignment_id=assignment_id,
        cidr=assignment.cidr,
        ripe_sync_status=new_status,
        message=message,
        request_object=request_object,
        response_body=response_body[:4000],
    )


@app.get("/cst/config", response_model=CstConfig)
def get_cst_config() -> CstConfig:
    with connect() as connection:
        return ensure_cst_config(connection)


@app.put("/cst/config", response_model=CstConfig)
def update_cst_config(payload: CstConfigUpdate) -> CstConfig:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return get_cst_config()
    allowed = {"enabled", "service_provider_id", "auto_execute", "scheduled_sync_enabled", "schedule_time", "schedule_timezone", "batch_size_limit", "hourly_request_limit"}
    values = {key: value for key, value in updates.items() if key in allowed and value is not None}
    if not values:
        return get_cst_config()
    if "batch_size_limit" in values and int(values["batch_size_limit"]) < 1:
        raise HTTPException(status_code=400, detail="batchSizeLimit must be at least 1")
    if "hourly_request_limit" in values and int(values["hourly_request_limit"]) < 1:
        raise HTTPException(status_code=400, detail="hourlyRequestLimit must be at least 1")
    if "schedule_time" in values:
        parse_cst_schedule_time(str(values["schedule_time"]))
    if "schedule_timezone" in values:
        try:
            ZoneInfo(str(values["schedule_timezone"]))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Unsupported CST schedule timezone") from exc
    if "enabled" in values:
        values["enabled"] = 1 if values["enabled"] else 0
    if "auto_execute" in values:
        values["auto_execute"] = 1 if values["auto_execute"] else 0
    if "scheduled_sync_enabled" in values:
        values["scheduled_sync_enabled"] = 1 if values["scheduled_sync_enabled"] else 0
    values["updated_at"] = now_iso()
    with connect() as connection:
        ensure_cst_config(connection)
        set_sql = ", ".join(f"{key} = ?" for key in values)
        connection.execute(f"UPDATE cst_config SET {set_sql} WHERE id = 'default'", tuple(values.values()))
        row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    return cst_config_from_row(row)


@app.get("/cst/summary", response_model=CstSyncSummary)
def get_cst_summary() -> CstSyncSummary:
    with connect() as connection:
        config = ensure_cst_config(connection)
        counts = {row["status"]: row["count"] for row in connection.execute("SELECT status, COUNT(*) AS count FROM cst_sync_jobs GROUP BY status").fetchall()}
        total_jobs = connection.execute("SELECT COUNT(*) FROM cst_sync_jobs").fetchone()[0]
        total_transactions = connection.execute("SELECT COUNT(*) FROM cst_transaction_ledger").fetchone()[0]
        last_batch = connection.execute("SELECT created_at FROM cst_sync_batches ORDER BY created_at DESC LIMIT 1").fetchone()
    return CstSyncSummary(
        enabled=config.enabled,
        auto_execute=config.auto_execute,
        scheduled_sync_enabled=config.scheduled_sync_enabled,
        schedule_time=config.schedule_time,
        schedule_timezone=config.schedule_timezone,
        last_scheduled_run_date=config.last_scheduled_run_date,
        last_scheduled_run_at=config.last_scheduled_run_at,
        total_jobs=total_jobs,
        pending_jobs=int(counts.get("PENDING", 0)),
        running_jobs=int(counts.get("RUNNING", 0)),
        success_jobs=int(counts.get("SUCCESS", 0)),
        failed_jobs=int(counts.get("FAILED", 0)),
        blocked_jobs=int(counts.get("BLOCKED", 0)),
        total_transactions=total_transactions,
        last_batch_at=str(last_batch["created_at"] if last_batch else ""),
    )


@app.get("/cst/scheduler-runs", response_model=list[CstSchedulerRun])
def list_cst_scheduler_runs() -> list[CstSchedulerRun]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM cst_scheduler_runs ORDER BY started_at DESC LIMIT 120").fetchall()
    return [cst_scheduler_run_from_row(row) for row in rows]


@app.post("/cst/schedule/run-day-minus-one", response_model=CstSchedulerRun)
def run_cst_day_minus_one_now(target_date: str = "") -> CstSchedulerRun:
    return run_cst_day_minus_one_sync(target_date, "manual")

@app.get("/cst/batches", response_model=list[CstSyncBatch])
def list_cst_batches() -> list[CstSyncBatch]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM cst_sync_batches ORDER BY created_at DESC LIMIT 200").fetchall()
    return [cst_batch_from_row(row) for row in rows]


@app.get("/cst/jobs", response_model=list[CstSyncJob])
def list_cst_jobs() -> list[CstSyncJob]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM cst_sync_jobs ORDER BY created_at DESC, sequence_no DESC LIMIT 500").fetchall()
    return [cst_job_from_row(row) for row in rows]


@app.get("/cst/transactions", response_model=list[CstTransactionLedger])
def list_cst_transactions() -> list[CstTransactionLedger]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM cst_transaction_ledger ORDER BY first_used_at DESC LIMIT 500").fetchall()
    return [cst_ledger_from_row(row) for row in rows]


@app.post("/cst/bootstrap-current", response_model=list[CstSyncJob])
def bootstrap_current_cst_resources() -> list[CstSyncJob]:
    with connect() as connection:
        resources = [
            resource_from_row(row)
            for row in connection.execute(
                """
                SELECT * FROM ip_resources
                WHERE ip_type = 'PUBLIC'
                  AND status != 'RETIRED'
                  AND resource_uuid NOT IN (SELECT resource_uuid FROM cst_transaction_ledger)
                ORDER BY prefix, cidr
                """
            ).fetchall()
        ]
        jobs = create_cst_sync_jobs(connection, [(resource, "SEND") for resource in resources], "INITIAL_LIR_MIGRATION")
        record_audit(connection, "CST Initial Migration Jobs Created", "cst_batch", jobs[0].batch_id if jobs else "", "", json.dumps({"jobs": len(jobs)}))
    return jobs


@app.post("/cst/reconcile", response_model=list[CstSyncJob])
def reconcile_cst_resources() -> list[CstSyncJob]:
    with connect() as connection:
        resources = [
            resource_from_row(row)
            for row in connection.execute(
                "SELECT * FROM ip_resources WHERE ip_type = 'PUBLIC' ORDER BY prefix, cidr"
            ).fetchall()
        ]
        jobs = create_cst_sync_jobs(connection, [(resource, "GET") for resource in resources], "CST_RECONCILIATION")
        record_audit(connection, "CST Reconciliation Jobs Created", "cst_batch", jobs[0].batch_id if jobs else "", "", json.dumps({"jobs": len(jobs)}))
    return jobs


@app.post("/cst/jobs/{job_id}/retry", response_model=CstSyncJob)
def retry_cst_job(job_id: str) -> CstSyncJob:
    with connect() as connection:
        row = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="CST job not found")
        return retry_cst_jobs(connection, [row])[0]


@app.post("/cst/batches/{batch_id}/retry-failed", response_model=list[CstSyncJob])
def retry_failed_cst_batch(batch_id: str) -> list[CstSyncJob]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM cst_sync_jobs WHERE batch_id = ? AND status IN ('FAILED', 'BLOCKED', 'PENDING') ORDER BY sequence_no",
            (batch_id,),
        ).fetchall()
        if not rows:
            return []
        return retry_cst_jobs(connection, rows)

@app.get("/pools", response_model=list[Pool])
def list_pools() -> list[Pool]:
    return list_pools_from_db()


@app.get("/pools/{pool_id}/ranges", response_model=PoolRanges)
def list_pool_ranges(pool_id: str) -> PoolRanges:
    pool = find_pool(pool_id, None)
    assignments = list_assignments_from_db()
    return PoolRanges(
        pool=pool,
        assigned=assigned_ranges_for_pool(pool, assignments),
        unassigned=free_ranges_for_pool(pool, assignments),
    )


@app.post("/pools", response_model=Pool, status_code=201)
def add_pool(payload: PoolCreate) -> Pool:
    network = normalize_network(payload.cidr)
    validate_parent_pool(network)
    pool = pool_from_network(network, payload.name, payload.region)
    pool_data = pool.model_dump()
    for key, value in payload.model_dump().items():
        if key in pool_data:
            pool_data[key] = value
    pool = Pool(**pool_data)
    with connect() as connection:
        insert_pool(connection, pool)
        resource = sync_pool_resource(connection, pool)
        if resource_requires_cst(resource):
            create_cst_sync_jobs(connection, [(resource, "SEND")], "POOL_CREATE")
        record_audit(connection, "Pool Creation", "pool", pool.id, "", pool.model_dump_json())
    return pool


@app.patch("/pools/{pool_id}", response_model=Pool)
def update_pool(pool_id: str, payload: PoolUpdate) -> Pool:
    existing = find_pool(pool_id, None)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return existing
    allowed = set(PoolUpdate.model_fields.keys())
    updates = {key: value for key, value in changes.items() if key in allowed and value is not None}
    if not updates:
        return existing
    with connect() as connection:
        existing_resource = assert_resource_can_change(connection, "pool", pool_id)
        requested_status = updates.get("resource_status") or updates.get("lifecycle_state")
        if requested_status and normalize_resource_status(str(requested_status)) == "RETIRED" and existing_resource:
            children = active_child_resources(connection, existing_resource.resource_uuid)
            if children:
                raise HTTPException(status_code=409, detail="Root pools can only be retired when no active child CIDRs exist")
        set_sql = ", ".join(f"{key} = ?" for key in updates)
        connection.execute(f"UPDATE pools SET {set_sql} WHERE id = ?", (*updates.values(), pool_id))
        row = connection.execute("SELECT * FROM pools WHERE id = ?", (pool_id,)).fetchone()
        updated = pool_from_row(row)
        sync_pool_resource(connection, updated)
        record_audit(connection, "Pool Modification", "pool", pool_id, existing.model_dump_json(), updated.model_dump_json())
    return updated


@app.delete("/pools/{pool_id}", status_code=204)
def delete_pool(pool_id: str) -> None:
    pool = find_pool(pool_id, None)
    with connect() as connection:
        resource = find_resource_by_source(connection, "pool", pool_id)
        status = resource.status if resource else normalize_resource_status(pool.resource_status or pool.lifecycle_state)
        if status != "RETIRED":
            raise HTTPException(status_code=409, detail="Only RETIRED pools or subnets can be deleted. Retire the resource first.")
        if resource:
            children = allocated_child_resources(connection, resource.resource_uuid)
            if children:
                child_cidrs = ", ".join(child.cidr for child in children[:5])
                raise HTTPException(
                    status_code=409,
                    detail=f"Retired pools can only be deleted after assigned/reserved child CIDRs are released: {child_cidrs}",
                )
        result = connection.execute("DELETE FROM pools WHERE id = ?", (pool_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Pool not found")
        if resource:
            connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (resource.resource_uuid,))
        record_audit(connection, "Pool Deletion", "pool", pool_id, pool.model_dump_json(), "Deleted retired resource")


def create_bulk_batch(operation_type: str, payload: BulkCsvRequest) -> BulkBatch:
    batch = BulkBatch(
        id=f"bulk-{uuid4().hex[:12]}",
        operation_type=operation_type,
        status="RUNNING",
        file_name=payload.file_name,
        total_rows=csv_data_row_count(payload.csv_text),
        started_at=now_iso(),
    )
    with connect() as connection:
        data = batch.model_dump()
        columns = list(data.keys())
        connection.execute(
            f"INSERT INTO bulk_batches ({', '.join(columns)}) VALUES ({', '.join(f':{column}' for column in columns)})",
            data,
        )
        record_audit(connection, "Bulk Transaction Started", "bulk_batch", batch.id, "", batch.model_dump_json())
    return batch


def complete_bulk_batch(batch_id: str, result: BulkImportResult, started: float) -> None:
    completed_at = now_iso()
    duration_ms = int((time.perf_counter() - started) * 1000)
    status = "COMPLETED_WITH_ERRORS" if result.blocked else "COMPLETED"
    error_summary = "\n".join(result.errors[:20])
    with connect() as connection:
        connection.execute(
            """
            UPDATE bulk_batches
            SET status = ?, success_count = ?, failure_count = ?, imported_count = ?, blocked_count = ?,
                completed_at = ?, duration_ms = ?, error_summary = ?, result_json = ?
            WHERE id = ?
            """,
            (
                status,
                result.imported,
                result.blocked,
                result.imported,
                result.blocked,
                completed_at,
                duration_ms,
                error_summary,
                result.model_dump_json(),
                batch_id,
            ),
        )
        record_audit(connection, "Bulk Transaction Completed", "bulk_batch", batch_id, "", result.model_dump_json())


def fail_bulk_batch(batch_id: str, error: Exception, started: float) -> None:
    completed_at = now_iso()
    duration_ms = int((time.perf_counter() - started) * 1000)
    result = BulkImportResult(imported=0, blocked=1, errors=[str(error)], output_rows=[])
    with connect() as connection:
        connection.execute(
            """
            UPDATE bulk_batches
            SET status = 'FAILED', failure_count = 1, blocked_count = 1, completed_at = ?,
                duration_ms = ?, error_summary = ?, result_json = ?
            WHERE id = ?
            """,
            (completed_at, duration_ms, str(error), result.model_dump_json(), batch_id),
        )
        record_audit(connection, "Bulk Transaction Failed", "bulk_batch", batch_id, "", str(error))


def run_bulk_batch(batch_id: str, operation_type: str, csv_text: str) -> None:
    started = time.perf_counter()
    try:
        with DB_WRITE_LOCK:
            if operation_type == "POOL_IMPORT":
                result = process_pool_bulk(csv_text)
            elif operation_type == "ASSIGNMENT_IMPORT":
                result = process_assignment_bulk(csv_text)
            else:
                raise ValueError(f"Unsupported bulk operation type: {operation_type}")
        complete_bulk_batch(batch_id, result, started)
    except Exception as exc:
        fail_bulk_batch(batch_id, exc, started)


def process_pool_bulk(csv_text: str) -> BulkImportResult:
    imported = 0
    errors: list[str] = []
    output_rows: list[BulkOutputRow] = []
    for index, row in enumerate(csv_rows(csv_text), start=2):
        try:
            networks, name, region = pool_networks_from_bulk_row(row)
            for network in networks:
                validate_parent_pool(network)
            with connect() as connection:
                for network in networks:
                    pool = pool_from_network(network, name if len(networks) == 1 else f"{name} {network}", region, "CSV bulk import")
                    insert_pool(connection, pool)
                    resource = sync_pool_resource(connection, pool)
                    if resource_requires_cst(resource):
                        create_cst_sync_jobs(connection, [(resource, "SEND")], "POOL_BULK_IMPORT")
                    record_audit(connection, "Pool Creation", "pool", pool.id, "", pool.model_dump_json())
                    imported += 1
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="SUCCESS",
                            processingMessage="Imported",
                            generatedResourceUuid=resource.resource_uuid,
                            generatedVersionUuid=resource.version_uuid,
                            generatedCidr=pool.cidr,
                            generatedSize=pool.size,
                            status=resource.status,
                        )
                    )
        except HTTPException as exc:
            errors.append(f"row {index}: {exc.detail}")
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage=str(exc.detail),
                )
            )
        except sqlite3.IntegrityError as exc:
            errors.append(f"row {index}: duplicate pool")
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage="duplicate pool",
                )
            )
        except ValueError as exc:
            errors.append(f"row {index}: {exc}")
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage=str(exc),
                )
            )
    return BulkImportResult(imported=imported, blocked=len(errors), errors=errors, output_rows=output_rows)


@app.post("/pools/bulk", response_model=BulkBatch, status_code=202)
def bulk_add_pools(payload: BulkCsvRequest, background_tasks: BackgroundTasks) -> BulkBatch:
    batch = create_bulk_batch("POOL_IMPORT", payload)
    background_tasks.add_task(run_bulk_batch, batch.id, batch.operation_type, payload.csv_text)
    return batch


@app.post("/pools/partition", response_model=PartitionResult, status_code=201)
def partition_pool(payload: PartitionRequest) -> PartitionResult:
    parent = find_pool(payload.pool_id, payload.cidr)
    parent_network = network_of(parent)
    direction = payload.direction.lower().strip()
    with connect() as connection:
        parent_resource = assert_resource_can_change(connection, "pool", parent.id)
        if parent_resource and parent_resource.status in {"RESERVED", "RETIRED"}:
            raise HTTPException(status_code=409, detail="Reserved or retired CIDRs cannot be split")

    if direction not in {"start", "end"}:
        raise HTTPException(status_code=400, detail="Allocation direction must be start or end")

    if payload.target_prefix <= parent_network.prefixlen or payload.target_prefix > 32:
        raise HTTPException(
            status_code=400,
            detail=f"Target prefix must be larger than /{parent_network.prefixlen} and no larger than /32",
        )

    assignments = list_assignments_from_db()
    free_intervals = free_intervals_for_network(parent_network, assignments)
    if not free_intervals:
        raise HTTPException(status_code=409, detail="No free address space remains in the selected parent pool")
    if len(free_intervals) > 1:
        raise HTTPException(
            status_code=409,
            detail=(
                "Partitioning requires one continuous remaining free pool. Existing subnets have fragmented "
                "this parent pool; advanced fragmentation mode is not enabled."
            ),
        )
    free_start, free_end = free_intervals[0]

    requested_size = 2 ** (32 - payload.target_prefix)
    free_size = int(free_end) - int(free_start) + 1
    if requested_size > free_size:
        raise HTTPException(status_code=400, detail="Requested subnet size is larger than the current continuous free pool")

    if direction == "start":
        allocated_start = free_start
    else:
        allocated_start = IPv4Address(int(free_end) - requested_size + 1)

    try:
        allocated_network = IPv4Network((allocated_start, payload.target_prefix))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Calculated subnet boundary is not CIDR-aligned") from exc

    if int(allocated_network.network_address) < int(free_start) or int(allocated_network.broadcast_address) > int(free_end):
        raise HTTPException(status_code=409, detail="Calculated subnet falls outside the current continuous free pool")

    for assignment in assignments:
        if assignment_released_after_ripe_removal(assignment):
            continue
        if allocated_network.overlaps(network_of(assignment)):
            raise HTTPException(
                status_code=409,
                detail=f"Requested subnet overlaps existing subnet {assignment.cidr}",
            )

    if direction == "start":
        remaining_start = IPv4Address(int(allocated_network.broadcast_address) + 1)
        remaining_end = free_end
    else:
        remaining_start = free_start
        remaining_end = IPv4Address(int(allocated_network.network_address) - 1)

    if int(remaining_start) <= int(remaining_end):
        remaining = ContinuousRange(
            start=str(remaining_start),
            end=str(remaining_end),
            size=int(remaining_end) - int(remaining_start) + 1,
            label=f"{remaining_start} - {remaining_end}",
            resource_uuid=str(uuid5(NAMESPACE_URL, f"remaining:{parent.id}:{remaining_start}:{remaining_end}")),
        )
    else:
        remaining = ContinuousRange()

    payload_assignment = AssignmentCreate(
        cidr=str(allocated_network),
        assignment_target_type="internal",
        assignment_name=f"Partition {allocated_network}",
        assignment_description=f"Boundary partition from {parent.cidr}",
        service_specification_id="RFS-IPAM-PARTITION",
        service_specification_name="IPAM Pool Partitioning Resource-Facing Service",
        service_specification_type="ResourceFacingServiceSpecification",
        service_instance_name=f"IPAM partition {allocated_network}",
        service_type="ResourceFacingService",
        service_category="IPAM Internal Service",
        customer_id="internal-ipam",
        customer_name="Internal IPAM partition",
        customer_type="Internal",
        customer_segment="Internal",
        commercial_reg_id="N/A",
        unified_number="N/A",
        contact_number="N/A",
        city=parent.region,
        region=parent.region,
        contact_name="IPAM Admin",
        internal_consumer_type="IPAM",
        internal_business_unit="Network Operations",
        internal_application_name="NetAtlas IPAM",
        internal_owner_team="IPAM Operations",
        internal_justification="Boundary-based child subnet allocation",
        l3_service="IP pool partitioning",
        service="Reserved child subnet",
        owner="IPAM",
        site=parent.name,
        environment="Shared",
        status="Reserved",
        assignment_date=datetime.now(timezone.utc).date().isoformat(),
        notes=f"Allocated from {direction} of parent pool {parent.cidr}. Remaining free pool: {remaining.label}.",
    )
    allocated = assignment_from_network(allocated_network, payload_assignment)

    with connect() as connection:
        insert_assignment(connection, allocated)
        resource = sync_assignment_resource(connection, allocated)
        if resource_requires_cst(resource):
            create_cst_assignment_create_jobs(connection, allocated, resource, "POOL_PARTITION_ASSIGNMENT")
        record_audit(connection, "Subnet Allocation", "assignment", allocated.id, "", allocated.model_dump_json())

    return PartitionResult(
        allocated=allocated,
        remaining=remaining,
        message=(
            f"Allocated {allocated.cidr} from the {direction} of {parent.cidr}. "
            f"Allocated UUID: {allocated.id}. "
            f"Remaining child UUID: {remaining.resource_uuid or 'N/A'}. "
            f"Remaining free pool: {remaining.label}."
        ),
    )


@app.post("/pools/join", response_model=Pool, status_code=201)
def join_pools(payload: JoinRequest) -> Pool:
    left = find_pool(payload.left_pool_id, payload.left_cidr)
    right = find_pool(payload.right_pool_id, payload.right_cidr)
    if left.id == right.id:
        raise HTTPException(status_code=400, detail="Choose two different pools")
    with connect() as connection:
        left_resource = assert_resource_can_change(connection, "pool", left.id)
        right_resource = assert_resource_can_change(connection, "pool", right.id)
        if (left_resource and left_resource.status in {"RESERVED", "RETIRED"}) or (right_resource and right_resource.status in {"RESERVED", "RETIRED"}):
            raise HTTPException(status_code=409, detail="Reserved or retired CIDRs cannot be joined")
        if left_resource and right_resource:
            if left_resource.parent_resource_uuid != right_resource.parent_resource_uuid:
                raise HTTPException(status_code=409, detail="CIDRs must have the same parentResourceUuid")
            if left_resource.ownership_type != right_resource.ownership_type:
                raise HTTPException(status_code=409, detail="CIDRs must have the same ownershipType")
            if left_resource.status != right_resource.status:
                raise HTTPException(status_code=409, detail="CIDRs must have the same status")
            if left_resource.customer_name != right_resource.customer_name:
                raise HTTPException(status_code=409, detail="CIDRs must belong to the same customer")
            if left_resource.root_pool_uuid != right_resource.root_pool_uuid:
                raise HTTPException(status_code=409, detail="CIDRs must belong to the same Root Pool")

    left_network = network_of(left)
    right_network = network_of(right)
    if left_network.prefixlen != right_network.prefixlen:
        raise HTTPException(status_code=409, detail="Pools must have the same prefix")

    supernets = list(left_network.supernet().subnets(new_prefix=left_network.prefixlen))
    if set(supernets) != {left_network, right_network}:
        raise HTTPException(status_code=409, detail="Pools must be adjacent and aligned to a valid supernet")

    joined_network = left_network.supernet()
    validate_parent_pool(joined_network, {left.id, right.id})

    joined = pool_from_network(
        joined_network,
        f"{left.name} + {right.name}",
        left.region if left.region == right.region else "Multi-region",
        f"Joined {left.cidr} and {right.cidr}",
    )
    with connect() as connection:
        connection.execute("DELETE FROM pools WHERE id IN (?, ?)", (left.id, right.id))
        connection.execute("DELETE FROM ip_resources WHERE source_entity_type = 'pool' AND source_entity_id IN (?, ?)", (left.id, right.id))
        insert_pool(connection, joined)
        sync_pool_resource(connection, joined)
        record_audit(connection, "Pool Modification", "pool", joined.id, f"{left.cidr}; {right.cidr}", joined.model_dump_json())
    return joined


@app.get("/assignments", response_model=list[Assignment])
def list_assignments() -> list[Assignment]:
    return list_assignments_from_db()


@app.get("/resources", response_model=list[ResourceWithAssignment])
def list_resources() -> list[ResourceWithAssignment]:
    with connect() as connection:
        release_expired_reservations(connection)
        rows = connection.execute(
            """
            SELECT * FROM ip_resources
            ORDER BY CAST((julianday(updated_at) - 2440587.5) * 86400000 AS INTEGER) DESC, start_ip ASC
            """
        ).fetchall()
        details = {
            row["resource_uuid"]: assignment_detail_from_row(row)
            for row in connection.execute("SELECT * FROM assignment_details").fetchall()
        }
    return [
        ResourceWithAssignment(**resource_from_row(row).model_dump(), assignment=details.get(row["resource_uuid"]))
        for row in rows
    ]


@app.post("/assignments", response_model=Assignment, status_code=201)
def add_assignment(payload: AssignmentCreate) -> Assignment:
    network = normalize_network(payload.cidr)
    validate_cst_lir_assignment(payload)
    validate_assignment(network)
    assignment = assignment_from_network(network, payload)
    with connect() as connection:
        insert_assignment(connection, assignment)
        resource = sync_assignment_resource(connection, assignment)
        if resource_requires_cst(resource):
            create_cst_assignment_create_jobs(connection, assignment, resource, "ASSIGNMENT_CREATE")
        record_audit(connection, "Subnet Allocation", "assignment", assignment.id, "", assignment.model_dump_json())
    return assignment


def process_assignment_bulk(csv_text: str) -> BulkImportResult:
    imported = 0
    errors: list[str] = []
    output_rows: list[BulkOutputRow] = []
    for index, row in enumerate(csv_rows(csv_text), start=2):
        row_output_start = len(output_rows)
        try:
            networks, is_pr_format = bulk_assignment_networks_from_row(row)
            assignment_status_id, assignment_status = bulk_assignment_status(row, is_pr_format)
            for network in networks:
                try:
                    assignment_payload = assignment_payload_from_bulk_row(row, network, assignment_status_id, assignment_status)
                    validate_cst_lir_assignment(assignment_payload)
                    validate_assignment(network)
                    assignment = assignment_from_network(network, assignment_payload)
                    with connect() as connection:
                        insert_assignment(connection, assignment)
                        resource = sync_assignment_resource(connection, assignment)
                        if resource_requires_cst(resource):
                            create_cst_assignment_create_jobs(connection, assignment, resource, "ASSIGNMENT_BULK_IMPORT")
                        record_audit(connection, "Subnet Allocation", "assignment", assignment.id, "", assignment.model_dump_json())
                    imported += 1
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="SUCCESS",
                            processingMessage="Imported",
                            generatedResourceUuid=resource.resource_uuid,
                            generatedVersionUuid=resource.version_uuid,
                            generatedCidr=assignment.cidr,
                            generatedSize=assignment.size,
                            status=str(resource.assignment_status_id),
                            assignmentDate=assignment.assignment_date,
                            customerName=assignment.customer_name,
                        )
                    )
                except HTTPException as exc:
                    message = f"row {index} {network}: {exc.detail}"
                    errors.append(message)
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="FAILED",
                            processingMessage=str(exc.detail),
                            generatedCidr=str(network),
                            generatedSize=network.num_addresses,
                            status=str(assignment_status_id),
                            assignmentDate=csv_value(row, "assignmentDate", "assignment_date"),
                            customerName=csv_value(row, "customerName", "customer_name"),
                        )
                    )
                except (sqlite3.IntegrityError, ValueError) as exc:
                    message = f"row {index} {network}: invalid or duplicate assignment"
                    errors.append(message)
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="FAILED",
                            processingMessage="invalid or duplicate assignment",
                            generatedCidr=str(network),
                            generatedSize=network.num_addresses,
                            status=str(assignment_status_id),
                            assignmentDate=csv_value(row, "assignmentDate", "assignment_date"),
                            customerName=csv_value(row, "customerName", "customer_name"),
                        )
                    )
            row_outputs = output_rows[row_output_start:]
            if any(item.processingStatus == "SUCCESS" for item in row_outputs) and any(item.processingStatus == "FAILED" for item in row_outputs):
                for item in row_outputs:
                    item.processingStatus = "PARTIAL_SUCCESS"
        except HTTPException as exc:
            message = f"row {index}: {exc.detail}"
            errors.append(message)
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage=str(exc.detail),
                    status=csv_value(row, "status"),
                    assignmentDate=csv_value(row, "assignmentDate", "assignment_date"),
                    customerName=csv_value(row, "customerName", "customer_name"),
                )
            )
        except ValueError as exc:
            message = f"row {index}: {exc}"
            errors.append(message)
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage=str(exc),
                    status=csv_value(row, "status"),
                    assignmentDate=csv_value(row, "assignmentDate", "assignment_date"),
                            customerName=csv_value(row, "customerName", "customer_name"),
                        )
                    )
    return BulkImportResult(imported=imported, blocked=len(errors), errors=errors, output_rows=output_rows)


@app.post("/assignments/bulk", response_model=BulkBatch, status_code=202)
def bulk_add_assignments(payload: BulkCsvRequest, background_tasks: BackgroundTasks) -> BulkBatch:
    batch = create_bulk_batch("ASSIGNMENT_IMPORT", payload)
    background_tasks.add_task(run_bulk_batch, batch.id, batch.operation_type, payload.csv_text)
    return batch


@app.get("/bulk/batches", response_model=list[BulkBatch])
def list_bulk_batches() -> list[BulkBatch]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM bulk_batches ORDER BY started_at DESC LIMIT 200").fetchall()
    return [bulk_batch_from_row(row) for row in rows]


@app.get("/bulk/batches/{batch_id}", response_model=BulkBatch)
def get_bulk_batch(batch_id: str) -> BulkBatch:
    with connect() as connection:
        row = connection.execute("SELECT * FROM bulk_batches WHERE id = ?", (batch_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Bulk batch not found")
    return bulk_batch_from_row(row)


@app.patch("/assignments/{assignment_id}/status", response_model=Assignment)
def update_assignment_status(assignment_id: str, payload: StatusUpdate) -> Assignment:
    allowed_statuses = {"Reserved", "Active", "Planned", "Retiring", "Quarantined", "Blocked"}
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of {sorted(allowed_statuses)}")

    before = find_assignment(assignment_id)
    with connect() as connection:
        assert_resource_can_change(connection, "assignment", assignment_id)
        if payload.status == "Retiring" and str(before.ripe_sync_status or "").upper() not in {"SUCCESS", "SYNCHRONIZED"}:
            result = connection.execute(
                "UPDATE assignments SET status = ?, ripe_sync_status = ?, action_flag = ? WHERE id = ?",
                (payload.status, "NOT_REQUIRED", before.action_flag or "D", assignment_id),
            )
        else:
            result = connection.execute(
                "UPDATE assignments SET status = ? WHERE id = ?",
                (payload.status, assignment_id),
            )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignment not found")
        after = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
        resource = sync_assignment_resource(connection, after)
        if payload.status == "Retiring":
            if str(before.cst_sync_status or "").upper() in {"SUCCESS", "SYNCHRONIZED"}:
                create_cst_sync_jobs(connection, [(resource, "DELETE")], "ASSIGNMENT_RELEASE")
            else:
                connection.execute(
                    "UPDATE assignments SET cst_sync_status = ?, action_flag = ? WHERE id = ?",
                    ("NOT_REQUIRED", before.action_flag or "D", assignment_id),
                )
                connection.execute(
                    "UPDATE ip_resources SET cst_sync_status = ?, action_flag = ?, updated_at = ? WHERE resource_uuid = ?",
                    ("NOT_REQUIRED", before.action_flag or "D", now_iso(), resource.resource_uuid),
                )
        elif resource_requires_cst(resource) and str(after.cst_sync_status or "").upper() != "SUCCESS":
            create_cst_sync_jobs(connection, [(resource, "UPDATE")], "ASSIGNMENT_STATUS_CHANGE")
        after = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
        record_audit(connection, "Assignment Changes", "assignment", assignment_id, before.model_dump_json(), after.model_dump_json())
    return after


@app.delete("/assignments/{assignment_id}", status_code=204)
def unassign(assignment_id: str) -> None:
    assignment = find_assignment(assignment_id)
    with connect() as connection:
        resource = find_resource_by_source(connection, "assignment", assignment_id)
        if resource and resource.status == "RETIRED":
            audit_action = "Retired Resource Deletion"
            audit_new_value = "Deleted retired resource"
        else:
            assert_resource_can_change(connection, "assignment", assignment_id)
            audit_action = "Subnet Release"
            audit_new_value = "Released to free pool"
        result = connection.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if resource:
            connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (resource.resource_uuid,))
            connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (resource.resource_uuid,))
        record_audit(connection, audit_action, "assignment", assignment_id, assignment.model_dump_json(), audit_new_value)


@app.get("/audit", response_model=list[AuditEvent])
def list_audit_events() -> list[AuditEvent]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 500").fetchall()
    return [audit_from_row(row) for row in rows]


@app.get("/conflicts", response_model=list[Conflict])
def list_conflicts() -> list[Conflict]:
    conflicts: list[Conflict] = []
    pools = list_pools_from_db()
    assignments = [
        assignment
        for assignment in list_assignments_from_db()
        if not assignment_released_after_ripe_removal(assignment)
    ]
    pool_ranges = [(network_of(pool), pool) for pool in pools]

    pool_intervals = sorted(
        ((int(pool_network.network_address), int(pool_network.broadcast_address), pool) for pool_network, pool in pool_ranges),
        key=lambda item: (item[0], item[1]),
    )
    active_pools: list[tuple[int, int, Pool]] = []
    for start, end, pool in pool_intervals:
        active_pools = [(active_start, active_end, active_pool) for active_start, active_end, active_pool in active_pools if active_end >= start]
        for _active_start, active_end, active_pool in active_pools:
            if start <= active_end:
                conflicts.append(
                    Conflict(
                        severity="warning",
                        title="Registered subnets overlap",
                        detail=f"{active_pool.cidr} overlaps {pool.cidr}",
                        ranges=[active_pool.cidr, pool.cidr],
                    )
                )
                if len(conflicts) >= 500:
                    return conflicts
        active_pools.append((start, end, pool))

    for assignment in assignments:
        assignment_network = network_of(assignment)
        if not any(assignment_network.subnet_of(pool_network) for pool_network, _pool in pool_ranges):
            conflicts.append(
                Conflict(
                    severity="critical",
                    title="Assignment outside managed pools",
                    detail=f"{assignment.customer_name} allocation {assignment.cidr} is not covered by a parent pool",
                    ranges=[assignment.cidr],
                )
            )

    assignment_ranges = sorted(
        ((int(network_of(assignment).network_address), int(network_of(assignment).broadcast_address), assignment) for assignment in assignments),
        key=lambda item: (item[0], item[1]),
    )
    active_overlaps: list[tuple[int, int, Assignment]] = []
    for start, end, assignment in assignment_ranges:
        active_overlaps = [(active_start, active_end, active_assignment) for active_start, active_end, active_assignment in active_overlaps if active_end >= start]
        for _active_start, active_end, active_assignment in active_overlaps:
            if start <= active_end:
                conflicts.append(
                    Conflict(
                        severity="critical",
                        title="Customer assignments overlap",
                        detail=f"{active_assignment.customer_name} overlaps {assignment.customer_name}",
                        ranges=[active_assignment.cidr, assignment.cidr],
                    )
                )
                if len(conflicts) >= 500:
                    return conflicts
        active_overlaps.append((start, end, assignment))

    return conflicts


init_db()



















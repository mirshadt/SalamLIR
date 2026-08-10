from datetime import datetime, time as datetime_time, timedelta, timezone
import base64
import csv
import hashlib
import hmac
import json
from io import StringIO
from urllib import error as urllib_error, parse as urllib_parse, request as urllib_request
import ssl
from ipaddress import IPv4Address, IPv4Network, collapse_addresses, ip_network, summarize_address_range
import os
from pathlib import Path
import re
import secrets
import sqlite3
try:
    import psycopg
except ImportError:  # Optional until PostgreSQL runtime is enabled on the server.
    psycopg = None
try:
    import oracledb
except ImportError:  # Optional until Siebel lookup is enabled on the server.
    oracledb = None
import time
import threading
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.ipam_core_services.audit_service import AuditContext, AuditService
from backend import ripe_integration_service as ripe_service


DB_PATH = Path(__file__).with_name("ipam.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
PUBLIC_FAVICON_PATH = Path(__file__).resolve().parent.parent / "public" / "favicon.png"
DB_BUSY_TIMEOUT_MS = 30_000
DB_WRITE_LOCK = threading.RLock()
CST_API_CALL_LOCK = threading.RLock()
CST_API_LOG_LOCK = threading.Lock()
CST_PENDING_PUSH_LOCK = threading.Lock()
CST_SCHEDULER_LOCK = threading.Lock()
CST_SCHEDULER_STARTED = False
DEFAULT_SERVICE_PROVIDER_ID = "5"
DEFAULT_SERVICE_PROVIDER_NAME = "Salam"
DEFAULT_ASN = "AS35753"
LIR_CUSTOMER_TYPE_CODES = {"CORP", "RESI", "COMP", "NA"}
LIR_SUBNET_TYPE_CODES = {"NA", *{f"LAN{index}" for index in range(1, 9)}, *{f"PTP{index}" for index in range(1, 4)}}
CST_SEND_LIR_PATH = "/api/rest/v1.0/LIRDataService/SendLIRData"
CST_UPDATE_LIR_PATH = "/api/rest/v1.0/LIRDataService/UpdateLIRData"
CST_DELETE_LIR_PATH = "/api/rest/v1.0/LIRDataService/DeleteLIRData"
CST_GET_LIR_PATH = "/api/rest/v1.0/LIRDataService/GetLIRData"
CST_FALLBACK_PHONE_NUMBER = "0000000000"
CST_FALLBACK_ID_NUMBER = "0000000000"
CST_FALLBACK_EMAIL = "cst-migration@salam.sa"
CST_FALLBACK_FULL_NAME = "CST Migration Contact"
CST_FALLBACK_ORGANIZATION_NAME = "CST Migration Organization"
CST_FALLBACK_CUSTOMER_TYPE_ID = 2
CST_FALLBACK_ACCESS_TECHNOLOGY_ID = 1
CST_FALLBACK_REGION_ID = 1
CST_FALLBACK_CITY_ID = 153
CST_DEFAULT_ACCEPT_LANGUAGE = "EN"
CST_API_TIMEZONE = timezone(timedelta(hours=3))
CST_API_LOG_PATH = Path(os.environ.get("CST_API_LOG_FILE") or Path(__file__).with_name("logs") / "cst_api_exchange.jsonl")
CST_API_LOG_ENABLED = os.environ.get("CST_API_FILE_LOG_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
CST_LOG_SENSITIVE_KEYS = {"authorization", "x-gateway-apikey", "apikey", "api_key", "access_token", "token", "refresh_token", "client_secret", "password"}
BULK_UNASSIGNED_FRAGMENT_SOURCE = "bulk_unassigned_fragment"
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
    cst_sync_ready: bool = False
    cst_validation_status: str = "NOT_EVALUATED"
    cst_validation_errors: str = ""
    cst_validation_warnings: str = ""
    migration_conflict_status: str = ""
    migration_conflict_reason: str = ""
    migration_conflict_group: str = ""
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
    siebel_order_number: str = ""
    bss_customer_id: str = ""
    siebel_last_sync_at: str = ""
    siebel_last_checked_at: str = ""
    siebel_payload_hash: str = ""
    siebel_payload_json: str = ""
    service_characteristics: str = ""
    product_specification_id: str = ""
    product_specification_name: str = ""
    product_offering_id: str = ""
    product_offering_name: str = ""
    product_instance_id: str = ""
    customer_id: str = ""
    customer_name: str
    customer_type: str = "NA"
    subnet_type: str = "NA"
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
    assignment_ids: list[str] = []
    resource_uuids: list[str] = []
    resolution_status: str = ""


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
    assignmentType: str = ""
    cstSyncReady: bool = False
    cstValidationStatus: str = "NOT_EVALUATED"
    cstValidationErrors: str = ""
    cstValidationWarnings: str = ""


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


class SiebelConfigUpdate(BaseModel):
    username: str = "LIR_USER"
    password: str = ""
    dsn: str = "172.31.23.101:1525/SIDB"
    connection_timeout: int = 10
    query_sql: str = ""


class SiebelConfigOut(BaseModel):
    username: str
    dsn: str
    password_configured: bool
    connection_timeout: int
    query_sql: str
    updated_at: str



class SiebelConnectionTestResponse(BaseModel):
    success: bool
    message: str
    dsn: str
    tested_at: str

class SiebelLookupRequest(BaseModel):
    service_id: str = ""
    order_number: str = ""


class SiebelLookupResponse(BaseModel):
    service_id: str = ""
    order_number: str = ""
    found: bool
    assignment: dict[str, str] = {}
    raw: dict[str, str] = {}
    message: str = ""


class BssSyncAuditRecord(BaseModel):
    id: str
    assignment_id: str
    service_id: str = ""
    siebel_order_number: str
    changed_field: str
    old_value: str = ""
    new_value: str = ""
    synced_at: str
    status: str = "UPDATED"


class BssDeltaSyncResponse(BaseModel):
    checked: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    audit: list[BssSyncAuditRecord] = []
    message: str = ""


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
    city: str = ""
    region: str = ""
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
    cst_sync_ready: bool = False
    cst_validation_status: str = "NOT_EVALUATED"
    cst_validation_errors: str = ""
    cst_validation_warnings: str = ""
    migration_conflict_status: str = ""
    migration_conflict_reason: str = ""
    migration_conflict_group: str = ""
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
    service_order_id: str = ""
    siebel_order_number: str = ""
    bss_customer_id: str = ""
    siebel_last_sync_at: str = ""
    siebel_last_checked_at: str = ""
    siebel_payload_hash: str = ""
    siebel_payload_json: str = ""
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
    cst_sync_ready: bool = False
    cst_validation_status: str = "NOT_EVALUATED"
    cst_validation_errors: str = ""
    cst_validation_warnings: str = ""
    migration_conflict_status: str = ""
    migration_conflict_reason: str = ""
    migration_conflict_group: str = ""
    created_at: str
    updated_at: str



class CstConfig(BaseModel):
    id: str = "default"
    enabled: bool = True
    service_provider_id: str = DEFAULT_SERVICE_PROVIDER_ID
    auto_execute: bool = True
    scheduled_sync_enabled: bool = True
    send_enabled: bool = True
    update_enabled: bool = True
    delete_enabled: bool = True
    get_enabled: bool = True
    integration_mode: str = "Real API"
    host: str = "cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local"
    port: int = 443
    base_url: str = "https://cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local:443"
    token_path: str = "/api/rest/v1.0/OAuthToken"
    send_path: str = CST_SEND_LIR_PATH
    update_path: str = CST_UPDATE_LIR_PATH
    delete_path: str = CST_DELETE_LIR_PATH
    get_path: str = CST_GET_LIR_PATH
    auth_username: str = ""
    accept_language: str = CST_DEFAULT_ACCEPT_LANGUAGE
    auth_password_configured: bool = False
    api_access_key_configured: bool = False
    user_key_configured: bool = False
    verify_ssl: bool = False
    connection_timeout: int = 10
    read_timeout: int = 30
    token_refresh_buffer_seconds: int = 300
    token_expires_at: str = ""
    token_cached: bool = False
    schedule_time: str = "00:30"
    schedule_timezone: str = "Asia/Riyadh"
    last_scheduled_run_date: str = ""
    last_scheduled_run_at: str = ""
    batch_size_limit: int = 500
    send_payload_batch_size: int = 1
    hourly_request_limit: int = 1000
    updated_at: str


class CstConnectionTestResponse(BaseModel):
    success: bool
    message: str
    token_path: str
    token_expires_at: str
    tested_at: str


class CstConfigUpdate(BaseModel):
    enabled: bool | None = None
    service_provider_id: str | None = None
    auto_execute: bool | None = None
    scheduled_sync_enabled: bool | None = None
    send_enabled: bool | None = None
    update_enabled: bool | None = None
    delete_enabled: bool | None = None
    get_enabled: bool | None = None
    integration_mode: str | None = None
    host: str | None = None
    port: int | None = None
    base_url: str | None = None
    token_path: str | None = None
    send_path: str | None = None
    update_path: str | None = None
    delete_path: str | None = None
    get_path: str | None = None
    auth_username: str | None = None
    auth_password: str | None = None
    api_access_key: str | None = None
    user_key: str | None = None
    accept_language: str | None = None
    verify_ssl: bool | None = None
    connection_timeout: int | None = None
    read_timeout: int | None = None
    token_refresh_buffer_seconds: int | None = None
    schedule_time: str | None = None
    schedule_timezone: str | None = None
    batch_size_limit: int | None = None
    send_payload_batch_size: int | None = None
    hourly_request_limit: int | None = None


class DatabaseConnectionStatus(BaseModel):
    current_engine: str
    sqlite_path: str
    database_url_configured: bool
    database_url_redacted: str = ""
    postgres_driver_available: bool
    postgres_runtime_supported: bool
    message: str


class DatabaseConnectionTestRequest(BaseModel):
    host: str = "localhost"
    port: int = 5432
    database: str = "lir"
    username: str = "lir_app"
    password: str = ""
    ssl_mode: str = "prefer"
    connect_timeout: int = 10


class DatabaseConnectionTestResponse(BaseModel):
    success: bool
    message: str
    server_version: str = ""
    database: str = ""
    username: str = ""
    tested_at: str

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


class CstPendingPushResult(BaseModel):
    started_at: str
    completed_at: str
    requested_jobs: int = 0
    processed_jobs: int = 0
    success_jobs: int = 0
    failed_jobs: int = 0
    pending_jobs: int = 0
    not_required_jobs: int = 0
    message: str = ""
    effective_limit: int = 0
    batch_size_limit: int = 0
    send_payload_batch_size: int = 1
    hourly_request_limit: int = 0
    rate_delay_seconds: float = 0
    force_api_override: bool = False
    resource_scope: str = "all"
    jobs: list[CstSyncJob] = Field(default_factory=list)



class CstManualMigrationRequest(BaseModel):
    limit: int = 0
    execute_immediately: bool = False
    force_api_override: bool = False
    include_existing_transactions: bool = False
    only_cst_ready: bool = True
    resource_scope: str = "all"


class CstMigrationReviewRequest(BaseModel):
    page: int = 1
    page_size: int = 25
    search: str = ""
    assignment_status: str = "all"
    transaction_type: str = "all"
    validation_status: str = "all"
    created_from: str = ""
    created_to: str = ""
    resource_scope: str = "assigned"
    include_existing_transactions: bool = False


class CstMigrationReviewItem(BaseModel):
    review_id: str
    resource_uuid: str
    operation: str
    cidr: str
    start_ip: str = ""
    end_ip: str = ""
    customer_name: str = ""
    customer_id: str = ""
    service_id: str = ""
    transaction_id: str = ""
    assignment_status_id: int = 1
    assignment_status: str = "Unassigned"
    validation_status: str = "VALID"
    validation_errors: list[str] = Field(default_factory=list)
    cst_sync_status: str = ""
    source_entity_type: str = ""
    created_at: str = ""
    eligible: bool = True
    reason: str = ""


class CstMigrationReviewCounts(BaseModel):
    total_matching: int = 0
    included_default: int = 0
    excluded: int = 0
    selected: int = 0
    valid: int = 0
    invalid: int = 0


class CstMigrationReviewResponse(BaseModel):
    page: int = 1
    page_size: int = 25
    total: int = 0
    resource_scope: str = "assigned"
    generated_at: str = ""
    items: list[CstMigrationReviewItem] = Field(default_factory=list)
    all_matching_review_ids: list[str] = Field(default_factory=list)
    counts: CstMigrationReviewCounts = Field(default_factory=CstMigrationReviewCounts)


class CstMigrationReviewCreateRequest(BaseModel):
    included_review_ids: list[str] = Field(default_factory=list)
    excluded_review_ids: list[str] = Field(default_factory=list)
    resource_scope: str = "assigned"
    final_confirmed: bool = False
    created_by: str = "admin"


class CstMigrationReviewRejectedItem(BaseModel):
    review_id: str
    resource_uuid: str = ""
    cidr: str = ""
    operation: str = ""
    reason: str


class CstMigrationReviewCreateResult(BaseModel):
    batch_id: str = ""
    created_jobs: int = 0
    included_transactions: int = 0
    rejected_count: int = 0
    skipped_count: int = 0
    created_at: str = ""
    created_by: str = "admin"
    message: str = ""
    rejected: list[CstMigrationReviewRejectedItem] = Field(default_factory=list)
    jobs: list[CstSyncJob] = Field(default_factory=list)

class CstMigrationJobStats(BaseModel):
    batch_id: str
    workflow_type: str = ""
    status: str = ""
    total_jobs: int = 0
    pending_jobs: int = 0
    running_jobs: int = 0
    success_jobs: int = 0
    failed_jobs: int = 0
    blocked_jobs: int = 0
    not_required_jobs: int = 0
    external_api_calls: int = 0
    total_transactions: int = 0
    created_at: str = ""
    completed_at: str = ""
    last_error: str = ""


class CstManualMigrationResult(BaseModel):
    batch_id: str = ""
    created_jobs: int = 0
    processed_jobs: int = 0
    eligible_resources: int = 0
    skipped_resources: int = 0
    message: str = ""
    stats: CstMigrationJobStats | None = None
    jobs: list[CstSyncJob] = Field(default_factory=list)

class PartialReassignmentRequest(AssignmentCreate):
    pass


class PartialReassignmentFragment(BaseModel):
    id: str
    operation_id: str
    kind: str
    cidr: str
    cst_operation: str
    transaction_id: str
    resource_uuid: str
    cst_job_id: str = ""
    status: str = "PENDING"
    last_error: str = ""
    created_at: str
    updated_at: str


class PartialReassignmentResult(BaseModel):
    id: str
    original_assignment_id: str
    original_cidr: str
    requested_cidr: str
    status: str
    original_transaction_id: str = ""
    assigned_transaction_id: str = ""
    message: str = ""
    created_at: str
    updated_at: str
    completed_at: str = ""
    fragments: list[PartialReassignmentFragment] = Field(default_factory=list)
    jobs: list[CstSyncJob] = Field(default_factory=list)

class ResourceWithAssignment(ResourceRecord):
    assignment: AssignmentDetailRecord | None = None


SUPPORTED_RESOURCE_STATUSES = {"ASSIGNED_TO_BUSINESS", "RESERVED", "AVAILABLE", "RETIRED"}
SUPPORTED_OWNERSHIP_TYPES = {"BUSINESS", "INDIVIDUAL", "INTERNAL", "INFRASTRUCTURE", "POOL"}
CST_SYNC_STATUSES = {"NOT_CONFIGURED", "NOT_REQUIRED", "PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED"}
RIPE_SYNC_STATUSES = {"PENDING", "SUCCESS", "FAILED", "NOT_REQUIRED"}
RIPE_DISCOVERY_SOURCE_SYSTEM = "RIPE IP Pools Discovery"
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
    business_customer_assignment = data["assignment_status_id"] == 3 or (data.get("assignment_target_type") or "").lower() == "business_customer"
    data["customer_type"] = normalize_lir_customer_type(data.get("customer_type")) if business_customer_assignment else "NA"
    data["subnet_type"] = normalize_lir_subnet_type(data.get("subnet_type"))
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


def is_ripe_discovered_pool(pool: Pool) -> bool:
    return str(pool.source_system or "").strip() == RIPE_DISCOVERY_SOURCE_SYSTEM


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


def siebel_config_from_row(row: sqlite3.Row) -> SiebelConfigOut:
    data = dict(row)
    return SiebelConfigOut(
        username=str(data.get("username") or "LIR_USER"),
        dsn=str(data.get("dsn") or "172.31.23.101:1525/SIDB"),
        password_configured=bool(data.get("encrypted_password")),
        connection_timeout=int(data.get("connection_timeout") or 10),
        query_sql=str(data.get("query_sql") or ""),
        updated_at=str(data.get("updated_at") or ""),
    )


def ripe_api_config_from_row(row: sqlite3.Row) -> ripe_service.RipeApiConfig:
    data = dict(row)
    return ripe_service.RipeApiConfig(
        base_url=str(data.get("base_url") or "https://rest.db.ripe.net"),
        username=str(data.get("username") or ""),
        password=decrypt_secret(str(data.get("encrypted_password") or "")),
        read_timeout=int(data.get("read_timeout") or 30),
        default_maintainer=str(data.get("default_maintainer") or "ITC-NOC-MNT"),
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
    network = network_of(pool)
    ip_type = "PRIVATE" if network.is_private else "PUBLIC"
    updated_at = now_iso()
    default_cst_sync_status = "PENDING" if ip_type == "PUBLIC" and status != "RETIRED" else "NOT_REQUIRED"
    default_ripe_sync_status = "PENDING" if network.is_global else "NOT_REQUIRED"
    cst_sync_status = existing.cst_sync_status if existing and ip_type == "PUBLIC" else default_cst_sync_status
    ripe_sync_status = existing.ripe_sync_status if existing and network.is_global else default_ripe_sync_status
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
        cst_sync_status=cst_sync_status,
        ripe_sync_status=ripe_sync_status,
        ip_type=ip_type,
        root_pool_uuid=existing.root_pool_uuid if existing and existing.root_pool_uuid else pool_resource_uuid(pool),
        source_entity_type="pool",
        source_entity_id=pool.id,
        created_at=existing.created_at if existing else pool.created_at,
        updated_at=updated_at,
    )


def resource_record_for_assignment(assignment: Assignment, existing: ResourceRecord | None = None, connection: sqlite3.Connection | None = None) -> ResourceRecord:
    network = network_of(assignment)
    ip_type = "PRIVATE" if network.is_private else "PUBLIC"
    root_pool = root_pool_for_network(network, connection)
    root_pool_uuid = pool_resource_uuid(root_pool) if root_pool else ""
    parent_resource_uuid = "" if existing and existing.resource_uuid == root_pool_uuid else root_pool_uuid
    updated_at = now_iso()
    status_id = normalize_assignment_status_id(assignment.assignment_status_id, assignment)
    service_id = assignment.service_id or assignment.service_instance_id
    hide_individual_identity = individual_assignment(assignment)
    cst_sync_status = "NOT_REQUIRED" if ip_type == "PRIVATE" else assignment.cst_sync_status or "PENDING"
    ripe_sync_status = assignment.ripe_sync_status if network.is_global else "NOT_REQUIRED"
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
        city=assignment.city,
        region=assignment.region,
        full_name="" if hide_individual_identity else assignment.full_name,
        mobile_number="" if hide_individual_identity else normalize_cst_mobile_number(assignment.mobile_number) or normalize_cst_mobile_number(assignment.contact_number) or assignment.mobile_number or assignment.contact_number,
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
        cst_sync_status=cst_sync_status,
        cst_sync_ready=assignment.cst_sync_ready,
        cst_validation_status=assignment.cst_validation_status,
        cst_validation_errors=assignment.cst_validation_errors,
        cst_validation_warnings=assignment.cst_validation_warnings,
        migration_conflict_status=assignment.migration_conflict_status,
        migration_conflict_reason=assignment.migration_conflict_reason,
        migration_conflict_group=assignment.migration_conflict_group,
        ripe_sync_status=ripe_sync_status or "PENDING",
        ip_type=ip_type,
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
        service_order_id=assignment.service_order_id,
        siebel_order_number=assignment.siebel_order_number,
        bss_customer_id=assignment.bss_customer_id,
        siebel_last_sync_at=assignment.siebel_last_sync_at,
        siebel_last_checked_at=assignment.siebel_last_checked_at,
        siebel_payload_hash=assignment.siebel_payload_hash,
        siebel_payload_json=assignment.siebel_payload_json,
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
        cst_sync_ready=assignment.cst_sync_ready,
        cst_validation_status=assignment.cst_validation_status,
        cst_validation_errors=assignment.cst_validation_errors,
        cst_validation_warnings=assignment.cst_validation_warnings,
        migration_conflict_status=assignment.migration_conflict_status,
        migration_conflict_reason=assignment.migration_conflict_reason,
        migration_conflict_group=assignment.migration_conflict_group,
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


SIEBEL_ASSIGNMENT_ALIASES: dict[str, list[str]] = {
    "service_order_id": ["ORDER_NUM", "ORDER_NUMBER", "ORDER_ID", "SERVICE_ORDER_ID", "ORDER_REF"],
    "bss_customer_id": ["BSS_CUSTOMER_ID", "SIEBEL_CUSTOMER_ID", "CUSTOMER_ID", "ACCOUNT_ID", "ACCOUNT_NUMBER", "BILLING_ACCOUNT_ID"],
    "logical_resource_id": ["LOGICAL_RESOURCE_ID", "RESOURCE_ID", "ASSET_INTEG_ID"],
    "service_id": ["SERVICE_ID", "SRV_ID", "SERIAL_NUM", "ASSET_ID", "ASSET_INTEG_ID"],
    "service_instance_id": ["SERVICE_INSTANCE_ID", "SERVICE_ID", "SERIAL_NUM", "ASSET_ID", "ORDER_NUM"],
    "service_instance_name": ["SERVICE_INSTANCE_NAME", "SERVICE_NAME", "PRODUCT_NAME", "ASSET_NAME"],
    "service_type": ["SERVICE_TYPE", "PRODUCT_TYPE"],
    "service_category": ["SERVICE_CATEGORY", "PRODUCT_CATEGORY"],
    "service_description": ["SERVICE_DESCRIPTION", "SERVICE_DESC", "PRODUCT_DESCRIPTION", "PRODUCT_NAME"],
    "product_specification_id": ["PRODUCT_SPECIFICATION_ID", "PROD_SPEC_ID", "PRODUCT_ID"],
    "product_specification_name": ["PRODUCT_SPECIFICATION_NAME", "PRODUCT_NAME", "PROD_NAME"],
    "product_offering_id": ["PRODUCT_OFFERING_ID", "OFFER_ID"],
    "product_offering_name": ["PRODUCT_OFFERING_NAME", "OFFER_NAME"],
    "product_instance_id": ["PRODUCT_INSTANCE_ID", "ASSET_ID", "INSTANCE_ID"],
    "customer_id": ["CUSTOMER_ID", "CUST_ID", "ACCOUNT_ID", "PARTY_ID"],
    "customer_name": ["CUSTOMER_NAME", "ACCOUNT_NAME", "ORGANIZATION_NAME", "ORG_NAME", "NAME"],
    "organization_name": ["ORGANIZATION_NAME", "ORG_NAME", "ACCOUNT_NAME", "CUSTOMER_NAME"],
    "organization_id": ["ORGANIZATION_ID", "ORG_ID", "X_ITC_B2B_COMMERCIAL_REGIS_NUM", "X_ITC_B2B_UNIFIED_NUMBER", "X_ITC_B2B_AP_IDENTITY_ID", "ACCOUNT_ID", "ACCOUNT_NUMBER", "CUSTOMER_ID"],
    "customer_type": ["CUSTOMER_TYPE", "ACCOUNT_TYPE", "OU_TYPE_CD", "X_ITC_ACNT_SECTOR"],
    "customer_type_id": ["CUSTOMER_TYPE_ID", "CUST_TYPE_ID"],
    "customer_account_id": ["CUSTOMER_ACCOUNT_ID", "ACCOUNT_ID", "BILL_ACCNT_ID"],
    "customer_segment": ["CUSTOMER_SEGMENT", "SEGMENT", "MARKET_SEGMENT"],
    "commercial_reg_id": ["COMMERCIAL_REG_ID", "CR_NUMBER", "CR_NUM", "COMM_REG_ID", "X_ITC_B2B_COMMERCIAL_REGIS_NUM"],
    "unified_number": ["UNIFIED_NUMBER", "UNIFIED_NUM", "700_NUMBER", "X_ITC_B2B_UNIFIED_NUMBER"],
    "contact_name": ["CONTACT_NAME", "PRIMARY_CONTACT", "FULL_NAME", "X_ITC_B2B_AP_NAME", "FST_NAME", "LAST_NAME"],
    "contact_number": ["CONTACT_NUMBER", "CONTACT_PHONE", "MOBILE_NUMBER", "PHONE_NUMBER", "MAIN_PH_NUM", "CON_PHONE_NUM"],
    "contact_email": ["CONTACT_EMAIL", "EMAIL", "EMAIL_ADDRESS", "MAIN_EMAIL_ADDR", "CON_EMAIL"],
    "full_name": ["FULL_NAME", "CONTACT_NAME", "PRIMARY_CONTACT", "X_ITC_B2B_AP_NAME"],
    "mobile_number": ["MOBILE_NUMBER", "CONTACT_NUMBER", "CONTACT_PHONE", "PHONE_NUMBER", "MAIN_PH_NUM", "CON_PHONE_NUM"],
    "id_number": ["CONTACT_ID_NUM", "ID_NUMBER", "NATIONAL_ID", "IQAMA_ID", "X_ITC_B2B_AP_IDENTITY_ID"],
    "email": ["EMAIL", "EMAIL_ADDRESS", "CONTACT_EMAIL", "MAIN_EMAIL_ADDR", "CON_EMAIL"],
    "region": ["REGION", "REGION_NAME", "PROVINCE", "ACCOUNT_REGION"],
    "region_id": ["REGION_ID", "PROVINCE_ID"],
    "city": ["CITY", "CITY_NAME", "ACCOUNT_CITY"],
    "city_id": ["CITY_ID"],
    "site": ["SITE", "SITE_NAME", "LOCATION_NAME"],
    "site_id": ["SITE_ID"],
    "location_name": ["LOCATION_NAME", "ADDRESS", "SITE_NAME"],
    "access_technology": ["ACCESS_TECHNOLOGY", "ACCESS_TECH", "TECHNOLOGY", "PRODUCT_NAME"],
    "access_technology_id": ["ACCESS_TECHNOLOGY_ID", "ACCESS_TECH_ID"],
}


def normalized_siebel_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def serialize_siebel_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def first_siebel_value(row: dict[str, str], aliases: list[str]) -> str:
    normalized = {normalized_siebel_key(key): value for key, value in row.items()}
    for alias in aliases:
        value = normalized.get(normalized_siebel_key(alias))
        if value:
            return value
    return ""



CST_REGION_ROWS: list[tuple[int, str]] = [(1, 'Riyadh'), (2, 'Qassim'), (3, 'Makkah'), (4, 'Al Madinah'), (5, 'Eastern Region'), (6, 'Al-Jouf'), (7, 'Tabuk'), (8, 'The Northern Border'), (9, 'Hail'), (10, 'Asir'), (11, 'Najran'), (12, 'Baha'), (13, 'Jazan'), (14, 'Central'), (15, 'Western'), (16, 'Eastern')]

CST_CITY_ROWS: list[tuple[int, str, int]] = [(1, "Surat 'Obiedah", 10), (2, 'Hael', 9), (3, 'Al-Ghazalah', 9), (4, 'Al-Kharj', 1), (5, 'Al-Qariyat', 6), (6, "Yanb'u Al-Bahr", 4), (7, 'Tarif', 8), (8, 'Dhahran Al-Janoub', 10), (9, 'Al-Qonfazah', 3), (10, 'Sakaka', 6), (11, 'Makkah Al-Mukaramah', 3), (12, "Baq'aa", 9), (13, 'Al-Taief', 3), (14, 'Afif', 1), (15, 'Al-Darb', 13), (16, 'Tabuk', 7), (17, 'Abu Arish', 13), (18, 'Khaibar', 4), (19, 'Al-Dareiyah', 1), (20, 'Jazan', 13), (21, 'Habouna', 11), (22, 'Al-Jamom', 3), (23, 'Al-Dawadmi', 1), (24, 'Ras Tannoura', 5), (25, 'Al-Mahd', 4), (26, 'Oniezah', 2), (27, 'Al-Kamel', 3), (28, 'Sharorah', 11), (29, 'Samtah', 13), (30, 'Balqarn', 10), (31, 'Baljurashi', 12), (32, 'Auon Al-Jawa', 2), (33, 'Tathlieth', 10), (34, "Al-'Ola", 4), (35, 'Raith', 13), (36, 'Shaqra', 1), (37, 'Al-Jubial', 5), (38, 'Al-Bakiriyah', 2), (39, 'Abgig', 5), (40, 'Buriedah', 2), (41, 'Al-Riyadh', 1), (42, 'Tarbah', 3), (43, 'Baish', 13), (44, 'Fursan', 13), (45, 'Khamies Mihiesth', 10), (46, 'Al-Qura', 12), (47, 'Al-Khurmah', 3), (48, 'Mahaiel', 10), (49, "Al-'Aardah", 13), (50, 'Rabigh', 3), (51, "Al-'Aqiq", 12), (52, 'Al-Laith', 3), (53, 'Al-Ras', 2), (54, 'Al-Madinah Al-Monawarah', 4), (55, 'Al-Aflaj', 1), (56, 'AL-Ahsa', 5), (57, 'Al-Hrath', 13), (58, 'Al-Hanakiayh', 4), (59, 'Al-Nams', 10), (60, 'Al-Hariq', 1), (61, 'Al-Dammam', 5), (62, 'Al-Badaiee', 2), (63, 'Qulwah', 12), (64, 'Dhamd', 13), (65, 'Jeddah', 3), (66, "Al-Nu'aeriyah", 5), (67, 'Al-Kharkir', 11), (68, 'Thar', 11), (69, "Rijal Alma'a", 10), (70, 'Al-Qateif', 5), (71, "Rafha'", 8), (72, 'Al-Aidaby', 13), (73, 'Al-Ghat', 1), (74, 'Al-Shamasiyah', 2), (75, 'Sabiaa', 13), (76, 'Al-Mandak', 12), (77, 'Badr', 4), (78, 'Najran', 11), (79, 'Ahad Rufiedah', 10), (80, 'Al-Mukwah', 12), (81, 'Hafr Al-Batin', 5), (82, 'Hatat Bani Tamim', 1), (83, 'Abha', 10), (84, 'Al-Baha', 12), (85, 'Al-Nahbaniyah', 2), (86, 'Al-Zalfa', 1), (87, 'Al-Maznab', 2), (88, 'Al-Mozahimiyah', 1), (89, 'Al-Qiwaiyah', 1), (90, 'Darma', 1), (91, 'Al-Asyah', 2), (92, 'Al-Khafji', 5), (93, 'Thadiq', 1), (94, 'Haql', 7), (95, 'Al-Khobar', 5), (96, 'Yiadmah', 11), (97, 'Raniyah', 3), (98, 'Amlaj', 7), (99, 'Dawmat Al-Jandal', 6), (100, "Qariyat Al-'Oliyah", 5), (101, 'Khabash', 11), (102, 'Biesha', 10), (103, 'Harimla', 1), (104, 'Badr Al-Janoub', 11), (105, 'Ahad Al-Maserhah', 13), (106, 'Dhiba', 7), (107, "Al-Majma'ah", 1), (108, 'Khulies', 3), (109, 'Al-Dair', 13), (110, 'Wadi Al-Dawasir', 1), (111, 'Ramah', 1), (112, 'Arar', 8), (113, 'Al-Majardah', 10), (114, 'Al-Shanan', 9), (115, 'Al Wajh', 7), (116, "Tima'a", 7), (117, 'Al-Salil', 1), (118, 'Riyad Al-Khobara', 2), (119, 'Adom', 3), (120, 'Al-Aaes', 4), (121, 'Al-Aradiat', 3), (122, 'Al-Bida', 7), (123, 'Al-Birak', 10), (124, 'Al-Haiet', 9), (125, 'Al-Hujra', 12), (126, 'Al-Kurmah', 3), (127, 'Al-Moyah', 3), (128, "Al-'Odied", 5), (129, 'Al-Raith', 13), (130, 'Al-Salimi', 9), (131, 'Al-Shamli', 9), (132, 'Al-Tiwal', 13), (133, 'Al-Uwayqilah', 8), (134, 'Al-Wajh', 7), (135, 'Aqlat Al-Soqor', 2), (136, 'Bahrah', 3), (137, 'Bani Hasan', 12), (138, 'Bariq', 10), (139, 'Dariyah', 2), (140, "Far'at Ghamid Al-Zinad", 12), (141, 'Fifa', 13), (142, 'Huroub', 13), (143, 'Huroub', 13), (144, 'Maisan', 3), (145, 'Maisan', 3), (146, 'Maowqaq', 9), (147, 'Maraat', 1), (148, 'Tabrigl', 6), (149, 'Tanoumah', 10), (150, 'Turieb', 10), (151, "Wadi Al-Far'a", 4), (152, 'Other', 1), (153, 'Other', 1), (154, 'Al Dhahran', 10)]

CST_ACCESS_TECHNOLOGY_BY_ID = {1: "FTTH", 2: "ADSL", 3: "Mobile", 4: "FWA"}
CST_CUSTOMER_TYPE_BY_ID = {1: "Government", 2: "Non-Government"}

CST_REGION_ALIASES = {
    "central": 14,
    "centralregion": 14,
    "western": 15,
    "westernregion": 15,
    "eastern": 16,
    "east": 16,
    "easternsales": 16,
    "riyadhregion": 1,
    "makkahregion": 3,
    "madinahregion": 4,
    "easternprovince": 5,
    "easternregion": 5,
}

CST_CITY_ALIASES = {
    "riyadh": 41,
    "dammam": 61,
    "khobar": 95,
    "dhahran": 154,
    "jubail": 37,
    "qatif": 70,
    "qateef": 70,
    "ahsa": 56,
    "alhasa": 56,
    "hasa": 56,
    "madinah": 54,
    "medina": 54,
    "makkah": 11,
    "mecca": 11,
    "jeddah": 65,
    "buraidah": 40,
    "buraydah": 40,
    "hail": 2,
    "haiel": 2,
    "khamismushait": 45,
    "khamiesmushait": 45,
    "najran": 78,
    "abha": 83,
    "tabuk": 16,
    "jazan": 20,
    "jizan": 20,
    "sakaka": 10,
    "arar": 112,
    "hafralbatin": 81,
    "yanbu": 6,
    "taif": 13,
    "taief": 13,
}


def cst_lookup_key(value: object) -> str:
    return normalized_siebel_key(str(value or "").replace("&", "and"))


def cst_name_variants(value: object) -> set[str]:
    key = cst_lookup_key(value)
    variants = {key} if key else set()
    for prefix in ("al", "the"):
        if key.startswith(prefix) and len(key) > len(prefix) + 2:
            variants.add(key[len(prefix):])
    return variants


def cst_build_lookup(rows: list[tuple[int, str]]) -> dict[str, int]:
    lookup: dict[str, int] = {}
    for item_id, name in rows:
        for variant in cst_name_variants(name):
            lookup.setdefault(variant, item_id)
    return lookup


CST_REGION_LOOKUP = cst_build_lookup(CST_REGION_ROWS)
CST_REGION_LOOKUP.update(CST_REGION_ALIASES)
CST_CITY_LOOKUP = cst_build_lookup([(city_id, name) for city_id, name, _region_id in CST_CITY_ROWS])
CST_CITY_LOOKUP.update(CST_CITY_ALIASES)
CST_CITY_REGION_BY_ID = {city_id: region_id for city_id, _name, region_id in CST_CITY_ROWS}


def cst_lookup_id(value: object, lookup: dict[str, int], allowed_ids: set[int]) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.isdigit():
        item_id = int(text)
        return item_id if item_id in allowed_ids else None
    for variant in cst_name_variants(text):
        item_id = lookup.get(variant)
        if item_id in allowed_ids:
            return item_id
    return None


def cst_region_id(value: object) -> int | None:
    return cst_lookup_id(value, CST_REGION_LOOKUP, {item_id for item_id, _name in CST_REGION_ROWS})


def cst_city_id(value: object) -> int | None:
    return cst_lookup_id(value, CST_CITY_LOOKUP, {item_id for item_id, _name, _region_id in CST_CITY_ROWS})


def cst_customer_type_id(value: object) -> int | None:
    text = str(value or "").strip()
    if text in {"1", "2"}:
        return int(text)
    key = cst_lookup_key(text)
    if not key:
        return None
    if any(token in key for token in ["nongovernment", "nonpublic", "private", "enterprise", "business", "commercial", "corporate"]):
        return 2
    if any(token in key for token in ["government", "govt", "gov", "ministry", "municipality", "publicsector", "semigov"]):
        return 1
    return 2


def cst_access_technology_id(value: object) -> int | None:
    text = str(value or "").strip()
    if text in {"1", "2", "3", "4"}:
        return int(text)
    key = cst_lookup_key(text)
    if not key:
        return None
    if any(token in key for token in ["ftth", "fiber", "fibre", "gpon"]):
        return 1
    if any(token in key for token in ["adsl", "dsl"]):
        return 2
    if any(token in key for token in ["mobile", "lte", "5g", "4g"]):
        return 3
    if any(token in key for token in ["fwa", "fixedwireless", "wireless"]):
        return 4
    return None


def cst_phone_without_extension(value: object) -> str:
    text = str(value or "").strip()
    return re.split(r"(?:\s+|(?<=\d))(?:extension|ext|ex)\.?\s*", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def normalize_cst_mobile_number(value: object) -> str:
    digits = re.sub(r"\D", "", cst_phone_without_extension(value))
    if digits == CST_FALLBACK_PHONE_NUMBER:
        return CST_FALLBACK_PHONE_NUMBER
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 10 and digits[1] in {"1", "5"}:
        digits = "966" + digits[1:]
    elif len(digits) == 9 and digits[0] in {"1", "5"}:
        digits = "966" + digits
    if re.fullmatch(r"9665\d{8}", digits):
        return digits
    return digits if re.fullmatch(r"9661\d{8}", digits) else ""


def normalize_cst_id_number(value: object) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if re.fullmatch(r"\d{10}", digits) else ""


def normalize_cst_email(value: object) -> str:
    email = str(value or "").strip().lower()
    return email if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) else ""


def normalize_cst_contact_fields(patch: dict[str, str]) -> None:
    normalized_mobile = normalize_cst_mobile_number(patch.get("mobile_number", ""))
    normalized_contact = normalize_cst_mobile_number(patch.get("contact_number", ""))
    if normalized_mobile:
        patch["mobile_number"] = normalized_mobile
    elif normalized_contact:
        patch["mobile_number"] = normalized_contact
    elif patch.get("mobile_number") or patch.get("contact_number"):
        patch["mobile_number"] = CST_FALLBACK_PHONE_NUMBER
    if normalized_contact:
        patch["contact_number"] = normalized_contact
    elif patch.get("contact_number"):
        patch["contact_number"] = CST_FALLBACK_PHONE_NUMBER
    normalized_id = normalize_cst_id_number(patch.get("id_number", ""))
    if normalized_id:
        patch["id_number"] = normalized_id
    for field in ["email", "contact_email"]:
        normalized = normalize_cst_email(patch.get(field, ""))
        if normalized:
            patch[field] = normalized


def apply_cst_lookup_mappings(patch: dict[str, str], row: dict[str, str]) -> None:
    customer_type_source = patch.get("customer_type_id") or patch.get("customer_type") or first_siebel_value(row, ["X_ITC_ACNT_SECTOR", "OU_TYPE_CD"])
    customer_type = cst_customer_type_id(customer_type_source)
    if customer_type is not None:
        patch["customer_type_id"] = str(customer_type)
        patch["customer_type"] = CST_CUSTOMER_TYPE_BY_ID[customer_type]

    region_source = patch.get("region_id") or patch.get("region") or first_siebel_value(row, ["ACCOUNT_REGION"])
    region_id = cst_region_id(region_source)
    if region_id is not None:
        patch["region_id"] = str(region_id)
    if region_source and not patch.get("region"):
        patch["region"] = str(region_source).strip()

    city_source = patch.get("city_id") or patch.get("city") or first_siebel_value(row, ["ACCOUNT_CITY", "CITY", "CITY_NAME"])
    city_id = cst_city_id(city_source)
    if city_id is not None:
        patch["city_id"] = str(city_id)
        city_region_id = CST_CITY_REGION_BY_ID.get(city_id)
        if city_region_id and not patch.get("region_id"):
            patch["region_id"] = str(city_region_id)
    if city_source and not patch.get("city"):
        patch["city"] = str(city_source).strip()

    access_source = patch.get("access_technology_id") or patch.get("access_technology") or patch.get("service_description") or first_siebel_value(row, ["PRODUCT_NAME"])
    access_id = cst_access_technology_id(access_source)
    if access_id is not None:
        patch["access_technology_id"] = str(access_id)
        patch["access_technology"] = CST_ACCESS_TECHNOLOGY_BY_ID[access_id]

    normalize_cst_contact_fields(patch)


def stable_json_hash(row: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(row, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def assignment_patch_from_siebel_row(row: dict[str, str], service_id: str) -> dict[str, str]:
    patch: dict[str, str] = {}
    for field, aliases in SIEBEL_ASSIGNMENT_ALIASES.items():
        value = first_siebel_value(row, aliases)
        if value:
            patch[field] = value
    checked_at = now_iso()
    patch["assignment_target_type"] = "business_customer"
    patch["service_id"] = patch.get("service_id") or service_id
    patch["siebel_order_number"] = patch.get("siebel_order_number") or patch.get("service_order_id") or ""
    patch["siebel_last_sync_at"] = checked_at
    patch["siebel_last_checked_at"] = checked_at
    patch["siebel_payload_hash"] = stable_json_hash(row)
    patch["siebel_payload_json"] = json.dumps(row, ensure_ascii=False, sort_keys=True)
    patch["id_number"] = normalize_cst_id_number(patch.get("id_number", "")) or CST_FALLBACK_ID_NUMBER
    patch["customer_type"] = patch.get("customer_type") or "Enterprise"
    if not patch.get("full_name"):
        name_parts = [first_siebel_value(row, ["PER_TITLE"]), first_siebel_value(row, ["FST_NAME"]), first_siebel_value(row, ["LAST_NAME"])]
        full_name = " ".join(part.strip() for part in name_parts if part.strip())
        if full_name:
            patch["full_name"] = full_name
            patch.setdefault("contact_name", full_name)
    if not patch.get("organization_id"):
        patch["organization_id"] = patch.get("commercial_reg_id") or patch.get("unified_number") or patch.get("bss_customer_id") or ""
    apply_cst_lookup_mappings(patch, row)
    patch["customer_segment"] = patch.get("customer_segment") or "Enterprise"
    patch["service_type"] = patch.get("service_type") or "CustomerFacingService"
    patch["service_category"] = patch.get("service_category") or "L3 Service"
    patch["l3_service"] = patch.get("l3_service") or "MPLS L3VPN"
    patch["service"] = patch.get("service") or patch.get("service_description") or "Business IP assignment"
    patch["owner"] = "Business Customer"
    return patch


def syncable_bss_fields() -> list[str]:
    return [
        "bss_customer_id",
        "customer_id",
        "customer_name",
        "organization_name",
        "organization_id",
        "customer_account_id",
        "customer_segment",
        "commercial_reg_id",
        "unified_number",
        "contact_name",
        "contact_number",
        "contact_email",
        "full_name",
        "mobile_number",
        "email",
        "city",
        "region",
        "city_id",
        "region_id",
        "site",
        "site_id",
        "location_name",
        "service_instance_id",
        "service_instance_name",
        "service_id",
        "service_description",
        "product_instance_id",
        "service_characteristics",
        "access_technology",
        "access_technology_id",
    ]


def bss_sync_audit_from_row(row: sqlite3.Row) -> BssSyncAuditRecord:
    return BssSyncAuditRecord(**dict(row))


def record_bss_sync_audit(
    connection: sqlite3.Connection,
    assignment_id: str,
    service_id: str,
    order_number: str,
    changed_field: str,
    old_value: str = "",
    new_value: str = "",
    status: str = "UPDATED",
) -> BssSyncAuditRecord:
    record = BssSyncAuditRecord(
        id=str(uuid4()),
        assignment_id=assignment_id,
        service_id=service_id,
        siebel_order_number=order_number,
        changed_field=changed_field,
        old_value=old_value or "",
        new_value=new_value or "",
        synced_at=now_iso(),
        status=status,
    )
    connection.execute(
        """
        INSERT INTO bss_sync_audit (id, assignment_id, service_id, siebel_order_number, changed_field, old_value, new_value, synced_at, status)
        VALUES (:id, :assignment_id, :service_id, :siebel_order_number, :changed_field, :old_value, :new_value, :synced_at, :status)
        """,
        record.model_dump(),
    )
    return record


def validate_siebel_query(query_sql: str) -> str:
    query = query_sql.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Siebel query SQL is not configured")
    if not query.lower().startswith("select"):
        raise HTTPException(status_code=400, detail="Siebel query must be a SELECT statement")
    if ":service_id" not in query.lower():
        raise HTTPException(status_code=400, detail="Siebel query must include :service_id bind variable")
    return query



def normalize_lir_customer_type(value: object) -> str:
    normalized = str(value or "").strip().upper().replace("-", "").replace("_", "").replace(" ", "")
    if not normalized:
        return "NA"
    if normalized in {"CORP", "CORPORATE", "BUSINESS", "B2B", "ENTERPRISE", "GOV", "GOVERNMENT", "GOVERNMENTAL"}:
        return "CORP"
    if normalized in {"RESI", "RES", "RESIDENTIAL", "INDIVIDUAL", "CONSUMER", "HOME", "PERSONAL"}:
        return "RESI"
    if normalized in {"COMP", "COMPANY"}:
        return "COMP"
    return normalized if normalized in LIR_CUSTOMER_TYPE_CODES else "NA"


def normalize_lir_subnet_type(value: object) -> str:
    normalized = str(value or "").strip().upper().replace("-", "").replace("_", "").replace(" ", "")
    if not normalized:
        return "NA"
    if normalized in LIR_SUBNET_TYPE_CODES:
        return normalized
    lan_match = re.fullmatch(r"LAN0*([1-8])", normalized)
    if lan_match:
        return f"LAN{lan_match.group(1)}"
    ptp_match = re.fullmatch(r"PTP0*([1-3])", normalized)
    if ptp_match:
        return f"PTP{ptp_match.group(1)}"
    return "NA"

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
    host = str(values.get("host") or "cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local")
    port = int(values.get("port") or 443)
    base_url = str(values.get("base_url") or f"https://{host}:{port}")
    return CstConfig(
        id=str(values.get("id", "default")),
        enabled=bool(values.get("enabled", 1)),
        service_provider_id=str(values.get("service_provider_id") or DEFAULT_SERVICE_PROVIDER_ID),
        auto_execute=bool(values.get("auto_execute", 1)),
        scheduled_sync_enabled=bool(values.get("scheduled_sync_enabled", 1)),
        send_enabled=bool(values.get("send_enabled", 1)),
        update_enabled=bool(values.get("update_enabled", 1)),
        delete_enabled=bool(values.get("delete_enabled", 1)),
        get_enabled=bool(values.get("get_enabled", 1)),
        integration_mode="Real API",
        host=host,
        port=port,
        base_url=base_url,
        token_path=str(values.get("token_path") or "/api/rest/v1.0/OAuthToken"),
        send_path=str(values.get("send_path") or CST_SEND_LIR_PATH),
        update_path=str(values.get("update_path") or CST_UPDATE_LIR_PATH),
        delete_path=str(values.get("delete_path") or CST_DELETE_LIR_PATH),
        get_path=str(values.get("get_path") or CST_GET_LIR_PATH),
        auth_username=str(values.get("auth_username") or ""),
        accept_language=str(values.get("accept_language") or CST_DEFAULT_ACCEPT_LANGUAGE),
        auth_password_configured=bool(values.get("encrypted_auth_password")),
        api_access_key_configured=bool(values.get("encrypted_api_access_key")),
        user_key_configured=bool(values.get("encrypted_user_key")),
        verify_ssl=False,
        connection_timeout=int(values.get("connection_timeout") or 10),
        read_timeout=int(values.get("read_timeout") or 30),
        token_refresh_buffer_seconds=int(values.get("token_refresh_buffer_seconds") or 300),
        token_expires_at=str(values.get("token_expires_at") or ""),
        token_cached=bool(values.get("encrypted_access_token")),
        schedule_time=str(values.get("schedule_time") or "00:30"),
        schedule_timezone=str(values.get("schedule_timezone") or "Asia/Riyadh"),
        last_scheduled_run_date=str(values.get("last_scheduled_run_date") or ""),
        last_scheduled_run_at=str(values.get("last_scheduled_run_at") or ""),
        batch_size_limit=int(values.get("batch_size_limit") or 500),
        send_payload_batch_size=int(values.get("send_payload_batch_size") or 1),
        hourly_request_limit=int(values.get("hourly_request_limit") or 1000),
        updated_at=str(values.get("updated_at") or ""),
    )


def cst_batch_from_row(row: sqlite3.Row) -> CstSyncBatch:
    return CstSyncBatch(**dict(row))


def cst_job_from_row(row: sqlite3.Row) -> CstSyncJob:
    return CstSyncJob(**dict(row))


def cst_ledger_from_row(row: sqlite3.Row) -> CstTransactionLedger:
    return CstTransactionLedger(**dict(row))


def backfill_missing_cst_transaction_ledger(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO cst_transaction_ledger (
          transaction_id, cidr, resource_uuid, service_provider_id, first_used_at,
          last_status, retired_at, retired_reason, batch_id, correlation_id
        )
        SELECT j.transaction_id, j.cidr, j.resource_uuid, j.service_provider_id,
               COALESCE(NULLIF(j.created_at, ''), ?), j.status, '', '', j.batch_id, ''
        FROM cst_sync_jobs j
        WHERE COALESCE(j.transaction_id, '') != ''
          AND NOT EXISTS (
            SELECT 1
            FROM cst_transaction_ledger l
            WHERE l.transaction_id = j.transaction_id
          )
        """,
        (now_iso(),),
    )

def cst_scheduler_run_from_row(row: sqlite3.Row) -> CstSchedulerRun:
    return CstSchedulerRun(**dict(row))


def ensure_cst_config(connection: sqlite3.Connection) -> CstConfig:
    row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    if row is None:
        connection.execute(
            """
            INSERT INTO cst_config (
              id, enabled, service_provider_id, auto_execute, scheduled_sync_enabled,
              integration_mode, host, port, base_url, token_path, send_path, update_path, delete_path, get_path,
              auth_username, encrypted_auth_password, encrypted_api_access_key, encrypted_user_key, encrypted_access_token, token_expires_at,
              verify_ssl, connection_timeout, read_timeout, token_refresh_buffer_seconds,
              schedule_time, schedule_timezone, last_scheduled_run_date, last_scheduled_run_at,
              batch_size_limit, send_payload_batch_size, hourly_request_limit, updated_at
            )
            VALUES ('default', 1, ?, 1, 1, 'Real API', 'cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local', 443,
              'https://cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local:443', '/api/rest/v1.0/OAuthToken',
              ?, ?, ?, ?,
              '', '', '', '', '', '', 0, 10, 30, 300, '00:30', 'Asia/Riyadh', '', '', 500, 1, 1000, ?)
            """,
            (DEFAULT_SERVICE_PROVIDER_ID, CST_SEND_LIR_PATH, CST_UPDATE_LIR_PATH, CST_DELETE_LIR_PATH, CST_GET_LIR_PATH, now_iso()),
        )
        row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    return cst_config_from_row(row)


def resource_requires_cst(resource: ResourceRecord) -> bool:
    return resource.ip_type == "PUBLIC" and resource.status != "RETIRED"


def cst_integrity_conflict_blocks_push(status: object) -> bool:
    normalized = str(status or "").strip().upper()
    return bool(normalized and normalized != "ACCEPTED")


def cst_resource_integrity_issues(connection: sqlite3.Connection, resource: ResourceRecord | None) -> list[str]:
    if resource is None or resource.source_entity_type != "assignment" or not resource.source_entity_id:
        return []
    row = connection.execute(
        "SELECT migration_conflict_status, migration_conflict_reason FROM assignments WHERE id = ?",
        (resource.source_entity_id,),
    ).fetchone()
    if row is not None:
        conflict_status = row["migration_conflict_status"]
        conflict_reason = str(row["migration_conflict_reason"] or "").strip()
    else:
        conflict_status = resource.migration_conflict_status
        conflict_reason = str(resource.migration_conflict_reason or "").strip()
    if not cst_integrity_conflict_blocks_push(conflict_status):
        return []
    reason = conflict_reason or "Resolve the subnet in Integrity & Conflicts before CST sync"
    return [f"Integrity conflict is pending resolution for {resource.cidr}: {reason}"]


def normalize_cst_resource_scope(value: str) -> str:
    scope = str(value or "all").strip().lower().replace("-", "_")
    aliases = {
        "all": "all",
        "assigned": "assigned",
        "assignment": "assigned",
        "assignments": "assigned",
        "unassigned": "unassigned",
        "un_assigned": "unassigned",
        "free": "unassigned",
    }
    normalized = aliases.get(scope)
    if normalized is None:
        raise HTTPException(status_code=400, detail="resource_scope must be all, assigned, or unassigned")
    return normalized


def cst_resource_matches_scope(resource: ResourceRecord, resource_scope: str) -> bool:
    scope = normalize_cst_resource_scope(resource_scope)
    if scope == "all":
        return True
    status_id = cst_int_value(resource.assignment_status_id, 1)
    if scope == "unassigned":
        return status_id == 1
    return status_id in {2, 3, 4}
def cst_operation_enabled(config: CstConfig, operation: str) -> bool:
    return {
        "SEND": config.send_enabled,
        "UPDATE": config.update_enabled,
        "DELETE": config.delete_enabled,
        "GET": config.get_enabled,
    }.get(operation.upper(), True)


def cst_operation_disabled_message(operation: str) -> str:
    return f"CST {operation.upper()} operation is disabled in Administration"


def cst_resource_reported_to_cst(connection: sqlite3.Connection, resource: ResourceRecord | None) -> bool:
    if resource is None or resource.ip_type != "PUBLIC":
        return False
    if str(resource.cst_sync_status or "").upper() in {"SUCCESS", "SYNCHRONIZED"}:
        return True
    successful_job = connection.execute(
        """
        SELECT 1
        FROM cst_sync_jobs
        WHERE resource_uuid = ?
          AND operation IN ('SEND', 'UPDATE')
          AND status = 'SUCCESS'
        LIMIT 1
        """,
        (resource.resource_uuid,),
    ).fetchone()
    if successful_job is not None:
        return True
    active_ledger = connection.execute(
        """
        SELECT 1
        FROM cst_transaction_ledger
        WHERE resource_uuid = ?
          AND retired_at = ''
          AND last_status = 'SUCCESS'
        LIMIT 1
        """,
        (resource.resource_uuid,),
    ).fetchone()
    return active_ledger is not None


def cst_resource_deleted_from_cst(connection: sqlite3.Connection, resource: ResourceRecord | None) -> bool:
    if resource is None:
        return False
    successful_delete = connection.execute(
        """
        SELECT 1
        FROM cst_sync_jobs
        WHERE resource_uuid = ?
          AND operation = 'DELETE'
          AND status = 'SUCCESS'
        LIMIT 1
        """,
        (resource.resource_uuid,),
    ).fetchone()
    if successful_delete is not None:
        return True
    retired_ledger = connection.execute(
        """
        SELECT 1
        FROM cst_transaction_ledger
        WHERE resource_uuid = ?
          AND retired_at != ''
        LIMIT 1
        """,
        (resource.resource_uuid,),
    ).fetchone()
    return retired_ledger is not None


def cst_delete_succeeded(jobs: list[CstSyncJob]) -> bool:
    return bool(jobs) and all(job.operation == "DELETE" and job.status == "SUCCESS" for job in jobs)


def cst_jobs_succeeded(jobs: list[CstSyncJob], operation: str) -> bool:
    return bool(jobs) and all(job.operation == operation and job.status == "SUCCESS" for job in jobs)


def assert_cst_business_flow_succeeded(jobs: list[CstSyncJob], action: str) -> None:
    if not jobs:
        return
    failed = next((job for job in jobs if job.status != "SUCCESS"), None)
    if failed:
        reason = failed.last_error or f"CST job remained {failed.status}"
        raise HTTPException(status_code=502, detail=f"{action} failed because CST sync did not complete for {failed.cidr}: {reason}")


def cst_unassigned_update_resource(resource: ResourceRecord) -> ResourceRecord:
    return resource.model_copy(update={
        "assignment_status_id": 1,
        "ownership_type": "POOL",
        "status": "AVAILABLE",
        "customer_name": "",
        "organization_name": "",
        "organization_id": "",
        "customer_type_id": "",
        "full_name": "",
        "mobile_number": "",
        "id_number": "",
        "email": "",
        "assignment_date": "",
        "service_description": "",
        "description": resource.description or f"{resource.cidr} unassigned locally",
        "action_flag": "U",
    })


def cst_get_lir_page_resource(config: CstConfig, page_number: int = 1) -> ResourceRecord:
    timestamp = now_iso()
    service_provider_id = str(config.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID)
    return ResourceRecord(
        resource_uuid=stable_uuid("cst-get-lir-page", service_provider_id, str(page_number)),
        version_uuid=stable_uuid("cst-get-lir-page-version", service_provider_id, str(page_number)),
        cidr=f"CST GetLIR page {page_number}",
        prefix=0,
        start_ip="",
        end_ip="",
        size=0,
        ownership_type="PROVIDER_RECONCILIATION",
        status="AVAILABLE",
        cidr_role="CST_RECONCILIATION_PAGE",
        service_provider_id=service_provider_id,
        service_provider_name=DEFAULT_SERVICE_PROVIDER_NAME,
        asn=DEFAULT_ASN,
        assignment_status_id=1,
        ip_type="PUBLIC",
        source_entity_type="cst_reconciliation",
        source_entity_id=f"page-{page_number}",
        created_at=timestamp,
        updated_at=timestamp,
    )



def cst_transaction_id_for_resource(connection: sqlite3.Connection, resource: ResourceRecord, operation: str, batch_id: str, correlation_id: str) -> str:
    existing = connection.execute(
        """
        SELECT transaction_id, retired_at
        FROM cst_transaction_ledger
        WHERE resource_uuid = ? OR cidr = ?
        ORDER BY CASE WHEN resource_uuid = ? THEN 0 ELSE 1 END, first_used_at DESC
        LIMIT 1
        """,
        (resource.resource_uuid, resource.cidr, resource.resource_uuid),
    ).fetchone()
    if existing and not str(existing["retired_at"] or ""):
        return str(existing["transaction_id"])
    preferred_transaction_id = str(resource.transaction_id or "").strip()
    if operation != "SEND" and preferred_transaction_id:
        existing_transaction = connection.execute(
            "SELECT 1 FROM cst_transaction_ledger WHERE transaction_id = ?",
            (preferred_transaction_id,),
        ).fetchone()
        if existing_transaction is None:
            created_at = now_iso()
            connection.execute(
                """
                INSERT INTO cst_transaction_ledger (
                  transaction_id, cidr, resource_uuid, service_provider_id, first_used_at,
                  last_status, retired_at, retired_reason, batch_id, correlation_id
                )
                VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)
                """,
                (
                    preferred_transaction_id,
                    resource.cidr,
                    resource.resource_uuid,
                    resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
                    created_at,
                    "PENDING",
                    batch_id,
                    correlation_id,
                ),
            )
        return preferred_transaction_id

    service_provider_id = resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID
    if operation == "SEND" and preferred_transaction_id:
        duplicate = connection.execute(
            "SELECT 1 FROM cst_transaction_ledger WHERE transaction_id = ?",
            (preferred_transaction_id,),
        ).fetchone()
        if duplicate is None:
            candidate = preferred_transaction_id
        else:
            candidate = ""
    else:
        candidate = ""
    while not candidate:
        generated = str(uuid4())
        duplicate = connection.execute(
            "SELECT 1 FROM cst_transaction_ledger WHERE transaction_id = ?",
            (generated,),
        ).fetchone()
        if duplicate is None:
            candidate = generated
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


def cst_int_value(value: object, default: int | None = None) -> int | None:
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return int(text)
    except ValueError:
        return default


def cst_assignment_requires_location_defaults(resource: ResourceRecord) -> bool:
    status_id = cst_int_value(resource.assignment_status_id, 1)
    return status_id in {2, 3, 4} or str(resource.ownership_type or "").upper() in {"BUSINESS", "INTERNAL", "INDIVIDUAL"}


def cst_payload_region_id(resource: ResourceRecord) -> int | None:
    region_id = cst_region_id(resource.region_id) or cst_region_id(resource.region)
    if region_id is not None:
        return region_id
    if cst_assignment_requires_location_defaults(resource):
        return CST_FALLBACK_REGION_ID
    return None


def cst_payload_city_id(resource: ResourceRecord) -> int | None:
    city_id = cst_city_id(resource.city_id) or cst_city_id(resource.city)
    if city_id is not None:
        return city_id
    if cst_assignment_requires_location_defaults(resource):
        return CST_FALLBACK_CITY_ID
    return None


def cst_payload_mobile_number(resource: ResourceRecord) -> str:
    raw_mobile_number = str(resource.mobile_number or "").strip()
    raw_contact_number = str(resource.contact_number or "").strip() if hasattr(resource, "contact_number") else ""
    normalized = normalize_cst_mobile_number(raw_mobile_number) or normalize_cst_mobile_number(raw_contact_number)
    if normalized:
        return normalized
    if raw_mobile_number or raw_contact_number or cst_assignment_requires_location_defaults(resource):
        return CST_FALLBACK_PHONE_NUMBER
    return ""


def cst_date_value(value: str, default: str = "") -> str:
    text = str(value or "").strip() or str(default or "").strip()
    if not text:
        return ""
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
        if not match:
            return text
        parsed = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=CST_API_TIMEZONE)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=CST_API_TIMEZONE)
    else:
        parsed = parsed.astimezone(CST_API_TIMEZONE)
    return parsed.isoformat(timespec="seconds")



def cst_payload_service_description(resource: ResourceRecord, assignment_status_id: int) -> str:
    value = str(resource.service_description or resource.description or "").strip()
    if value:
        return value
    if assignment_status_id == 2:
        return "Internal IP assignment"
    if assignment_status_id == 3:
        return "Business IP assignment"
    if assignment_status_id == 4:
        return "Individual IP assignment"
    return "IP subnet migration"


def cst_payload_email(value: object, require_default: bool = False) -> str:
    normalized = normalize_cst_email(str(value or ""))
    if normalized:
        return normalized
    return CST_FALLBACK_EMAIL if require_default else ""


def cst_payload_full_name(resource: ResourceRecord, require_default: bool = False) -> str:
    value = str(resource.full_name or getattr(resource, "contact_name", "") or "").strip()
    if value:
        return value
    return CST_FALLBACK_FULL_NAME if require_default else ""

def cst_payload_for_resource(resource: ResourceRecord, operation: str, transaction_id: str, correlation_id: str) -> dict:
    service_provider_id = str(resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID)
    if operation == "SEND":
        today_text = datetime.now(timezone.utc).date().isoformat()
        assignment_status_id = cst_int_value(resource.assignment_status_id, 1) or 1
        business_like = assignment_status_id == 3 or str(resource.ownership_type or "").upper() == "BUSINESS"
        individual_like = assignment_status_id == 4 or str(resource.ownership_type or "").upper() == "INDIVIDUAL"
        record = {
            "transactionId": transaction_id,
            "ipSubnet": resource.cidr,
            "asn": resource.asn or DEFAULT_ASN,
            "ipVersionId": cst_int_value(resource.ip_version, 1),
            "assignmentStatusId": assignment_status_id,
            "serviceDescription": cst_payload_service_description(resource, assignment_status_id),
        }
        organization_name = (resource.organization_name or resource.customer_name or "").strip() or (CST_FALLBACK_ORGANIZATION_NAME if business_like else "")
        optional_text_fields = {
            "organizationName": organization_name,
            "organizationId": resource.organization_id,
            "description": resource.description,
        }
        for key, value in optional_text_fields.items():
            if str(value or "").strip():
                record[key] = str(value).strip()
        customer_type_id = cst_int_value(resource.customer_type_id)
        if business_like:
            record["customerTypeId"] = customer_type_id if customer_type_id in {1, 2} else CST_FALLBACK_CUSTOMER_TYPE_ID
        elif customer_type_id is not None:
            record["customerTypeId"] = customer_type_id
        access_technology_id = cst_int_value(resource.access_technology_id)
        if individual_like:
            record["accessTechnologyId"] = access_technology_id if access_technology_id in CST_ACCESS_TECHNOLOGY_BY_ID else CST_FALLBACK_ACCESS_TECHNOLOGY_ID
        elif access_technology_id is not None:
            record["accessTechnologyId"] = access_technology_id
        region_id = cst_payload_region_id(resource)
        if region_id is not None:
            record["regionId"] = region_id
        city_id = cst_payload_city_id(resource)
        if city_id is not None:
            record["cityId"] = city_id
        mobile_number = cst_payload_mobile_number(resource)
        id_number = normalize_cst_id_number(resource.id_number) or (CST_FALLBACK_ID_NUMBER if business_like or individual_like else str(resource.id_number or "").strip())
        email = cst_payload_email(resource.email, require_default=business_like)
        contact = {
            "fullName": cst_payload_full_name(resource, require_default=business_like),
            "mobileNumber": mobile_number,
            "idNumber": id_number,
            "email": email,
        }
        contact = {key: value for key, value in contact.items() if value}
        if contact:
            record["contact"] = contact
        include_customer_dates = business_like or individual_like or bool(organization_name or contact)
        if resource.assignment_date or include_customer_dates:
            record["assignmentDate"] = cst_date_value(resource.assignment_date, today_text)
        if resource.update_date or include_customer_dates:
            record["updateDate"] = cst_date_value(resource.update_date, today_text)
        return {
            "serviceProviderId": cst_int_value(service_provider_id, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1)),
            "data": [record],
        }
    if operation == "UPDATE":
        today_text = datetime.now(timezone.utc).date().isoformat()
        status_id = cst_int_value(resource.assignment_status_id, 1) or 1
        record = {
            "transactionId": transaction_id,
            "assignmentStatusId": status_id,
        }
        if status_id == 3:
            organization_name = (resource.organization_name or resource.customer_name or "").strip() or CST_FALLBACK_ORGANIZATION_NAME
            record["organizationName"] = organization_name
            if str(resource.organization_id or "").strip():
                record["organizationId"] = str(resource.organization_id).strip()
            customer_type_id = cst_int_value(resource.customer_type_id)
            record["customerTypeId"] = customer_type_id if customer_type_id in {1, 2} else CST_FALLBACK_CUSTOMER_TYPE_ID
            region_id = cst_payload_region_id(resource)
            if region_id is not None:
                record["regionId"] = region_id
            city_id = cst_payload_city_id(resource)
            if city_id is not None:
                record["cityId"] = city_id
            contact = {
                "fullName": cst_payload_full_name(resource, require_default=True),
                "mobileNumber": cst_payload_mobile_number(resource),
                "idNumber": normalize_cst_id_number(resource.id_number) or CST_FALLBACK_ID_NUMBER,
                "email": cst_payload_email(resource.email, require_default=True),
            }
            record["contact"] = {key: value for key, value in contact.items() if value}
            record["assignmentDate"] = cst_date_value(resource.assignment_date, today_text)
            record["updateDate"] = cst_date_value(resource.update_date, today_text)
        elif status_id == 2:
            record["serviceDescription"] = cst_payload_service_description(resource, status_id)
            if str(resource.description or "").strip():
                record["description"] = str(resource.description).strip()
        elif status_id == 4:
            region_id = cst_payload_region_id(resource)
            if region_id is not None:
                record["regionId"] = region_id
            city_id = cst_payload_city_id(resource)
            if city_id is not None:
                record["cityId"] = city_id
            access_technology_id = cst_int_value(resource.access_technology_id)
            record["accessTechnologyId"] = access_technology_id if access_technology_id in CST_ACCESS_TECHNOLOGY_BY_ID else CST_FALLBACK_ACCESS_TECHNOLOGY_ID
            contact = {
                "fullName": cst_payload_full_name(resource, require_default=False),
                "mobileNumber": cst_payload_mobile_number(resource),
                "idNumber": normalize_cst_id_number(resource.id_number) or CST_FALLBACK_ID_NUMBER,
                "email": cst_payload_email(resource.email),
            }
            contact = {key: value for key, value in contact.items() if value}
            if contact:
                record["contact"] = contact
        if status_id != 2:
            record["serviceDescription"] = cst_payload_service_description(resource, status_id)
        if str(resource.description or "").strip():
            record["description"] = str(resource.description).strip()
        return {
            "serviceProviderId": cst_int_value(service_provider_id, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1)),
            "data": [record],
        }
    if operation == "DELETE":
        return {
            "serviceProviderId": cst_int_value(service_provider_id, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1)),
            "data": [{"transactionId": transaction_id}],
        }
    if operation == "GET":
        return {
            "serviceProviderId": cst_int_value(service_provider_id, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1)),
            "pageNumber": 1,
            "pageSize": 1000,
        }
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
        "serviceProviderId": service_provider_id,
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



def cst_delete_payload(transaction_id: str, service_provider_id: object = "") -> dict:
    return {
        "serviceProviderId": cst_int_value(service_provider_id or DEFAULT_SERVICE_PROVIDER_ID, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1)),
        "data": [{"transactionId": transaction_id}],
    }


def cst_payload_has_data_array(payload: dict) -> bool:
    data = payload.get("data") if isinstance(payload, dict) else None
    return isinstance(data, list) and bool(data)


def cst_payload_record(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {}


def cst_quality_message(issues: list[str]) -> str:
    return "BSS data quality validation failed: " + "; ".join(issues[:12])


def cst_business_data_quality_issues(resource: ResourceRecord, record: dict) -> list[str]:
    issues: list[str] = []
    contact = record.get("contact") if isinstance(record.get("contact"), dict) else {}

    def require_text(path: str, value: object) -> None:
        if not str(value or "").strip():
            issues.append(f"{path} is required for Business assignment")

    require_text("organizationName", record.get("organizationName"))
    require_text("contact.fullName", contact.get("fullName"))
    require_text("contact.mobileNumber", contact.get("mobileNumber"))
    require_text("contact.idNumber", contact.get("idNumber"))
    require_text("contact.email", contact.get("email"))
    require_text("assignmentDate", record.get("assignmentDate"))
    require_text("updateDate", record.get("updateDate"))

    customer_type_id = record.get("customerTypeId")
    if customer_type_id not in {1, 2}:
        issues.append("customerTypeId must map to CST 1 Government or 2 Non-Government")
    region_id = record.get("regionId")
    valid_region_ids = {item_id for item_id, _name in CST_REGION_ROWS}
    if region_id not in valid_region_ids:
        issues.append("regionId is required and must map to a CST region")
    city_id = record.get("cityId")
    if city_id is not None and city_id not in CST_CITY_REGION_BY_ID:
        issues.append("cityId is present but does not map to a CST city")
    access_technology_id = record.get("accessTechnologyId")
    if access_technology_id is not None and access_technology_id not in CST_ACCESS_TECHNOLOGY_BY_ID:
        issues.append("accessTechnologyId is present but does not map to CST FTTH/ADSL/Mobile/FWA")

    mobile_number = str(contact.get("mobileNumber") or "")
    if mobile_number and not normalize_cst_mobile_number(mobile_number):
        issues.append("contact.mobileNumber must be Saudi phone format 9665XXXXXXXX, 9661XXXXXXXX, or fallback 0000000000")
    id_number = str(contact.get("idNumber") or "")
    if id_number and not normalize_cst_id_number(id_number):
        issues.append("contact.idNumber must be 10 digits")
    email = str(contact.get("email") or "")
    if email and not normalize_cst_email(email):
        issues.append("contact.email must be a valid email address")

    resource_city = str(getattr(resource, "city", "") or "").strip()
    resource_region = str(getattr(resource, "region", "") or "").strip()
    if resource_city and record.get("cityId") is None:
        issues.append(f"cityId could not be mapped from BSS city '{resource_city}'")
    if resource_region and record.get("regionId") is None:
        issues.append(f"regionId could not be mapped from BSS region '{resource_region}'")
    return issues


def cst_data_quality_issues(resource: ResourceRecord, operation: str, payload: dict) -> list[str]:
    if operation not in {"SEND", "UPDATE"}:
        return []
    record = cst_payload_record(payload)
    assignment_status_id = cst_int_value(record.get("assignmentStatusId"), resource.assignment_status_id)
    ownership_type = (resource.ownership_type or "").upper()
    issues: list[str] = []
    if assignment_status_id == 1:
        return issues
    if assignment_status_id == 3:
        issues.extend(cst_business_data_quality_issues(resource, record))
    elif assignment_status_id == 2:
        if not str(record.get("serviceDescription") or resource.service_description or "").strip():
            issues.append("serviceDescription is required for Internal assignment")
    elif assignment_status_id == 4:
        region_id = record.get("regionId")
        access_technology_id = record.get("accessTechnologyId")
        if region_id not in {item_id for item_id, _name in CST_REGION_ROWS}:
            issues.append("regionId is required and must map to a CST region for Individual assignment")
        if access_technology_id not in CST_ACCESS_TECHNOLOGY_BY_ID:
            issues.append("accessTechnologyId is required for Individual assignment")
    elif ownership_type == "BUSINESS":
        issues.extend(cst_business_data_quality_issues(resource, record))
    elif ownership_type == "INTERNAL":
        if not str(record.get("serviceDescription") or resource.service_description or "").strip():
            issues.append("serviceDescription is required for Internal assignment")
    elif ownership_type == "INDIVIDUAL":
        region_id = record.get("regionId")
        access_technology_id = record.get("accessTechnologyId")
        if region_id not in {item_id for item_id, _name in CST_REGION_ROWS}:
            issues.append("regionId is required and must map to a CST region for Individual assignment")
        if access_technology_id not in CST_ACCESS_TECHNOLOGY_BY_ID:
            issues.append("accessTechnologyId is required for Individual assignment")
    return issues


def cst_resource_from_network(
    network: IPv4Network,
    resource_uuid: str,
    source_entity_type: str,
    source_entity_id: str,
    description: str,
    transaction_id: str = "",
) -> ResourceRecord:
    timestamp = now_iso()
    ip_type = "PRIVATE" if network.is_private else "PUBLIC"
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
        cst_sync_status="PENDING" if ip_type == "PUBLIC" else "NOT_REQUIRED",
        ripe_sync_status="NOT_REQUIRED",
        ip_type=ip_type,
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
    if not container.overlaps(allocated):
        return [container]
    remaining: list[IPv4Network] = []
    overlap_start = max(int(container.network_address), int(allocated.network_address))
    overlap_end = min(int(container.broadcast_address), int(allocated.broadcast_address))
    if int(container.network_address) < overlap_start:
        remaining.extend(summarize_address_range(container.network_address, IPv4Address(overlap_start - 1)))
    if overlap_end < int(container.broadcast_address):
        remaining.extend(summarize_address_range(IPv4Address(overlap_end + 1), container.broadcast_address))
    return sorted(remaining, key=lambda item: (int(item.network_address), item.prefixlen))


def normalize_network_list(networks: list[IPv4Network]) -> list[IPv4Network]:
    return sorted(collapse_addresses(networks), key=lambda item: (int(item.network_address), item.prefixlen))


def network_difference(container: IPv4Network, removed: IPv4Network) -> list[IPv4Network]:
    return normalize_network_list(remaining_networks_after_subtract(container, removed))


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


def subtract_allocated_networks(container: IPv4Network, allocated_networks: list[IPv4Network]) -> list[IPv4Network]:
    free_blocks = [container]
    ordered = sorted(allocated_networks, key=lambda item: (int(item.network_address), item.prefixlen))
    for allocated in ordered:
        next_blocks: list[IPv4Network] = []
        for block in free_blocks:
            if not block.overlaps(allocated):
                next_blocks.append(block)
                continue
            overlap_start = max(int(block.network_address), int(allocated.network_address))
            overlap_end = min(int(block.broadcast_address), int(allocated.broadcast_address))
            if int(block.network_address) < overlap_start:
                next_blocks.extend(summarize_address_range(block.network_address, IPv4Address(overlap_start - 1)))
            if overlap_end < int(block.broadcast_address):
                next_blocks.extend(summarize_address_range(IPv4Address(overlap_end + 1), block.broadcast_address))
        free_blocks = next_blocks
    return sorted(free_blocks, key=lambda item: (int(item.network_address), item.prefixlen))


def top_level_public_pool_resources(connection: sqlite3.Connection) -> list[ResourceRecord]:
    rows = connection.execute(
        """
        SELECT * FROM ip_resources
        WHERE source_entity_type = 'pool'
          AND ip_type = 'PUBLIC'
          AND status != 'RETIRED'
        ORDER BY prefix ASC, start_ip ASC
        """
    ).fetchall()
    roots: list[ResourceRecord] = []
    root_networks: list[IPv4Network] = []
    for row in rows:
        resource = resource_from_row(row)
        network = normalize_network(resource.cidr)
        if any(network.subnet_of(root_network) for root_network in root_networks):
            continue
        roots.append(resource)
        root_networks.append(network)
    return roots


def active_public_assignment_networks(connection: sqlite3.Connection, root_network: IPv4Network) -> list[IPv4Network]:
    rows = connection.execute(
        """
        SELECT a.*
        FROM assignments a
        INNER JOIN ip_resources r ON r.source_entity_type = 'assignment' AND r.source_entity_id = a.id
        WHERE r.ip_type = 'PUBLIC'
          AND r.status != 'RETIRED'
        """
    ).fetchall()
    networks: list[IPv4Network] = []
    for row in rows:
        assignment = assignment_from_row(row)
        if not assignment_active_for_conflict(assignment):
            continue
        network = network_of(assignment)
        if network.subnet_of(root_network):
            networks.append(network)
    return networks


def materialize_bulk_unassigned_fragments(connection: sqlite3.Connection) -> tuple[int, int]:
    roots = top_level_public_pool_resources(connection)
    desired: dict[str, ResourceRecord] = {}
    for root in roots:
        root_network = normalize_network(root.cidr)
        assigned_networks = active_public_assignment_networks(connection, root_network)
        if not assigned_networks:
            continue
        for fragment in subtract_allocated_networks(root_network, assigned_networks):
            if fragment == root_network:
                continue
            resource_uuid = stable_uuid(BULK_UNASSIGNED_FRAGMENT_SOURCE, root.resource_uuid, str(fragment))
            existing = find_resource_by_cidr(connection, str(fragment))
            if existing and existing.source_entity_type != BULK_UNASSIGNED_FRAGMENT_SOURCE:
                continue
            fragment_resource = cst_resource_from_network(
                fragment,
                resource_uuid,
                BULK_UNASSIGNED_FRAGMENT_SOURCE,
                f"{root.resource_uuid}:{fragment}",
                f"Bulk migration remaining unassigned fragment from {root.cidr}",
            ).model_copy(update={
                "parent_resource_uuid": root.resource_uuid,
                "parent_version_uuid": root.version_uuid,
                "service_provider_id": root.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
                "service_provider_name": root.service_provider_name or DEFAULT_SERVICE_PROVIDER_NAME,
                "asn": root.asn or DEFAULT_ASN,
                "ip_type": root.ip_type,
                "root_pool_uuid": root.resource_uuid,
                "region": root.region,
                "city": root.city,
                "cst_sync_ready": True,
                "cst_validation_status": "READY",
            })
            desired[resource_uuid] = fragment_resource

    stale_rows = connection.execute(
        "SELECT * FROM ip_resources WHERE source_entity_type = ?",
        (BULK_UNASSIGNED_FRAGMENT_SOURCE,),
    ).fetchall()
    deleted = 0
    for row in stale_rows:
        status = str(row["cst_sync_status"] or "").upper()
        if str(row["resource_uuid"]) in desired or status in {"SUCCESS", "SYNCHRONIZED"}:
            continue
        connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (row["resource_uuid"],))
        connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (row["resource_uuid"],))
        deleted += 1

    materialized = 0
    for resource in desired.values():
        upsert_resource_record(connection, resource)
        materialized += 1

    if materialized or deleted:
        record_audit(
            connection,
            "Bulk Unassigned Fragment Materialized",
            "bulk_migration_inventory",
            "bulk-unassigned-fragments",
            "",
            json.dumps({"materialized": materialized, "deletedStale": deleted}),
        )
    return materialized, deleted

def parse_iso_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def cst_real_api_enabled(config: CstConfig) -> bool:
    return True


def cst_base_url_from_host_port(host: object, port: object) -> str:
    host_text = str(host or "").strip()
    if "://" in host_text:
        parsed = urllib_parse.urlsplit(host_text)
        host_text = parsed.hostname or parsed.netloc
    else:
        host_text = host_text.split("/")[0].split(":")[0]
    host_text = host_text.strip()
    return f"https://{host_text}:{int(port or 443)}" if host_text else ""


def cst_base_url_uses_placeholder_host(base_url: object) -> bool:
    value = str(base_url or "").strip()
    if not value:
        return True
    try:
        return (urllib_parse.urlsplit(value).hostname or "").lower() == "host"
    except Exception:
        lowered = value.lower()
        return lowered == "host" or lowered.startswith("https://host") or lowered.startswith("http://host")


def cst_redact_url(url: str) -> str:
    parts = urllib_parse.urlsplit(url)
    query_items = [(key, "***" if key == "user_key" else value) for key, value in urllib_parse.parse_qsl(parts.query, keep_blank_values=True)]
    return urllib_parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib_parse.urlencode(query_items), parts.fragment))


def cst_token_url(config: CstConfig) -> str:
    return urllib_parse.urljoin(config.base_url.rstrip("/") + "/", config.token_path.lstrip("/"))


def cst_operation_path(config: CstConfig, operation: str) -> str:
    return {
        "SEND": config.send_path,
        "UPDATE": config.update_path,
        "DELETE": config.delete_path,
        "GET": config.get_path,
    }.get(operation, config.send_path)


def cst_operation_url(config: CstConfig, resource: ResourceRecord, operation: str, transaction_id: str) -> str:
    path = cst_operation_path(config, operation)
    replacements = {
        "resourceUuid": resource.resource_uuid,
        "transactionId": transaction_id,
        "cidr": resource.cidr,
        "serviceId": resource.service_id,
    }
    for key, value in replacements.items():
        path = path.replace("{" + key + "}", urllib_parse.quote(str(value or ""), safe=""))
    return urllib_parse.urljoin(config.base_url.rstrip("/") + "/", path.lstrip("/"))



def cst_operation_url_from_payload(config: CstConfig, operation: str, payload: dict, transaction_id: str) -> str:
    path = cst_operation_path(config, operation)
    replacements = {
        "resourceUuid": payload.get("resourceUuid") or "",
        "transactionId": transaction_id,
        "cidr": payload.get("cidr") or "",
        "serviceId": payload.get("serviceId") or "",
    }
    for key, value in replacements.items():
        path = path.replace("{" + key + "}", urllib_parse.quote(str(value or ""), safe=""))
    return urllib_parse.urljoin(config.base_url.rstrip("/") + "/", path.lstrip("/"))

def cst_ssl_context(config: CstConfig) -> ssl.SSLContext | None:
    return ssl._create_unverified_context()


def cst_redact_log_value(value: object) -> object:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            key_text = str(key)
            if key_text.lower() in CST_LOG_SENSITIVE_KEYS:
                redacted[key_text] = "***"
            else:
                redacted[key_text] = cst_redact_log_value(item)
        return redacted
    if isinstance(value, list):
        return [cst_redact_log_value(item) for item in value]
    return value


def cst_request_body_for_log(body: bytes | None) -> object:
    if body is None:
        return None
    text = body.decode("utf-8", errors="replace")
    try:
        return cst_redact_log_value(json.loads(text))
    except json.JSONDecodeError:
        return text


def cst_log_api_exchange(method: str, url: str, headers: dict[str, str], body: bytes | None, status_code: int | None, response_body: object, started_at: float, error: str = "") -> None:
    if not CST_API_LOG_ENABLED:
        return
    try:
        entry = {
            "timestamp": now_iso(),
            "durationMs": int((time.time() - started_at) * 1000),
            "method": method,
            "url": cst_redact_url(url),
            "requestHeaders": cst_redact_log_value(headers),
            "requestBody": cst_request_body_for_log(body),
            "httpStatus": status_code,
            "responseBody": cst_redact_log_value(response_body),
            "error": error,
        }
        with CST_API_LOG_LOCK:
            CST_API_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with CST_API_LOG_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception:
        pass


def cst_http_request(config: CstConfig, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: int) -> tuple[int, dict]:
    started_at = time.time()
    request = urllib_request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib_request.urlopen(request, timeout=timeout, context=cst_ssl_context(config)) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw}
            status_code = int(response.status)
            cst_log_api_exchange(method, url, headers, body, status_code, parsed, started_at)
            return status_code, parsed
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        parsed.setdefault("error", exc.reason)
        status_code = int(exc.code)
        cst_log_api_exchange(method, url, headers, body, status_code, parsed, started_at, str(exc.reason))
        return status_code, parsed
    except (TimeoutError, OSError, urllib_error.URLError) as exc:
        cst_log_api_exchange(method, url, headers, body, None, {}, started_at, str(exc))
        raise HTTPException(status_code=502, detail=f"CST request failed: {exc}") from exc


def ensure_cst_access_token(connection: sqlite3.Connection, config: CstConfig, force_refresh: bool = False) -> str:
    row = connection.execute("SELECT * FROM cst_config WHERE id = 'default'").fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="CST configuration not initialized")
    values = dict(row)
    expires_at = parse_iso_datetime(str(values.get("token_expires_at") or ""))
    encrypted_token = str(values.get("encrypted_access_token") or "")
    refresh_at = datetime.now(timezone.utc) + timedelta(seconds=config.token_refresh_buffer_seconds)
    if not force_refresh and encrypted_token and expires_at and expires_at > refresh_at:
        token = decrypt_secret(encrypted_token)
        if token:
            return token

    password = decrypt_secret(str(values.get("encrypted_auth_password") or ""))
    if not config.auth_username or not password:
        raise HTTPException(status_code=400, detail="CST authorization username/password is not configured")
    lir_api_key = decrypt_secret(str(values.get("encrypted_user_key") or ""))
    token_url = cst_token_url(config)
    basic_value = base64.b64encode(f"{config.auth_username}:{password}".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic_value}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    api_key = decrypt_secret(str(values.get("encrypted_api_access_key") or ""))
    if api_key:
        headers["x-Gateway-APIKey"] = api_key
    if lir_api_key:
        headers["apiKey"] = lir_api_key
    body = urllib_parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    status_code, response = cst_http_request(config, "POST", token_url, headers, body, config.connection_timeout)
    if status_code < 200 or status_code >= 300:
        raise HTTPException(status_code=502, detail=f"CST token request failed with HTTP {status_code}: {json.dumps(response)[:500]}")
    token = str(response.get("access_token") or response.get("token") or "")
    if not token:
        raise HTTPException(status_code=502, detail="CST token response did not include access_token")
    expires_in = int(response.get("expires_in") or response.get("expiresIn") or 3600)
    token_expires_at = (datetime.now(timezone.utc) + timedelta(seconds=max(expires_in, 60))).isoformat()
    connection.execute(
        "UPDATE cst_config SET encrypted_access_token = ?, token_expires_at = ?, updated_at = ? WHERE id = 'default'",
        (encrypt_secret(token), token_expires_at, now_iso()),
    )
    return token


def execute_cst_real_api_job(connection: sqlite3.Connection, config: CstConfig, resource: ResourceRecord, operation: str, payload: dict, transaction_id: str) -> tuple[str, str, dict]:
    token = ensure_cst_access_token(connection, config)
    method = "POST"
    url = cst_operation_url(config, resource, operation, transaction_id)
    request_at = datetime.now(timezone.utc)
    request_id = request_at.strftime("%Y%m%d%H%M%S") + f"{request_at.microsecond // 1000:03d}"
    headers = {
        "requestId": request_id,
        "Accept-Language": config.accept_language or CST_DEFAULT_ACCEPT_LANGUAGE,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    row = connection.execute("SELECT encrypted_api_access_key, encrypted_user_key FROM cst_config WHERE id = 'default'").fetchone()
    api_key = decrypt_secret(str(row["encrypted_api_access_key"] or "")) if row else ""
    if api_key:
        headers["x-Gateway-APIKey"] = api_key
    lir_api_key = decrypt_secret(str(row["encrypted_user_key"] or "")) if row else ""
    if lir_api_key:
        headers["apiKey"] = lir_api_key
    body = None if method == "GET" else json.dumps(payload, sort_keys=True).encode("utf-8")
    status_code, response_body = cst_http_request(config, method, url, headers, body, config.read_timeout)
    accepted = 200 <= status_code < 300
    response = {
        "temporaryStorage": False,
        "externalApiCalled": True,
        "accepted": accepted,
        "httpStatus": status_code,
        "method": method,
        "url": cst_redact_url(url),
        "body": response_body,
        "processedAt": now_iso(),
    }
    return ("SUCCESS" if accepted else "FAILED", "" if accepted else f"CST API HTTP {status_code}", response)


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
        if container_network == assigned_network:
            operations.append((assignment_resource, "UPDATE"))
            return create_cst_sync_jobs(connection, operations, workflow_type)
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

def cst_waiting_for_prior_delete_message() -> str:
    return "Waiting for earlier CST operation in this batch to succeed before continuing dependent LIR changes"


def cst_batch_requires_strict_sequence(connection: sqlite3.Connection, batch_id: str) -> bool:
    row = connection.execute("SELECT workflow_type FROM cst_sync_batches WHERE id = ?", (batch_id,)).fetchone()
    workflow_type = str(row["workflow_type"] or "") if row else ""
    return workflow_type.startswith("PARTIAL_REASSIGNMENT")


def cst_job_waiting_for_prior_delete(connection: sqlite3.Connection, job: CstSyncJob) -> bool:
    strict_sequence = cst_batch_requires_strict_sequence(connection, job.batch_id)
    if not strict_sequence and job.operation == "DELETE":
        return False
    if strict_sequence:
        row = connection.execute(
            """
            SELECT 1
            FROM cst_sync_jobs
            WHERE batch_id = ?
              AND sequence_no < ?
              AND status != 'SUCCESS'
            LIMIT 1
            """,
            (job.batch_id, job.sequence_no),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT 1
            FROM cst_sync_jobs
            WHERE batch_id = ?
              AND sequence_no < ?
              AND operation = 'DELETE'
              AND status != 'SUCCESS'
            LIMIT 1
            """,
            (job.batch_id, job.sequence_no),
        ).fetchone()
    return row is not None

def cst_send_payload_batch_size(config: CstConfig) -> int:
    return max(int(config.send_payload_batch_size or 1), 1)


def cst_workflow_uses_send_payload_batch(workflow_type: str) -> bool:
    normalized = str(workflow_type or "").upper()
    return "MIGRATION" in normalized or "BULK" in normalized


def cst_payload_data_record(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return {}
    return dict(data[0])


def cst_combined_send_payload(entries: list[tuple[ResourceRecord, str, dict]]) -> dict:
    service_provider_id = cst_int_value(entries[0][0].service_provider_id or DEFAULT_SERVICE_PROVIDER_ID, cst_int_value(DEFAULT_SERVICE_PROVIDER_ID, 1))
    return {
        "serviceProviderId": service_provider_id,
        "data": [cst_payload_data_record(payload) for _resource, _transaction_id, payload in entries],
    }


def insert_cst_sync_job_result(
    connection: sqlite3.Connection,
    *,
    batch_id: str,
    correlation_id: str,
    created_at: str,
    sequence_no: int,
    resource: ResourceRecord,
    operation: str,
    transaction_id: str,
    payload: dict,
    status: str,
    last_error: str,
    response: dict,
) -> CstSyncJob:
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
        SET cidr = ?, resource_uuid = ?, service_provider_id = ?, last_status = ?,
            retired_at = COALESCE(NULLIF(?, ''), retired_at),
            retired_reason = COALESCE(NULLIF(?, ''), retired_reason), batch_id = ?, correlation_id = ?
        WHERE transaction_id = ?
        """,
        (resource.cidr, resource.resource_uuid, resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID, status, retired_at, retired_reason, batch_id, correlation_id, transaction_id),
    )
    action_flag = "D" if operation == "DELETE" and status == "SUCCESS" else "U" if operation == "UPDATE" and status == "SUCCESS" else "S" if status == "SUCCESS" else "F" if status in {"FAILED"} else "U"
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
    return job


def finalize_cst_sync_batch(connection: sqlite3.Connection, batch_id: str, jobs: list[CstSyncJob]) -> None:
    completed_jobs = sum(1 for job in jobs if job.status in {"SUCCESS", "NOT_REQUIRED"})
    failed_jobs = sum(1 for job in jobs if job.status == "FAILED")
    blocked_jobs = 0
    batch_status = "SUCCESS" if completed_jobs == len(jobs) else "FAILED" if failed_jobs else "PENDING"
    connection.execute(
        """
        UPDATE cst_sync_batches
        SET status = ?, completed_jobs = ?, failed_jobs = ?, blocked_jobs = ?, completed_at = ?
        WHERE id = ?
        """,
        (batch_status, completed_jobs, failed_jobs, blocked_jobs, now_iso() if batch_status != "PENDING" else "", batch_id),
    )


def create_cst_sync_jobs(
    connection: sqlite3.Connection,
    resource_operations: list[tuple[ResourceRecord, str]],
    workflow_type: str,
    queue_only: bool = False,
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
    prior_delete_unresolved = False
    strict_sequence = workflow_type.startswith("PARTIAL_REASSIGNMENT")
    prior_sequence_unresolved = False
    send_batch_size = cst_send_payload_batch_size(config) if cst_workflow_uses_send_payload_batch(workflow_type) else 1
    can_batch_all_send = send_batch_size > 1 and all(operation == "SEND" for _resource, operation in eligible)
    sequence_no = 1
    index = 0
    while index < len(eligible):
        if can_batch_all_send:
            first_provider_id = str(eligible[index][0].service_provider_id or DEFAULT_SERVICE_PROVIDER_ID)
            chunk_operations = []
            while index < len(eligible) and len(chunk_operations) < send_batch_size:
                candidate_resource, candidate_operation = eligible[index]
                if str(candidate_resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID) != first_provider_id:
                    break
                chunk_operations.append((candidate_resource, candidate_operation))
                index += 1
        else:
            chunk_operations = [eligible[index]]
            index += 1

        chunk_entries: list[tuple[ResourceRecord, str, str, dict, list[str]]] = []
        for resource, operation in chunk_operations:
            transaction_id = cst_transaction_id_for_resource(connection, resource, operation, batch_id, correlation_id)
            payload = cst_payload_for_resource(resource, operation, transaction_id, correlation_id)
            validation_payload = payload if operation in {"SEND", "UPDATE"} else cst_payload_for_resource(resource, "SEND", transaction_id, correlation_id)
            quality_issues = [*cst_resource_integrity_issues(connection, resource), *cst_data_quality_issues(resource, operation, validation_payload)]
            chunk_entries.append((resource, operation, transaction_id, payload, quality_issues))

        should_batch_call = can_batch_all_send and len(chunk_entries) > 1
        batched_status = ""
        batched_last_error = ""
        batched_response: dict = {}
        valid_batch_entries = [entry for entry in chunk_entries if not entry[4]]
        if should_batch_call and valid_batch_entries and config.enabled and cst_operation_enabled(config, "SEND") and config.auto_execute and not queue_only:
            try:
                combined_payload = cst_combined_send_payload([(resource, transaction_id, payload) for resource, _operation, transaction_id, payload, _issues in valid_batch_entries])
                with CST_API_CALL_LOCK:
                    batched_status, batched_last_error, batched_response = execute_cst_real_api_job(connection, config, valid_batch_entries[0][0], "SEND", combined_payload, valid_batch_entries[0][2])
                batched_response = {
                    **batched_response,
                    "sendPayloadBatchSize": len(valid_batch_entries),
                    "sendPayloadTransactionIds": [transaction_id for _resource, _operation, transaction_id, _payload, _issues in valid_batch_entries],
                }
            except HTTPException as exc:
                batched_status = "FAILED"
                batched_last_error = str(exc.detail)
                batched_response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": batched_last_error, "processedAt": now_iso(), "sendPayloadBatchSize": len(valid_batch_entries)}
            except Exception as exc:
                batched_status = "FAILED"
                batched_last_error = str(exc)
                batched_response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": batched_last_error, "processedAt": now_iso(), "sendPayloadBatchSize": len(valid_batch_entries)}

        for resource, operation, transaction_id, payload, quality_issues in chunk_entries:
            if prior_sequence_unresolved:
                status = "PENDING"
                last_error = cst_waiting_for_prior_delete_message()
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
            elif prior_delete_unresolved and operation != "DELETE":
                status = "PENDING"
                last_error = cst_waiting_for_prior_delete_message()
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
            elif not config.enabled:
                status = "PENDING"
                last_error = "CST integration is disabled in Administration"
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
            elif not cst_operation_enabled(config, operation):
                status = "PENDING"
                last_error = cst_operation_disabled_message(operation)
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
            elif quality_issues:
                status = "PENDING"
                last_error = cst_quality_message(quality_issues)
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "dataQualityStatus": "INVALID_FOR_CST", "issues": quality_issues, "message": last_error}
            elif queue_only:
                status = "PENDING"
                last_error = ""
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": "CST migration job created; API call is pending manual push", "processedAt": now_iso()}
            elif not config.auto_execute:
                status = "PENDING"
                last_error = ""
                response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": "CST auto-execute is disabled in Administration; job queued for manual retry", "processedAt": now_iso()}
            elif should_batch_call:
                status = batched_status
                last_error = batched_last_error
                response = batched_response
            else:
                try:
                    with CST_API_CALL_LOCK:
                        status, last_error, response = execute_cst_real_api_job(connection, config, resource, operation, payload, transaction_id)
                except HTTPException as exc:
                    status = "FAILED"
                    last_error = str(exc.detail)
                    response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso()}
                except Exception as exc:
                    status = "FAILED"
                    last_error = str(exc)
                    response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso()}

            job = insert_cst_sync_job_result(
                connection,
                batch_id=batch_id,
                correlation_id=correlation_id,
                created_at=created_at,
                sequence_no=sequence_no,
                resource=resource,
                operation=operation,
                transaction_id=transaction_id,
                payload=payload,
                status=status,
                last_error=last_error,
                response=response,
            )
            if operation == "DELETE" and status != "SUCCESS":
                prior_delete_unresolved = True
            if strict_sequence and status != "SUCCESS":
                prior_sequence_unresolved = True
            jobs.append(job)
            sequence_no += 1

    reconcile_cst_success_resource_statuses(connection)
    finalize_cst_sync_batch(connection, batch_id, jobs)
    return jobs

def update_existing_cst_job_result(
    connection: sqlite3.Connection,
    *,
    job: CstSyncJob,
    resource: ResourceRecord,
    payload: dict,
    status: str,
    last_error: str,
    response: dict,
    updated_at: str,
) -> None:
    connection.execute(
        """
        UPDATE cst_sync_jobs
        SET status = ?, attempt_count = attempt_count + 1, last_error = ?, payload_json = ?, response_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, last_error, json.dumps(payload, sort_keys=True), json.dumps(response, sort_keys=True), updated_at, job.id),
    )
    connection.execute(
        "UPDATE cst_transaction_ledger SET last_status = ?, batch_id = ? WHERE transaction_id = ?",
        (status, job.batch_id, job.transaction_id),
    )
    action_flag = "D" if job.operation == "DELETE" and status == "SUCCESS" else "U" if job.operation == "UPDATE" and status == "SUCCESS" else "S" if status == "SUCCESS" else "F" if status in {"FAILED"} else "U"
    retired_at = updated_at if job.operation == "DELETE" and status == "SUCCESS" else ""
    retired_reason = "Removed from CST LIR registry" if retired_at else ""
    connection.execute(
        """
        UPDATE cst_transaction_ledger
        SET cidr = ?, resource_uuid = ?, service_provider_id = ?, last_status = ?,
            retired_at = COALESCE(NULLIF(?, ''), retired_at), retired_reason = COALESCE(NULLIF(?, ''), retired_reason)
        WHERE transaction_id = ?
        """,
        (resource.cidr, resource.resource_uuid, resource.service_provider_id, status, retired_at, retired_reason, job.transaction_id),
    )
    connection.execute(
        "UPDATE ip_resources SET cst_sync_status = ?, transaction_id = ?, action_flag = ?, updated_at = ? WHERE resource_uuid = ?",
        (status, job.transaction_id, action_flag, updated_at, job.resource_uuid),
    )
    if resource.source_entity_type == "assignment":
        connection.execute(
            "UPDATE assignments SET cst_sync_status = ?, action_flag = ? WHERE id = ?",
            (status, action_flag, resource.source_entity_id),
        )


def retry_cst_send_jobs_batch(connection: sqlite3.Connection, job_rows: list[sqlite3.Row], force_api_override: bool = False) -> list[CstSyncJob] | None:
    if len(job_rows) < 2:
        return None
    config = ensure_cst_config(connection)
    if cst_send_payload_batch_size(config) < 2:
        return None
    entries: list[tuple[CstSyncJob, ResourceRecord, dict]] = []
    for row in job_rows:
        job = cst_job_from_row(row)
        if job.operation != "SEND" or cst_job_waiting_for_prior_delete(connection, job):
            return None
        resource_row = connection.execute("SELECT * FROM ip_resources WHERE resource_uuid = ?", (job.resource_uuid,)).fetchone()
        if resource_row is None:
            return None
        resource = resource_from_row(resource_row)
        payload = cst_payload_for_resource(resource, "SEND", job.transaction_id, job.batch_id)
        quality_issues = [*cst_resource_integrity_issues(connection, resource), *cst_data_quality_issues(resource, "SEND", payload)]
        if quality_issues:
            return None
        entries.append((job, resource, payload))
    provider_ids = {str(resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID) for _job, resource, _payload in entries}
    if len(provider_ids) > 1:
        return None
    if not force_api_override:
        if not config.enabled or not cst_operation_enabled(config, "SEND"):
            return None
    try:
        combined_payload = cst_combined_send_payload([(resource, job.transaction_id, payload) for job, resource, payload in entries])
        with CST_API_CALL_LOCK:
            status, last_error, response = execute_cst_real_api_job(connection, config, entries[0][1], "SEND", combined_payload, entries[0][0].transaction_id)
        response = {
            **response,
            "sendPayloadBatchSize": len(entries),
            "sendPayloadTransactionIds": [job.transaction_id for job, _resource, _payload in entries],
        }
    except HTTPException as exc:
        status = "FAILED"
        last_error = str(exc.detail)
        response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso(), "sendPayloadBatchSize": len(entries)}
    except Exception as exc:
        status = "FAILED"
        last_error = str(exc)
        response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso(), "sendPayloadBatchSize": len(entries)}
    updated_jobs: list[CstSyncJob] = []
    updated_at = now_iso()
    for job, resource, payload in entries:
        update_existing_cst_job_result(
            connection,
            job=job,
            resource=resource,
            payload=payload,
            status=status,
            last_error=last_error,
            response=response,
            updated_at=updated_at,
        )
        updated = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job.id,)).fetchone()
        updated_jobs.append(cst_job_from_row(updated))
    reconcile_cst_success_resource_statuses(connection)
    for batch_id in {job.batch_id for job in updated_jobs}:
        rows = connection.execute("SELECT status FROM cst_sync_jobs WHERE batch_id = ?", (batch_id,)).fetchall()
        total = len(rows)
        completed = sum(1 for item in rows if item["status"] in {"SUCCESS", "NOT_REQUIRED"})
        failed = sum(1 for item in rows if item["status"] == "FAILED")
        blocked = 0
        batch_status = "SUCCESS" if completed == total else "FAILED" if failed else "PENDING"
        connection.execute(
            "UPDATE cst_sync_batches SET status = ?, completed_jobs = ?, failed_jobs = ?, blocked_jobs = ?, completed_at = ? WHERE id = ?",
            (batch_status, completed, failed, blocked, now_iso() if batch_status in {"SUCCESS", "NOT_REQUIRED"} else "", batch_id),
        )
    return updated_jobs


def retry_cst_jobs(connection: sqlite3.Connection, job_rows: list[sqlite3.Row], force_api_override: bool = False) -> list[CstSyncJob]:
    batched_send_jobs = retry_cst_send_jobs_batch(connection, job_rows, force_api_override=force_api_override)
    if batched_send_jobs is not None:
        return batched_send_jobs
    updated_jobs: list[CstSyncJob] = []
    config = ensure_cst_config(connection)
    for row in job_rows:
        job = cst_job_from_row(row)
        resource_row = connection.execute("SELECT * FROM ip_resources WHERE resource_uuid = ?", (job.resource_uuid,)).fetchone()
        resource = resource_from_row(resource_row) if resource_row else None
        stored_payload = json.loads(job.payload_json or "{}")
        if resource is None and job.operation == "GET":
            page_number = int(stored_payload.get("pageNumber") or 1)
            resource = cst_get_lir_page_resource(config, page_number)
        updated_at = now_iso()
        payload = cst_payload_for_resource(resource, job.operation, job.transaction_id, job.batch_id) if resource else stored_payload
        if job.operation == "DELETE" and not cst_payload_has_data_array(payload):
            payload = cst_delete_payload(job.transaction_id, stored_payload.get("serviceProviderId") if isinstance(stored_payload, dict) else DEFAULT_SERVICE_PROVIDER_ID)
        validation_payload = cst_payload_for_resource(resource, "SEND", job.transaction_id, job.batch_id) if resource and job.operation not in {"SEND", "UPDATE", "GET"} else payload
        quality_issues = [*cst_resource_integrity_issues(connection, resource), *(cst_data_quality_issues(resource, job.operation, validation_payload) if resource else [])]
        retry_without_resource = resource is None and job.operation in {"DELETE", "UPDATE", "SEND"} and bool(payload)
        if cst_job_waiting_for_prior_delete(connection, job):
            status = "PENDING"
            last_error = cst_waiting_for_prior_delete_message()
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error}
        elif quality_issues:
            status = "PENDING"
            last_error = cst_quality_message(quality_issues)
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "dataQualityStatus": "INVALID_FOR_CST", "issues": quality_issues, "message": last_error}
        elif not force_api_override and not config.enabled:
            status = "PENDING"
            last_error = "CST integration is disabled in Administration"
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error, "processedAt": now_iso()}
        elif not force_api_override and not cst_operation_enabled(config, job.operation):
            status = "PENDING"
            last_error = cst_operation_disabled_message(job.operation)
            response = {"temporaryStorage": True, "externalApiCalled": False, "accepted": False, "message": last_error, "processedAt": now_iso()}
        elif resource or retry_without_resource:
            try:
                with CST_API_CALL_LOCK:
                    if resource:
                        status, last_error, response = execute_cst_real_api_job(connection, config, resource, job.operation, payload, job.transaction_id)
                    else:
                        token = ensure_cst_access_token(connection, config)
                        url = cst_operation_url_from_payload(config, job.operation, payload, job.transaction_id)
                        request_at = datetime.now(timezone.utc)
                        request_id = request_at.strftime("%Y%m%d%H%M%S") + f"{request_at.microsecond // 1000:03d}"
                        config_row = connection.execute("SELECT encrypted_api_access_key, encrypted_user_key FROM cst_config WHERE id = 'default'").fetchone()
                        api_key = decrypt_secret(str(config_row["encrypted_api_access_key"] or "")) if config_row else ""
                        lir_api_key = decrypt_secret(str(config_row["encrypted_user_key"] or "")) if config_row else ""
                        headers = {
                            "requestId": request_id,
                            "Accept-Language": config.accept_language or CST_DEFAULT_ACCEPT_LANGUAGE,
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        }
                        if api_key:
                            headers["x-Gateway-APIKey"] = api_key
                        if lir_api_key:
                            headers["apiKey"] = lir_api_key
                        status_code, response = cst_http_request(config, "POST", url, headers, json.dumps(payload, sort_keys=True).encode("utf-8"), config.read_timeout)
                        status = "SUCCESS" if 200 <= status_code < 300 else "FAILED"
                        last_error = "" if status == "SUCCESS" else f"CST API HTTP {status_code}"
            except HTTPException as exc:
                status = "FAILED"
                last_error = str(exc.detail)
                response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso()}
            except Exception as exc:
                status = "FAILED"
                last_error = str(exc)
                response = {"temporaryStorage": False, "externalApiCalled": True, "accepted": False, "message": last_error, "processedAt": now_iso()}
        else:
            status = "NOT_REQUIRED"
            last_error = ""
            message = "Local resource was removed before CST reporting; CST API call is not required"
            response = {"temporaryStorage": False, "externalApiCalled": False, "accepted": True, "message": message, "processedAt": now_iso()}
        connection.execute(
            """
            UPDATE cst_sync_jobs
            SET status = ?, attempt_count = attempt_count + 1, last_error = ?, payload_json = ?, response_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, last_error, json.dumps(payload, sort_keys=True), json.dumps(response, sort_keys=True), updated_at, job.id),
        )
        connection.execute(
            "UPDATE cst_transaction_ledger SET last_status = ?, batch_id = ? WHERE transaction_id = ?",
            (status, job.batch_id, job.transaction_id),
        )
        action_flag = "D" if job.operation == "DELETE" and status == "SUCCESS" else "U" if job.operation == "UPDATE" and status == "SUCCESS" else "S" if status == "SUCCESS" else "F" if status in {"FAILED"} else "U"
        retired_at = updated_at if job.operation == "DELETE" and status == "SUCCESS" else ""
        retired_reason = "Removed from CST LIR registry" if retired_at else ""
        ledger_resource_uuid = resource.resource_uuid if resource else job.resource_uuid
        ledger_cidr = resource.cidr if resource else job.cidr
        ledger_service_provider_id = resource.service_provider_id if resource else job.service_provider_id
        connection.execute(
            """
            UPDATE cst_transaction_ledger
            SET cidr = ?, resource_uuid = ?, service_provider_id = ?, last_status = ?,
                retired_at = COALESCE(NULLIF(?, ''), retired_at), retired_reason = COALESCE(NULLIF(?, ''), retired_reason)
            WHERE transaction_id = ?
            """,
            (ledger_cidr, ledger_resource_uuid, ledger_service_provider_id, status, retired_at, retired_reason, job.transaction_id),
        )
        connection.execute(
            "UPDATE ip_resources SET cst_sync_status = ?, transaction_id = ?, action_flag = ?, updated_at = ? WHERE resource_uuid = ?",
            (status, job.transaction_id, action_flag, updated_at, job.resource_uuid),
        )
        if resource and resource.source_entity_type == "assignment":
            connection.execute(
                "UPDATE assignments SET cst_sync_status = ?, action_flag = ? WHERE id = ?",
                (status, action_flag, resource.source_entity_id),
            )
        updated = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job.id,)).fetchone()
        updated_jobs.append(cst_job_from_row(updated))
    reconcile_cst_success_resource_statuses(connection)
    for batch_id in {job.batch_id for job in updated_jobs}:
        rows = connection.execute("SELECT status FROM cst_sync_jobs WHERE batch_id = ?", (batch_id,)).fetchall()
        total = len(rows)
        completed = sum(1 for item in rows if item["status"] in {"SUCCESS", "NOT_REQUIRED"})
        failed = sum(1 for item in rows if item["status"] == "FAILED")
        blocked = 0
        status = "SUCCESS" if completed == total else "FAILED" if failed else "PENDING"
        connection.execute(
            "UPDATE cst_sync_batches SET status = ?, completed_jobs = ?, failed_jobs = ?, blocked_jobs = ?, completed_at = ? WHERE id = ?",
            (status, completed, failed, blocked, now_iso() if status in {"SUCCESS", "NOT_REQUIRED"} else "", batch_id),
        )
    return updated_jobs


def reconcile_cst_success_resource_statuses(connection: sqlite3.Connection) -> int:
    rows = connection.execute(
        """
        SELECT j.resource_uuid, j.transaction_id, r.source_entity_type, r.source_entity_id
        FROM cst_sync_jobs j
        INNER JOIN ip_resources r ON r.resource_uuid = j.resource_uuid
        WHERE j.status = 'SUCCESS'
          AND r.cst_sync_status != 'SUCCESS'
          AND NOT EXISTS (
            SELECT 1
            FROM cst_sync_jobs newer
            WHERE newer.resource_uuid = j.resource_uuid
              AND newer.updated_at > j.updated_at
          )
        """
    ).fetchall()
    updated = 0
    timestamp = now_iso()
    for row in rows:
        connection.execute(
            "UPDATE ip_resources SET cst_sync_status = 'SUCCESS', transaction_id = ?, action_flag = 'S', updated_at = ? WHERE resource_uuid = ?",
            (row["transaction_id"], timestamp, row["resource_uuid"]),
        )
        if row["source_entity_type"] == "assignment":
            connection.execute(
                "UPDATE assignments SET cst_sync_status = 'SUCCESS', action_flag = 'S' WHERE id = ?",
                (row["source_entity_id"],),
            )
        updated += 1
    return updated


def cst_effective_pending_push_limit(config: CstConfig, requested_limit: int) -> int:
    configured_limit = max(int(config.batch_size_limit or 500), 1)
    if requested_limit > 0:
        return min(int(requested_limit), configured_limit)
    return configured_limit


def cst_rate_limit_delay_seconds(config: CstConfig) -> float:
    hourly_limit = max(int(config.hourly_request_limit or 1000), 1)
    return 3600.0 / hourly_limit


def cst_job_called_external_api(job: CstSyncJob) -> bool:
    try:
        response = json.loads(job.response_json or "{}")
    except Exception:
        return False
    return bool(response.get("externalApiCalled"))
def mark_cst_job_running(connection: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row:
    job = cst_job_from_row(row)
    if job.status == "RUNNING":
        raise HTTPException(status_code=409, detail="CST job is already running")
    updated_at = now_iso()
    cursor = connection.execute(
        "UPDATE cst_sync_jobs SET status = 'RUNNING', updated_at = ? WHERE id = ? AND status != 'RUNNING'",
        (updated_at, job.id),
    )
    if cursor.rowcount == 0:
        raise HTTPException(status_code=409, detail="CST job is already running")
    connection.execute(
        "UPDATE cst_transaction_ledger SET last_status = 'RUNNING', batch_id = ? WHERE transaction_id = ?",
        (job.batch_id, job.transaction_id),
    )
    resource_row = connection.execute("SELECT * FROM ip_resources WHERE resource_uuid = ?", (job.resource_uuid,)).fetchone()
    if resource_row:
        resource = resource_from_row(resource_row)
        connection.execute(
            "UPDATE ip_resources SET cst_sync_status = 'RUNNING', transaction_id = ?, action_flag = 'U', updated_at = ? WHERE resource_uuid = ?",
            (job.transaction_id, updated_at, job.resource_uuid),
        )
        if resource.source_entity_type == "assignment":
            connection.execute(
                "UPDATE assignments SET cst_sync_status = 'RUNNING', action_flag = 'U' WHERE id = ?",
                (resource.source_entity_id,),
            )
    connection.execute("UPDATE cst_sync_batches SET status = 'RUNNING', completed_at = '' WHERE id = ?", (job.batch_id,))
    running_row = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job.id,)).fetchone()
    if running_row is None:
        raise HTTPException(status_code=404, detail="CST job not found")
    return running_row


def process_cst_job_sequentially(connection: sqlite3.Connection, row: sqlite3.Row, force_api_override: bool = False) -> CstSyncJob:
    running_row = mark_cst_job_running(connection, row)
    connection.commit()
    return retry_cst_jobs(connection, [running_row], force_api_override=force_api_override)[0]
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


def ensure_assignment_cidr_conflicts_allowed(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assignments'"
    ).fetchone()
    create_sql = str(row["sql"] if row else "")
    if "cidr TEXT NOT NULL UNIQUE" not in create_sql:
        return
    temp_table = "assignments_allow_conflicts"
    connection.execute(f"DROP TABLE IF EXISTS {temp_table}")
    connection.execute(f"ALTER TABLE assignments RENAME TO {temp_table}")
    replacement_sql = create_sql.replace("CREATE TABLE assignments", "CREATE TABLE assignments", 1).replace("cidr TEXT NOT NULL UNIQUE", "cidr TEXT NOT NULL", 1)
    connection.execute(replacement_sql)
    columns = [str(info[1]) for info in connection.execute(f"PRAGMA table_info({temp_table})").fetchall()]
    column_sql = ", ".join(columns)
    connection.execute(f"INSERT INTO assignments ({column_sql}) SELECT {column_sql} FROM {temp_table}")
    connection.execute(f"DROP TABLE {temp_table}")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_assignments_cidr ON assignments (cidr)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_assignments_customer ON assignments (customer_name)")

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
              cidr TEXT NOT NULL,
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

            CREATE TABLE IF NOT EXISTS siebel_config (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL,
              encrypted_password TEXT NOT NULL,
              dsn TEXT NOT NULL,
              connection_timeout INTEGER NOT NULL,
              query_sql TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bss_sync_audit (
              id TEXT PRIMARY KEY,
              assignment_id TEXT NOT NULL,
              service_id TEXT NOT NULL DEFAULT '',
              siebel_order_number TEXT NOT NULL,
              changed_field TEXT NOT NULL,
              old_value TEXT NOT NULL,
              new_value TEXT NOT NULL,
              synced_at TEXT NOT NULL,
              status TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_bss_sync_assignment ON bss_sync_audit (assignment_id, synced_at);
            CREATE INDEX IF NOT EXISTS idx_bss_sync_service ON bss_sync_audit (service_id, synced_at);
            CREATE INDEX IF NOT EXISTS idx_bss_sync_order ON bss_sync_audit (siebel_order_number, synced_at);

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
              send_enabled INTEGER NOT NULL DEFAULT 1,
              update_enabled INTEGER NOT NULL DEFAULT 1,
              delete_enabled INTEGER NOT NULL DEFAULT 1,
              get_enabled INTEGER NOT NULL DEFAULT 1,
              integration_mode TEXT NOT NULL DEFAULT 'Real API',
              host TEXT NOT NULL DEFAULT 'cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local',
              port INTEGER NOT NULL DEFAULT 443,
              base_url TEXT NOT NULL DEFAULT 'https://cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local:443',
              token_path TEXT NOT NULL DEFAULT '/api/rest/v1.0/OAuthToken',
              send_path TEXT NOT NULL DEFAULT '/api/rest/v1.0/LIRDataService/SendLIRData',
              update_path TEXT NOT NULL DEFAULT '/api/rest/v1.0/LIRDataService/UpdateLIRData',
              delete_path TEXT NOT NULL DEFAULT '/api/rest/v1.0/LIRDataService/DeleteLIRData',
              get_path TEXT NOT NULL DEFAULT '/api/rest/v1.0/LIRDataService/GetLIRData',
              auth_username TEXT NOT NULL DEFAULT '',
              accept_language TEXT NOT NULL DEFAULT 'EN',
              encrypted_auth_password TEXT NOT NULL DEFAULT '',
              encrypted_api_access_key TEXT NOT NULL DEFAULT '',
              encrypted_user_key TEXT NOT NULL DEFAULT '',
              encrypted_access_token TEXT NOT NULL DEFAULT '',
              token_expires_at TEXT NOT NULL DEFAULT '',
              verify_ssl INTEGER NOT NULL DEFAULT 0,
              connection_timeout INTEGER NOT NULL DEFAULT 10,
              read_timeout INTEGER NOT NULL DEFAULT 30,
              token_refresh_buffer_seconds INTEGER NOT NULL DEFAULT 300,
              schedule_time TEXT NOT NULL DEFAULT '00:30',
              schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
              last_scheduled_run_date TEXT NOT NULL DEFAULT '',
              last_scheduled_run_at TEXT NOT NULL DEFAULT '',
              batch_size_limit INTEGER NOT NULL,
              send_payload_batch_size INTEGER NOT NULL DEFAULT 1,
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

            CREATE TABLE IF NOT EXISTS partial_reassignment_operations (
              id TEXT PRIMARY KEY,
              original_assignment_id TEXT NOT NULL,
              original_cidr TEXT NOT NULL,
              requested_cidr TEXT NOT NULL,
              status TEXT NOT NULL,
              original_transaction_id TEXT NOT NULL,
              assigned_transaction_id TEXT NOT NULL,
              assigned_payload_json TEXT NOT NULL,
              message TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS partial_reassignment_fragments (
              id TEXT PRIMARY KEY,
              operation_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              cidr TEXT NOT NULL,
              cst_operation TEXT NOT NULL,
              transaction_id TEXT NOT NULL,
              resource_uuid TEXT NOT NULL,
              cst_job_id TEXT NOT NULL,
              status TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              response_json TEXT NOT NULL,
              last_error TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_partial_reassignment_fragments_operation ON partial_reassignment_fragments (operation_id);
            CREATE INDEX IF NOT EXISTS idx_partial_reassignment_fragments_status ON partial_reassignment_fragments (status);
                    """
                )
        ensure_assignment_cidr_conflicts_allowed(connection)
        add_missing_columns(connection, "pools", Pool)
        add_missing_columns(connection, "assignments", Assignment)
        connection.execute("UPDATE assignments SET customer_type = 'NA' WHERE customer_type IS NULL OR TRIM(customer_type) = ''")
        connection.execute("UPDATE assignments SET subnet_type = 'NA' WHERE subnet_type IS NULL OR TRIM(subnet_type) = ''")
        connection.execute("UPDATE assignments SET customer_type = 'CORP' WHERE UPPER(TRIM(customer_type)) IN ('ENTERPRISE', 'CORPORATE', 'BUSINESS', 'B2B', 'GOV', 'GOVERNMENT', 'GOVERNMENTAL')")
        connection.execute("UPDATE assignments SET customer_type = 'RESI' WHERE UPPER(TRIM(customer_type)) IN ('INDIVIDUAL', 'RESIDENTIAL', 'CONSUMER', 'HOME', 'PERSONAL')")
        connection.execute("UPDATE assignments SET customer_type = 'NA' WHERE COALESCE(assignment_target_type, '') != 'business_customer' AND COALESCE(assignment_status_id, 0) != 3")
        add_missing_columns(connection, "ip_resources", ResourceRecord)
        add_missing_columns(connection, "assignment_details", AssignmentDetailRecord)
        bss_audit_columns = {row["name"] for row in connection.execute("PRAGMA table_info(bss_sync_audit)").fetchall()}
        if "service_id" not in bss_audit_columns:
            connection.execute("ALTER TABLE bss_sync_audit ADD COLUMN service_id TEXT NOT NULL DEFAULT ''")
        add_missing_columns(connection, "cst_config", CstConfig)
        cst_config_columns = {row["name"] for row in connection.execute("PRAGMA table_info(cst_config)").fetchall()}
        if "accept_language" not in cst_config_columns:
            connection.execute("ALTER TABLE cst_config ADD COLUMN accept_language TEXT NOT NULL DEFAULT 'EN'")
        connection.execute("UPDATE cst_config SET send_path = ? WHERE send_path = '/api/rest/v1.0/lir/resources'", (CST_SEND_LIR_PATH,))
        connection.execute("UPDATE cst_config SET update_path = ? WHERE update_path = '/api/rest/v1.0/lir/resources/{resourceUuid}'", (CST_UPDATE_LIR_PATH,))
        connection.execute("UPDATE cst_config SET delete_path = ? WHERE delete_path = '/api/rest/v1.0/lir/resources/{resourceUuid}'", (CST_DELETE_LIR_PATH,))
        connection.execute("UPDATE cst_config SET get_path = ? WHERE get_path = '/api/rest/v1.0/lir/resources/{resourceUuid}'", (CST_GET_LIR_PATH,))
        for column_name in ["encrypted_auth_password", "encrypted_api_access_key", "encrypted_user_key", "encrypted_access_token"]:
            if column_name not in cst_config_columns:
                connection.execute(f"ALTER TABLE cst_config ADD COLUMN {column_name} TEXT NOT NULL DEFAULT ''")
        migrate_legacy_cst_transaction_ids(connection)
        connection.execute("UPDATE cst_sync_jobs SET status = 'PENDING' WHERE status = 'BLOCKED'")
        connection.execute("UPDATE cst_transaction_ledger SET last_status = 'PENDING' WHERE last_status = 'BLOCKED'")
        connection.execute("UPDATE ip_resources SET cst_sync_status = 'PENDING', action_flag = 'U' WHERE cst_sync_status = 'BLOCKED'")
        connection.execute("UPDATE assignments SET cst_sync_status = 'PENDING', action_flag = 'U' WHERE cst_sync_status = 'BLOCKED'")
        connection.execute("UPDATE cst_sync_batches SET status = 'PENDING', blocked_jobs = 0 WHERE status = 'BLOCKED' OR blocked_jobs > 0")
        connection.execute("UPDATE ip_resources SET cst_sync_status = 'NOT_REQUIRED', ripe_sync_status = 'NOT_REQUIRED', action_flag = 'N' WHERE ip_type = 'PRIVATE'")
        connection.execute("UPDATE assignments SET cst_sync_status = 'NOT_REQUIRED', ripe_sync_status = 'NOT_REQUIRED', action_flag = 'N' WHERE id IN (SELECT source_entity_id FROM ip_resources WHERE source_entity_type = 'assignment' AND ip_type = 'PRIVATE')")
        connection.execute("UPDATE cst_sync_jobs SET status = 'NOT_REQUIRED', last_error = '', response_json = ? WHERE status IN ('PENDING', 'RUNNING') AND resource_uuid IN (SELECT resource_uuid FROM ip_resources WHERE ip_type = 'PRIVATE')", (json.dumps({"externalApiCalled": False, "accepted": True, "message": "Private IP range is excluded from CST synchronization"}, sort_keys=True),))

        siebel_config_count = connection.execute("SELECT COUNT(*) FROM siebel_config").fetchone()[0]
        if siebel_config_count == 0:
            connection.execute(
                """
                INSERT INTO siebel_config (id, username, encrypted_password, dsn, connection_timeout, query_sql, updated_at)
                VALUES ('default', 'LIR_USER', '', '172.31.23.101:1525/SIDB', 10, ?, ?)
                """,
                ("", now_iso()),
            )

        cst_config_count = connection.execute("SELECT COUNT(*) FROM cst_config").fetchone()[0]
        if cst_config_count == 0:
            connection.execute(
                """
                INSERT INTO cst_config (
                  id, enabled, service_provider_id, auto_execute, scheduled_sync_enabled,
                  integration_mode, host, port, base_url, token_path, send_path, update_path, delete_path, get_path,
                  auth_username, encrypted_auth_password, encrypted_api_access_key, encrypted_user_key, encrypted_access_token, token_expires_at,
                  verify_ssl, connection_timeout, read_timeout, token_refresh_buffer_seconds,
                  schedule_time, schedule_timezone, last_scheduled_run_date, last_scheduled_run_at,
                  batch_size_limit, send_payload_batch_size, hourly_request_limit, updated_at
                )
                VALUES ('default', 1, ?, 1, 1, 'Real API', 'cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local', 443,
                  'https://cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local:443', '/api/rest/v1.0/OAuthToken',
                  ?, ?, ?, ?,
                  '', '', '', '', '', '', 0, 10, 30, 300, '00:30', 'Asia/Riyadh', '', '', 500, 1, 1000, ?)
                """,
                (DEFAULT_SERVICE_PROVIDER_ID, CST_SEND_LIR_PATH, CST_UPDATE_LIR_PATH, CST_DELETE_LIR_PATH, CST_GET_LIR_PATH, now_iso()),
            )

        connection.execute("UPDATE cst_config SET integration_mode = 'Real API'")

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


def csv_cell_text(value: object) -> str:
    if isinstance(value, list):
        return ",".join(str(item or "").strip() for item in value if str(item or "").strip())
    return str(value or "").strip()


def csv_text_value(csv_text: object) -> str:
    if isinstance(csv_text, list):
        return "\n".join(csv_cell_text(item) for item in csv_text)
    return str(csv_text or "")


def csv_rows(csv_text: object) -> list[dict[str, str]]:
    reader = csv.DictReader(StringIO(csv_text_value(csv_text).strip()))
    if not reader.fieldnames:
        return []
    rows: list[dict[str, str]] = []
    for row in reader:
        normalized: dict[str, str] = {}
        for key, value in row.items():
            if key is None:
                extra_columns = csv_cell_text(value)
                if extra_columns:
                    normalized["_extra_columns"] = extra_columns
                continue
            normalized[str(key).strip()] = csv_cell_text(value)
        rows.append(normalized)
    return rows


def csv_data_row_count(csv_text: object) -> int:
    lines = [line for line in csv_text_value(csv_text).splitlines() if line.strip()]
    return max(0, len(lines) - 1)


def csv_value(row: dict[str, str], *keys: str) -> str:
    normalized = {str(key).lower(): value for key, value in row.items()}
    for key in keys:
        value = normalized.get(key.lower())
        if value is not None:
            return csv_cell_text(value)
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
    return ripe_service.attributes_by_name(ripe_object)


def cidrs_for_inetnum(value: str) -> str:
    return ripe_service.cidrs_for_inetnum(value)


def inetnum_range(value: str) -> tuple[IPv4Address, IPv4Address] | None:
    return ripe_service.inetnum_range(value)


def inetnum_in_pool(value: str, pool: RipeAllocatedPool) -> bool:
    return ripe_service.inetnum_in_range(value, pool.start_ip, pool.end_ip)


def cidr_for_root_range(start_ip: IPv4Address, end_ip: IPv4Address) -> str:
    return ripe_service.cidr_for_root_range(start_ip, end_ip)


def cidr_parts(value: str) -> list[str]:
    return ripe_service.cidr_parts(value)


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
    return ripe_service.objects_to_rows(objects)


def query_ripe_objects_by_inverse(config_row: sqlite3.Row, inverse_attribute: str, maintainer: str, include_no_referenced: bool = True) -> tuple[list[dict], str]:
    return ripe_service.query_objects_by_inverse(
        ripe_api_config_from_row(config_row),
        inverse_attribute,
        maintainer,
        include_no_referenced=include_no_referenced,
    )



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
            if row["source_system"] != RIPE_DISCOVERY_SOURCE_SYSTEM:
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
    return ripe_service.query_inetnum_rows_for_range(ripe_api_config_from_row(config_row), pool.start_ip, pool.end_ip)


def query_ripe_mnt_lower_rows(pool: RipeAllocatedPool, config_row: sqlite3.Row) -> tuple[list[dict[str, str | int]], str]:
    return ripe_service.query_mnt_lower_rows_in_range(ripe_api_config_from_row(config_row), pool.start_ip, pool.end_ip)


def ripe_inetnum_classification(status: str) -> str:
    return ripe_service.inetnum_classification(status)


def query_ripe_assignment_rows_by_maintainer(config_row: sqlite3.Row) -> tuple[list[dict[str, str | int]], str]:
    return ripe_service.query_assignment_rows_by_maintainer(ripe_api_config_from_row(config_row))


def ripe_netname_token(value: str) -> str:
    return ripe_service.netname_token(value)


def ripe_assignment_description(assignment: Assignment) -> str:
    return ripe_service.assignment_description(assignment.model_dump())


def ripe_assignment_object(assignment: Assignment, maintainer: str) -> dict:
    return ripe_service.assignment_object(assignment.model_dump(), maintainer)


def post_ripe_assignment(assignment: Assignment, config_row: sqlite3.Row) -> tuple[bool, int, str, str, dict]:
    result = ripe_service.post_assignment(ripe_api_config_from_row(config_row), assignment.model_dump())
    return result.success, result.status_code, result.message, result.response_body, result.request_object


def delete_ripe_assignment(assignment: Assignment, config_row: sqlite3.Row) -> tuple[bool, int, str, str, dict]:
    result = ripe_service.delete_assignment(ripe_api_config_from_row(config_row), assignment.start, assignment.end)
    return result.success, result.status_code, result.message, result.response_body, result.request_object


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


def bulk_assignment_type(row: dict[str, str], status_id: int) -> str:
    raw_type = csv_value(row, "assignmentType", "assignment_type", "type")
    normalized = raw_type.strip().upper().replace(" ", "_").replace("-", "_")
    if normalized in {"BUSINESS", "BUSINESS_CUSTOMER", "B2B"}:
        return "BUSINESS"
    if normalized in {"INTERNAL", "SALAM", "SALAM_INTERNAL"}:
        return "INTERNAL"
    if normalized:
        raise HTTPException(status_code=400, detail="assignmentType must be BUSINESS or INTERNAL")
    return "INTERNAL" if status_id == 2 else "BUSINESS"


def status_id_for_assignment_type(row: dict[str, str], status_id: int) -> int:
    assignment_type = bulk_assignment_type(row, status_id)
    if assignment_type == "INTERNAL":
        return 2
    if assignment_type == "BUSINESS":
        return 3
    return status_id


def normalize_bulk_cst_phone(value: str, row_number: int, field_name: str, warnings: list[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    normalized = normalize_cst_mobile_number(raw)
    if normalized:
        return normalized
    warnings.append(f"{field_name} value '{raw}' is invalid and was normalized to {CST_FALLBACK_PHONE_NUMBER}")
    return CST_FALLBACK_PHONE_NUMBER


def valid_organization_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"\d{10}", str(value or "").strip()))


def cst_bulk_readiness_for_assignment(connection: sqlite3.Connection, assignment: Assignment, warnings: list[str]) -> tuple[bool, str, list[str], list[str]]:
    resource = resource_record_for_assignment(assignment, connection=connection)
    transaction_id = assignment.logical_resource_id or assignment.id
    payload = cst_payload_for_resource(resource, "SEND", transaction_id, "bulk-import-preview")
    errors = cst_data_quality_issues(resource, "SEND", payload)
    assignment_type = (assignment.assignment_target_type or "").lower()
    if assignment_type == "business_customer" or assignment.assignment_status_id == 3:
        organization_identifier = assignment.organization_id or assignment.commercial_reg_id or assignment.unified_number
        if organization_identifier and not valid_organization_identifier(organization_identifier):
            errors.append("organizationId/commercialRegId/unifiedNumber must contain a valid 10-digit customer organization identifier for Business assignment")
        elif not organization_identifier:
            fallback_customer_id = str(assignment.customer_id or assignment.bss_customer_id or "").strip()
            if fallback_customer_id:
                warnings.append("organizationId/commercialRegId/unifiedNumber missing; customerId was used as organizationId for CST upload")
            else:
                errors.append("organizationId/commercialRegId/unifiedNumber/customerId is required for Business assignment")
        if assignment.commercial_reg_id and assignment.commercial_reg_id != "N/A" and not valid_organization_identifier(assignment.commercial_reg_id):
            errors.append("commercialRegId must be 10 digits when supplied")
        if assignment.unified_number and assignment.unified_number != "N/A" and not valid_organization_identifier(assignment.unified_number):
            errors.append("unifiedNumber must be 10 digits when supplied")
        if not (assignment.service_id or assignment.service_instance_id).strip():
            errors.append("serviceId is required for Business assignment")
        if not str(assignment.customer_id or assignment.bss_customer_id or "").strip():
            errors.append("customerId is required for Business assignment and preserved for BSS traceability")
    if assignment_type == "internal" or assignment.assignment_status_id == 2:
        if not str(assignment.owner or "").strip():
            errors.append("owner is required for Internal assignment")
        if not str(assignment.assignment_purpose or "").strip():
            errors.append("assignmentPurpose is required for Internal assignment")
        if not str(assignment.service_description or assignment.service or "").strip():
            errors.append("serviceDescription is required for Internal assignment")
        if not str(assignment.site or assignment.location_name or "").strip():
            errors.append("site or locationName is required for Internal assignment")
        if not str(assignment.full_name or assignment.contact_name or "").strip():
            errors.append("fullName or contactName is required for Internal assignment")
        if not str(assignment.email or assignment.contact_email or "").strip():
            errors.append("email or contactEmail is required for Internal assignment")
    unique_errors = list(dict.fromkeys(errors))
    unique_warnings = list(dict.fromkeys(warnings))
    ready = not unique_errors
    return ready, "READY" if ready else "NOT_READY", unique_errors, unique_warnings
def bulk_assignment_status(row: dict[str, str], is_pr_format: bool) -> tuple[int, str]:
    status_value = csv_value(row, "status")
    if not status_value:
        status_id = 3
    else:
        status_id = normalize_assignment_status_id(status_value)
    assignment_status = "Reserved" if status_id == 1 else "Active"
    return status_id, assignment_status


def assignment_payload_from_bulk_row(row: dict[str, str], network: IPv4Network, assignment_status_id: int, assignment_status: str, row_number: int = 0) -> AssignmentCreate:
    warnings: list[str] = []
    assignment_type = bulk_assignment_type(row, assignment_status_id)
    assignment_date = csv_value(row, "assignmentDate", "assignment_date")
    customer_name = csv_value(row, "customerName", "customer_name", "organizationName", "organization_name", "fullName", "full_name")
    service_id = csv_value(row, "serviceId", "service_id", "service_instance_id")
    service_description = csv_value(row, "serviceDescription", "service_description", "service")
    organization_id = csv_value(row, "organizationId", "organization_id")
    commercial_reg_id = csv_value(row, "commercial_reg_id", "commercialRegId", "crNumber", "cr_number")
    unified_number = csv_value(row, "unified_number", "unifiedNumber", "unifiedFacilityNumber", "unified_facility_number")
    customer_id = csv_value(row, "customerId", "customer_id")
    if not organization_id:
        organization_id = commercial_reg_id or unified_number or customer_id
        if organization_id == customer_id and assignment_type == "BUSINESS":
            warnings.append("organizationId/commercialRegId/unifiedNumber missing; customerId was used as organizationId for CST upload")
    mobile_number = normalize_bulk_cst_phone(csv_value(row, "mobileNumber", "mobile_number"), row_number, "mobileNumber", warnings)
    contact_number = normalize_bulk_cst_phone(csv_value(row, "contact_number", "contactNumber"), row_number, "contactNumber", warnings)
    if not mobile_number and contact_number:
        mobile_number = contact_number
    if not mobile_number:
        mobile_number = CST_FALLBACK_PHONE_NUMBER
        warnings.append(f"mobileNumber is missing and was defaulted to {CST_FALLBACK_PHONE_NUMBER}")
    full_name = csv_value(row, "fullName", "full_name") or csv_value(row, "contact_name", "contactName")
    email = normalize_cst_email(csv_value(row, "email")) or csv_value(row, "email")
    contact_email = normalize_cst_email(csv_value(row, "contact_email", "contactEmail")) or csv_value(row, "contact_email", "contactEmail")
    if not email and contact_email:
        email = contact_email
    region_text = csv_value(row, "region")
    city_text = csv_value(row, "city")
    customer_type_value = csv_value(row, "customerTypeId", "customer_type_id")
    lir_customer_type = normalize_lir_customer_type(csv_value(row, "customerType", "customer_type", "lirCustomerType", "lir_customer_type")) if assignment_type == "BUSINESS" else "NA"
    subnet_type = normalize_lir_subnet_type(csv_value(row, "subnetType", "subnet_type", "Subnet Type", "subnet type"))
    region_id_value = csv_value(row, "regionId", "region_id")
    city_id_value = csv_value(row, "cityId", "city_id")
    access_technology_value = csv_value(row, "accessTechnologyId", "access_technology_id", "accessTechnology", "access_technology")
    customer_type_id = str(cst_customer_type_id(customer_type_value) or customer_type_value or "")
    mapped_city_id = cst_city_id(city_id_value or city_text)
    if mapped_city_id is None:
        city_id = str(CST_FALLBACK_CITY_ID)
        source = city_id_value or city_text
        warnings.append(f"cityId/city value '{source}' is missing or invalid and was defaulted to {CST_FALLBACK_CITY_ID}" if source else f"cityId/city is missing and was defaulted to {CST_FALLBACK_CITY_ID}")
    else:
        city_id = str(mapped_city_id)
    mapped_region_id = cst_region_id(region_id_value or region_text)
    if mapped_region_id is None:
        region_id = str(CST_FALLBACK_REGION_ID)
        source = region_id_value or region_text
        warnings.append(f"regionId/region value '{source}' is missing or invalid and was defaulted to {CST_FALLBACK_REGION_ID}" if source else f"regionId/region is missing and was defaulted to {CST_FALLBACK_REGION_ID}")
    else:
        region_id = str(mapped_region_id)
    access_technology_id = str(cst_access_technology_id(access_technology_value) or access_technology_value or "")
    if not assignment_date:
        raise HTTPException(status_code=400, detail="assignmentDate is mandatory")
    if assignment_type == "BUSINESS" and not service_id:
        raise HTTPException(status_code=400, detail="serviceId is mandatory for Business assignment")
    if assignment_type == "INTERNAL" and not service_description:
        raise HTTPException(status_code=400, detail="serviceDescription is mandatory for Internal assignment")
    customer_name = customer_name or assignment_status_id_name(assignment_status_id)
    target_type = "internal" if assignment_type == "INTERNAL" else "business_customer"
    return AssignmentCreate(
        cidr=str(network),
        assignment_status_id=assignment_status_id,
        assignment_target_type=target_type,
        service_id=service_id,
        service_instance_id=csv_value(row, "serviceInstanceId", "service_instance_id") or service_id,
        service_order_id=csv_value(row, "serviceOrderId", "service_order_id"),
        siebel_order_number=csv_value(row, "siebelOrderNumber", "siebel_order_number"),
        bss_customer_id=csv_value(row, "bssCustomerId", "bss_customer_id", "customerId", "customer_id"),
        customer_id=customer_id,
        customer_name=customer_name,
        organization_name=csv_value(row, "organizationName", "organization_name") or customer_name,
        organization_id=organization_id,
        customer_type=lir_customer_type,
        subnet_type=subnet_type,
        customer_type_id=customer_type_id,
        region_id=region_id,
        city_id=city_id,
        full_name=full_name,
        mobile_number=mobile_number,
        id_number=normalize_cst_id_number(csv_value(row, "idNumber", "id_number", "customerIdentity", "customer_identity")) or csv_value(row, "idNumber", "id_number", "customerIdentity", "customer_identity"),
        email=email,
        commercial_reg_id=commercial_reg_id,
        unified_number=unified_number,
        contact_number=contact_number or mobile_number,
        contact_email=contact_email or email,
        city=city_text,
        region=region_text,
        contact_name=csv_value(row, "contact_name", "contactName") or full_name,
        internal_consumer_type=csv_value(row, "internalConsumerType", "internal_consumer_type"),
        internal_business_unit=csv_value(row, "internalBusinessUnit", "internal_business_unit"),
        internal_application_id=csv_value(row, "internalApplicationId", "internal_application_id"),
        internal_application_name=csv_value(row, "internalApplicationName", "internal_application_name"),
        internal_environment=csv_value(row, "internalEnvironment", "internal_environment"),
        internal_owner_team=csv_value(row, "internalOwnerTeam", "internal_owner_team"),
        internal_cost_center=csv_value(row, "internalCostCenter", "internal_cost_center"),
        internal_project_code=csv_value(row, "internalProjectCode", "internal_project_code"),
        internal_change_request_id=csv_value(row, "internalChangeRequestId", "internal_change_request_id"),
        internal_justification=csv_value(row, "internalJustification", "internal_justification"),
        l3_service=csv_value(row, "l3_service", "l3Service") or ("MPLS L3VPN" if assignment_type == "BUSINESS" else "Internal L3 Service"),
        service=service_description or csv_value(row, "service") or "L3 service allocation",
        service_description=service_description,
        access_technology_id=access_technology_id,
        access_technology=csv_value(row, "accessTechnology", "access_technology"),
        owner=csv_value(row, "owner") or ("Business Customer" if assignment_type == "BUSINESS" else ""),
        site=csv_value(row, "site"),
        site_id=csv_value(row, "siteId", "site_id"),
        location_name=csv_value(row, "locationName", "location_name"),
        assignment_purpose=csv_value(row, "assignmentPurpose", "assignment_purpose", "purpose"),
        environment=csv_value(row, "environment") or "Production",
        status=assignment_status,
        assignment_date=assignment_date,
        notes=csv_value(row, "notes"),
        cst_validation_warnings="; ".join(warnings),
    )


def validate_parent_pool(candidate: IPv4Network, excluded_pool_ids: set[str] | None = None) -> None:
    excluded_pool_ids = excluded_pool_ids or set()
    for pool in list_pools_from_db():
        if pool.id in excluded_pool_ids:
            continue
        if candidate.overlaps(network_of(pool)):
            raise HTTPException(status_code=409, detail=f"{candidate} overlaps parent pool {pool.cidr}")


def validate_private_pool_registration(candidate: IPv4Network) -> None:
    if not candidate.is_private:
        raise HTTPException(
            status_code=400,
            detail="Register Subnet supports private pools only. Public allocated pools must be synchronized from RIPE.",
        )


def assignment_active_for_conflict(assignment: Assignment) -> bool:
    if assignment_released_after_ripe_removal(assignment):
        return False
    if str(assignment.migration_conflict_status or "").upper() == "REJECTED":
        return False
    return str(assignment.status or "").strip().lower() not in {"retiring", "retired"}


def assignment_overlap_candidates(candidate: IPv4Network, excluded_assignment_ids: set[str] | None = None) -> list[Assignment]:
    excluded_assignment_ids = excluded_assignment_ids or set()
    overlaps: list[Assignment] = []
    for assignment in list_assignments_from_db():
        if assignment.id in excluded_assignment_ids or not assignment_active_for_conflict(assignment):
            continue
        if candidate.overlaps(network_of(assignment)):
            overlaps.append(assignment)
    return overlaps


def assignment_conflict_message(candidate: IPv4Network, overlaps: list[Assignment]) -> str:
    joined = "; ".join(f"{item.customer_name or item.id} allocation {item.cidr}" for item in overlaps[:8])
    extra = f" and {len(overlaps) - 8} more" if len(overlaps) > 8 else ""
    return f"{candidate} overlaps existing assignment(s): {joined}{extra}"


def conflict_group_for_assignments(candidate: IPv4Network, overlaps: list[Assignment]) -> str:
    members = ":".join(sorted([str(candidate), *[item.id for item in overlaps]]))
    return stable_uuid("migration-conflict", members)


def validate_assignment(candidate: IPv4Network, allow_overlap: bool = False) -> list[Assignment]:
    parent_candidates = [
        pool
        for pool in list_pools_from_db()
        if candidate.subnet_of(network_of(pool)) and candidate.prefixlen >= network_of(pool).prefixlen
    ]
    parent_candidates.sort(key=lambda pool: network_of(pool).prefixlen, reverse=True)
    parent = parent_candidates[0] if parent_candidates else None
    if parent is None:
        raise HTTPException(status_code=409, detail=f"{candidate} is outside managed parent pools")

    overlaps = assignment_overlap_candidates(candidate)
    if overlaps and not allow_overlap:
        raise HTTPException(status_code=409, detail=assignment_conflict_message(candidate, overlaps))
    return overlaps


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


def redact_database_url(url: str) -> str:
    text = str(url or "").strip()
    if not text:
        return ""
    try:
        parsed = urllib_parse.urlsplit(text)
    except Exception:
        return "***"
    if not parsed.netloc:
        return "***"
    username = urllib_parse.quote(urllib_parse.unquote(parsed.username or ""), safe="")
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    auth = f"{username}:***@" if username else "***@"
    return urllib_parse.urlunsplit((parsed.scheme or "postgresql", f"{auth}{host}{port}", parsed.path, parsed.query, ""))


def postgres_test_dsn(payload: DatabaseConnectionTestRequest) -> str:
    host = payload.host.strip()
    database = payload.database.strip()
    username = payload.username.strip()
    if not host or not database or not username:
        raise HTTPException(status_code=400, detail="PostgreSQL host, database, and username are required")
    if payload.port <= 0:
        raise HTTPException(status_code=400, detail="PostgreSQL port must be greater than zero")
    ssl_mode = payload.ssl_mode.strip() or "prefer"
    if ssl_mode not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
        raise HTTPException(status_code=400, detail="Unsupported PostgreSQL SSL mode")
    netloc = f"{urllib_parse.quote(username, safe='')}:{urllib_parse.quote(payload.password or '', safe='')}@{host}:{payload.port}"
    query = urllib_parse.urlencode({"sslmode": ssl_mode, "connect_timeout": max(int(payload.connect_timeout or 10), 1)})
    return urllib_parse.urlunsplit(("postgresql", netloc, f"/{urllib_parse.quote(database, safe='')}", query, ""))

@app.get("/health")
def health() -> dict[str, int | bool | str]:
    with connect() as connection:
        pool_count = connection.execute("SELECT COUNT(*) FROM pools").fetchone()[0]
        assignment_count = connection.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
        resource_count = connection.execute("SELECT COUNT(*) FROM ip_resources").fetchone()[0]
    return {"ok": True, "pools": pool_count, "assignments": assignment_count, "resources": resource_count, "database": str(DB_PATH), "database_engine": "SQLite"}


@app.get("/database/status", response_model=DatabaseConnectionStatus)
def database_connection_status() -> DatabaseConnectionStatus:
    configured = bool(DATABASE_URL)
    return DatabaseConnectionStatus(
        current_engine="SQLite",
        sqlite_path=str(DB_PATH),
        database_url_configured=configured,
        database_url_redacted=redact_database_url(DATABASE_URL),
        postgres_driver_available=psycopg is not None,
        postgres_runtime_supported=False,
        message="Current backend in this workspace still uses SQLite. Set DATABASE_URL only after PostgreSQL runtime support is merged and restart the API service.",
    )


@app.post("/database/test-postgres", response_model=DatabaseConnectionTestResponse)
def test_postgres_connection(payload: DatabaseConnectionTestRequest) -> DatabaseConnectionTestResponse:
    if psycopg is None:
        raise HTTPException(status_code=503, detail="Python package psycopg is not installed on the API server")
    dsn = postgres_test_dsn(payload)
    try:
        with psycopg.connect(dsn) as pg_connection:
            with pg_connection.cursor() as cursor:
                cursor.execute("SELECT version(), current_database(), current_user")
                version, database, username = cursor.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"PostgreSQL connection test failed: {exc}") from exc
    return DatabaseConnectionTestResponse(
        success=True,
        message="PostgreSQL connection test succeeded. Configure DATABASE_URL on the API server and restart when ready to switch.",
        server_version=str(version),
        database=str(database),
        username=str(username),
        tested_at=now_iso(),
    )


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


@app.get("/siebel/config", response_model=SiebelConfigOut)
def get_siebel_config() -> SiebelConfigOut:
    with connect() as connection:
        row = connection.execute("SELECT * FROM siebel_config WHERE id = 'default'").fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Siebel configuration not initialized")
    return siebel_config_from_row(row)


@app.put("/siebel/config", response_model=SiebelConfigOut)
def update_siebel_config(payload: SiebelConfigUpdate) -> SiebelConfigOut:
    if payload.connection_timeout <= 0:
        raise HTTPException(status_code=400, detail="Connection timeout must be greater than zero")
    if payload.query_sql.strip():
        validate_siebel_query(payload.query_sql)
    with connect() as connection:
        existing = connection.execute("SELECT * FROM siebel_config WHERE id = 'default'").fetchone()
        encrypted_password = encrypt_secret(payload.password) if payload.password else (existing["encrypted_password"] if existing else "")
        connection.execute(
            """
            INSERT INTO siebel_config (id, username, encrypted_password, dsn, connection_timeout, query_sql, updated_at)
            VALUES ('default', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              username = excluded.username,
              encrypted_password = excluded.encrypted_password,
              dsn = excluded.dsn,
              connection_timeout = excluded.connection_timeout,
              query_sql = excluded.query_sql,
              updated_at = excluded.updated_at
            """,
            (payload.username, encrypted_password, payload.dsn, payload.connection_timeout, payload.query_sql.strip(), now_iso()),
        )
        row = connection.execute("SELECT * FROM siebel_config WHERE id = 'default'").fetchone()
        record_audit(connection, "Siebel Configuration Updated", "siebel_config", "default", "", siebel_config_from_row(row).model_dump_json())
    return siebel_config_from_row(row)



@app.post("/siebel/config/test-connection", response_model=SiebelConnectionTestResponse)
def test_siebel_connection() -> SiebelConnectionTestResponse:
    if oracledb is None:
        raise HTTPException(status_code=503, detail="Python package oracledb is not installed on the API server")
    with connect() as connection:
        config = connection.execute("SELECT * FROM siebel_config WHERE id = 'default'").fetchone()
    if config is None:
        raise HTTPException(status_code=404, detail="Siebel configuration not initialized")
    encrypted_password = str(config["encrypted_password"] or "")
    if not encrypted_password:
        raise HTTPException(status_code=400, detail="Siebel password is not configured")
    dsn = str(config["dsn"] or "172.31.23.101:1525/SIDB")
    try:
        siebel_connection = oracledb.connect(
            user=str(config["username"] or "LIR_USER"),
            password=decrypt_secret(encrypted_password),
            dsn=dsn,
        )
        siebel_connection.call_timeout = int(config["connection_timeout"] or 10) * 1000
        with siebel_connection:
            cursor = siebel_connection.cursor()
            cursor.execute("SELECT 1 FROM dual")
            cursor.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Siebel connection test failed: {exc}") from exc
    return SiebelConnectionTestResponse(
        success=True,
        message="Siebel database connection test succeeded.",
        dsn=dsn,
        tested_at=now_iso(),
    )

def fetch_siebel_business_customer(service_id: str) -> SiebelLookupResponse:
    if oracledb is None:
        raise HTTPException(status_code=503, detail="Python package oracledb is not installed on the API server")
    with connect() as connection:
        config = connection.execute("SELECT * FROM siebel_config WHERE id = 'default'").fetchone()
    if config is None:
        raise HTTPException(status_code=404, detail="Siebel configuration not initialized")
    encrypted_password = str(config["encrypted_password"] or "")
    if not encrypted_password:
        raise HTTPException(status_code=400, detail="Siebel password is not configured")
    query = validate_siebel_query(str(config["query_sql"] or ""))
    try:
        siebel_connection = oracledb.connect(
            user=str(config["username"] or "LIR_USER"),
            password=decrypt_secret(encrypted_password),
            dsn=str(config["dsn"] or "172.31.23.101:1525/SIDB"),
        )
        siebel_connection.call_timeout = int(config["connection_timeout"] or 10) * 1000
        with siebel_connection:
            cursor = siebel_connection.cursor()
            cursor.execute(query, service_id=f"%{service_id}%")
            row = cursor.fetchone()
            if row is None:
                return SiebelLookupResponse(service_id=service_id, found=False, message="No Siebel customer details found for this service ID")
            columns = [str(column[0]) for column in cursor.description]
            raw = {column: serialize_siebel_value(value) for column, value in zip(columns, row)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Siebel lookup failed: {exc}") from exc
    patch = assignment_patch_from_siebel_row(raw, service_id)
    return SiebelLookupResponse(service_id=service_id, order_number=patch.get("siebel_order_number", ""), found=True, assignment=patch, raw=raw, message="Siebel customer details fetched")


def apply_bss_delta_to_assignment(connection: sqlite3.Connection, assignment: Assignment, patch: dict[str, str]) -> tuple[Assignment, list[BssSyncAuditRecord], bool]:
    service_id = patch.get("service_id") or assignment.service_id
    order_number = patch.get("siebel_order_number") or assignment.siebel_order_number or assignment.service_order_id
    audit_rows: list[BssSyncAuditRecord] = []
    changed_values: dict[str, str] = {}
    for field in syncable_bss_fields():
        if field not in patch:
            continue
        old_value = str(getattr(assignment, field, "") or "")
        new_value = str(patch.get(field, "") or "")
        if new_value and new_value != old_value:
            changed_values[field] = new_value
            audit_rows.append(record_bss_sync_audit(connection, assignment.id, service_id, order_number, field, old_value, new_value, "UPDATED"))
    business_changed = bool(changed_values)
    metadata_values = {
        field: str(patch.get(field, "") or "")
        for field in ["siebel_order_number", "siebel_last_checked_at", "siebel_payload_hash", "siebel_payload_json"]
        if field in patch
    }
    if business_changed:
        changed_values.update(metadata_values)
        changed_values["siebel_last_sync_at"] = str(patch.get("siebel_last_sync_at") or now_iso())
        set_sql = ", ".join(f"{field} = :{field}" for field in changed_values)
        connection.execute(
            f"UPDATE assignments SET {set_sql} WHERE id = :assignment_id",
            {**changed_values, "assignment_id": assignment.id},
        )
    else:
        connection.execute(
            "UPDATE assignments SET siebel_last_checked_at = ?, siebel_payload_hash = ?, siebel_payload_json = ? WHERE id = ?",
            (metadata_values.get("siebel_last_checked_at", now_iso()), metadata_values.get("siebel_payload_hash", assignment.siebel_payload_hash), metadata_values.get("siebel_payload_json", assignment.siebel_payload_json), assignment.id),
        )
        audit_rows.append(record_bss_sync_audit(connection, assignment.id, service_id, order_number, "NO_CHANGE", "", "", "UNCHANGED"))
    updated = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment.id,)).fetchone())
    resource = sync_assignment_resource(connection, updated)
    if business_changed and resource_requires_cst(resource):
        create_cst_sync_jobs(connection, [(resource, "UPDATE")], "BSS_DELTA_SYNC")
    return updated, audit_rows, business_changed


def sync_assignment_from_bss(connection: sqlite3.Connection, assignment: Assignment) -> tuple[Assignment | None, list[BssSyncAuditRecord], bool, str]:
    service_id = assignment.service_id.strip()
    order_number = assignment.siebel_order_number or assignment.service_order_id
    if not service_id:
        audit = record_bss_sync_audit(connection, assignment.id, "", order_number, "SERVICE_ID", "", "", "SKIPPED")
        return assignment, [audit], False, "skipped"
    lookup = fetch_siebel_business_customer(service_id)
    if not lookup.found:
        audit = record_bss_sync_audit(connection, assignment.id, service_id, order_number, "LOOKUP", "", lookup.message, "NOT_FOUND")
        connection.execute("UPDATE assignments SET siebel_last_checked_at = ? WHERE id = ?", (now_iso(), assignment.id))
        return assignment, [audit], False, "not_found"
    updated, audit_rows, changed = apply_bss_delta_to_assignment(connection, assignment, lookup.assignment)
    return updated, audit_rows, changed, "updated" if changed else "unchanged"


@app.post("/siebel/business-customer", response_model=SiebelLookupResponse)
def lookup_siebel_business_customer(payload: SiebelLookupRequest) -> SiebelLookupResponse:
    service_id = (payload.service_id or payload.order_number).strip()
    if not service_id:
        raise HTTPException(status_code=400, detail="Service ID is required")
    return fetch_siebel_business_customer(service_id)


@app.post("/assignments/{assignment_id}/siebel-refresh", response_model=BssDeltaSyncResponse)
def refresh_assignment_from_siebel(assignment_id: str) -> BssDeltaSyncResponse:
    assignment = find_assignment(assignment_id)
    if assignment.assignment_target_type != "business_customer":
        raise HTTPException(status_code=400, detail="Only business customer assignments can be refreshed from Siebel")
    with connect() as connection:
        updated, audit_rows, changed, status = sync_assignment_from_bss(connection, assignment)
        record_audit(connection, "BSS Delta Sync", "assignment", assignment.id, assignment.model_dump_json(), updated.model_dump_json() if updated else "")
    checked = 1
    return BssDeltaSyncResponse(checked=checked, updated=1 if changed else 0, unchanged=1 if status == "unchanged" else 0, failed=0 if status in {"updated", "unchanged"} else 1, audit=audit_rows, message=f"Siebel refresh {status}")


@app.post("/siebel/delta-sync", response_model=BssDeltaSyncResponse)
def run_siebel_delta_sync() -> BssDeltaSyncResponse:
    checked = updated_count = unchanged = failed = 0
    audit_rows: list[BssSyncAuditRecord] = []
    with connect() as connection:
        assignments = [
            assignment_from_row(row)
            for row in connection.execute(
                """
                SELECT * FROM assignments
                WHERE assignment_target_type = 'business_customer'
                  AND status IN ('Active', 'Planned', 'Reserved', 'Blocked')
                  AND service_id != ''
                ORDER BY created_at DESC
                """
            ).fetchall()
        ]
        for assignment in assignments:
            checked += 1
            try:
                before = assignment
                after, rows, changed, status = sync_assignment_from_bss(connection, assignment)
                audit_rows.extend(rows)
                if changed:
                    updated_count += 1
                    record_audit(connection, "BSS Delta Sync", "assignment", assignment.id, before.model_dump_json(), after.model_dump_json() if after else "")
                elif status == "unchanged":
                    unchanged += 1
                else:
                    failed += 1
            except HTTPException as exc:
                failed += 1
                audit_rows.append(record_bss_sync_audit(connection, assignment.id, assignment.service_id, assignment.siebel_order_number or assignment.service_order_id, "LOOKUP", "", str(exc.detail), "FAILED"))
            except Exception as exc:
                failed += 1
                audit_rows.append(record_bss_sync_audit(connection, assignment.id, assignment.service_id, assignment.siebel_order_number or assignment.service_order_id, "LOOKUP", "", str(exc), "FAILED"))
    return BssDeltaSyncResponse(checked=checked, updated=updated_count, unchanged=unchanged, failed=failed, audit=audit_rows[:100], message="Siebel delta sync completed")


@app.get("/siebel/delta-audit", response_model=list[BssSyncAuditRecord])
def list_bss_delta_audit(limit: int = 100) -> list[BssSyncAuditRecord]:
    safe_limit = min(max(limit, 1), 500)
    with connect() as connection:
        rows = connection.execute("SELECT * FROM bss_sync_audit ORDER BY synced_at DESC LIMIT ?", (safe_limit,)).fetchall()
    return [bss_sync_audit_from_row(row) for row in rows]


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
                    "source_system": RIPE_DISCOVERY_SOURCE_SYSTEM,
                    "external_id": payload.allocation_range or f"{payload.start_ip} - {payload.end_ip}",
                    "href": payload.object_href,
                    "last_audit_at": sync_time,
                    "tags": f"source=RIPE;pool_type=Allocated Pool;discovery_method=RIPE IP Pools Discovery;ripe_maintainer={payload.ripe_maintainer};sync_status=Synced;ripe_status={payload.ripe_status};ripe_discovery_presence=Current;ripe_discovery_seen_at={sync_time}",
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


@app.post("/cst/config/test-token", response_model=CstConnectionTestResponse)
def test_cst_token_connection() -> CstConnectionTestResponse:
    with connect() as connection:
        config = ensure_cst_config(connection)
        ensure_cst_access_token(connection, config, force_refresh=True)
        row = connection.execute("SELECT token_expires_at FROM cst_config WHERE id = 'default'").fetchone()
        return CstConnectionTestResponse(
            success=True,
            message="CST OAuth token API responded successfully. Token was refreshed and cached.",
            token_path=config.token_path,
            token_expires_at=str(row["token_expires_at"] or "") if row else "",
            tested_at=now_iso(),
        )


@app.put("/cst/config", response_model=CstConfig)
def update_cst_config(payload: CstConfigUpdate) -> CstConfig:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return get_cst_config()
    allowed = {
        "enabled", "service_provider_id", "auto_execute", "scheduled_sync_enabled", "send_enabled", "update_enabled", "delete_enabled", "get_enabled", "integration_mode",
        "host", "port", "base_url", "token_path", "send_path", "update_path", "delete_path", "get_path",
        "auth_username", "accept_language", "verify_ssl", "connection_timeout", "read_timeout", "token_refresh_buffer_seconds",
        "schedule_time", "schedule_timezone", "batch_size_limit", "send_payload_batch_size", "hourly_request_limit"
    }
    values = {key: value for key, value in updates.items() if key in allowed and value is not None}
    if updates.get("auth_password"):
        values["encrypted_auth_password"] = encrypt_secret(str(updates["auth_password"]))
        values["encrypted_access_token"] = ""
        values["token_expires_at"] = ""
    if updates.get("api_access_key"):
        values["encrypted_api_access_key"] = encrypt_secret(str(updates["api_access_key"]))
        values["encrypted_access_token"] = ""
        values["token_expires_at"] = ""
    if updates.get("user_key"):
        values["encrypted_user_key"] = encrypt_secret(str(updates["user_key"]))
        values["encrypted_access_token"] = ""
        values["token_expires_at"] = ""
    if not values:
        return get_cst_config()
    values["integration_mode"] = "Real API"
    if "port" in values and int(values["port"]) <= 0:
        raise HTTPException(status_code=400, detail="port must be greater than zero")
    for timeout_field in ["connection_timeout", "read_timeout", "token_refresh_buffer_seconds"]:
        if timeout_field in values and int(values[timeout_field]) < 1:
            raise HTTPException(status_code=400, detail=f"{timeout_field} must be at least 1")
    if "batch_size_limit" in values and int(values["batch_size_limit"]) < 1:
        raise HTTPException(status_code=400, detail="batchSizeLimit must be at least 1")
    if "send_payload_batch_size" in values and int(values["send_payload_batch_size"]) < 1:
        raise HTTPException(status_code=400, detail="sendPayloadBatchSize must be at least 1")
    if "hourly_request_limit" in values and int(values["hourly_request_limit"]) < 1:
        raise HTTPException(status_code=400, detail="hourlyRequestLimit must be at least 1")
    if "schedule_time" in values:
        parse_cst_schedule_time(str(values["schedule_time"]))
    if "schedule_timezone" in values:
        try:
            ZoneInfo(str(values["schedule_timezone"]))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Unsupported CST schedule timezone") from exc
    current_config = get_cst_config()
    effective_host = values.get("host") or current_config.host
    effective_port = int(values.get("port") or current_config.port or 443)
    if "host" in values or "port" in values or cst_base_url_uses_placeholder_host(values.get("base_url")):
        if "base_url" not in values or cst_base_url_uses_placeholder_host(values.get("base_url")):
            values["base_url"] = cst_base_url_from_host_port(effective_host, effective_port)
    values["verify_ssl"] = 0
    for boolean_field in ["enabled", "auto_execute", "scheduled_sync_enabled", "send_enabled", "update_enabled", "delete_enabled", "get_enabled"]:
        if boolean_field in values:
            values[boolean_field] = 1 if values[boolean_field] else 0
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
        backfill_missing_cst_transaction_ledger(connection)
        rows = connection.execute(
            """
            SELECT l.*
            FROM cst_transaction_ledger l
            LEFT JOIN (
              SELECT transaction_id,
                     MAX(created_at) AS latest_job_at,
                     MAX(CASE WHEN status IN ('PENDING', 'RUNNING', 'FAILED', 'BLOCKED') THEN 1 ELSE 0 END) AS active_job
              FROM cst_sync_jobs
              GROUP BY transaction_id
            ) j ON j.transaction_id = l.transaction_id
            ORDER BY
              CASE
                WHEN l.last_status IN ('PENDING', 'RUNNING', 'FAILED', 'BLOCKED') OR COALESCE(j.active_job, 0) = 1 THEN 0
                ELSE 1
              END,
              COALESCE(j.latest_job_at, l.first_used_at) DESC
            LIMIT 500
            """
        ).fetchall()
    return [cst_ledger_from_row(row) for row in rows]

def cst_review_id(operation: str, resource_uuid: str) -> str:
    return f"{operation.upper()}:{resource_uuid}"


def parse_cst_review_id(review_id: str) -> tuple[str, str]:
    operation, _, resource_uuid = str(review_id or "").partition(":")
    return operation.upper(), resource_uuid


def cst_resource_existing_transaction_id(connection: sqlite3.Connection, resource: ResourceRecord) -> str:
    row = connection.execute(
        """
        SELECT transaction_id
        FROM cst_transaction_ledger
        WHERE resource_uuid = ? OR cidr = ?
        ORDER BY CASE WHEN resource_uuid = ? THEN 0 ELSE 1 END, first_used_at DESC
        LIMIT 1
        """,
        (resource.resource_uuid, resource.cidr, resource.resource_uuid),
    ).fetchone()
    if row:
        return str(row["transaction_id"] or "")
    return str(resource.transaction_id or "")


def cst_resource_has_existing_job(connection: sqlite3.Connection, resource_uuid: str) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM cst_sync_jobs j
        INNER JOIN cst_sync_batches b ON b.id = j.batch_id
        WHERE j.resource_uuid = ?
          AND b.workflow_type IN ('MANUAL_LIR_MIGRATION', 'INITIAL_MIGRATION')
          AND j.status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'NOT_REQUIRED')
        LIMIT 1
        """,
        (resource_uuid,),
    ).fetchone()
    return row is not None


def cst_review_operation_item(connection: sqlite3.Connection, resource: ResourceRecord, operation: str) -> CstMigrationReviewItem:
    operation = operation.upper()
    transaction_id = cst_resource_existing_transaction_id(connection, resource)
    proposed_transaction_id = transaction_id or "Generated on job creation"
    validation_payload = cst_payload_for_resource(resource, "SEND" if operation not in {"SEND", "UPDATE"} else operation, transaction_id or resource.resource_uuid, "migration-review")
    issues = [*cst_resource_integrity_issues(connection, resource), *cst_data_quality_issues(resource, operation, validation_payload)]
    return CstMigrationReviewItem(
        review_id=cst_review_id(operation, resource.resource_uuid),
        resource_uuid=resource.resource_uuid,
        operation=operation,
        cidr=resource.cidr,
        start_ip=resource.start_ip,
        end_ip=resource.end_ip,
        customer_name=resource.organization_name or resource.customer_name,
        customer_id=resource.organization_id,
        service_id=resource.service_id,
        transaction_id=proposed_transaction_id,
        assignment_status_id=int(resource.assignment_status_id or 1),
        assignment_status=assignment_status_id_name(int(resource.assignment_status_id or 1)),
        validation_status="INVALID" if issues else "VALID",
        validation_errors=issues,
        cst_sync_status=resource.cst_sync_status,
        source_entity_type=resource.source_entity_type,
        created_at=resource.created_at,
        eligible=not issues,
        reason="; ".join(issues),
    )


def cst_review_matches_filter(item: CstMigrationReviewItem, request: CstMigrationReviewRequest) -> bool:
    search = str(request.search or "").strip().lower()
    if search:
        haystack = " ".join([
            item.cidr,
            item.start_ip,
            item.end_ip,
            item.customer_name,
            item.customer_id,
            item.service_id,
            item.transaction_id,
            item.resource_uuid,
        ]).lower()
        if search not in haystack:
            return False
    assignment_status = str(request.assignment_status or "all").strip().lower()
    if assignment_status not in {"", "all"}:
        status_name = item.assignment_status.lower()
        if assignment_status.isdigit():
            if str(item.assignment_status_id) != assignment_status:
                return False
        elif assignment_status not in status_name:
            return False
    transaction_type = str(request.transaction_type or "all").strip().upper()
    if transaction_type not in {"", "ALL"} and item.operation != transaction_type:
        return False
    validation_status = str(request.validation_status or "all").strip().upper()
    if validation_status not in {"", "ALL"} and item.validation_status != validation_status:
        return False
    created_at = item.created_at[:10]
    if request.created_from and created_at < request.created_from:
        return False
    if request.created_to and created_at > request.created_to:
        return False
    return True


def cst_assignment_review_where(request: CstMigrationReviewRequest) -> tuple[str, list[object], bool]:
    filters = [
        "r.source_entity_type = 'assignment'",
        "r.ip_type = 'PUBLIC'",
        "r.status != 'RETIRED'",
        "r.assignment_status_id IN (2, 3, 4)",
        "(COALESCE(a.migration_conflict_status, '') IN ('', 'ACCEPTED'))",
        """
        NOT EXISTS (
          SELECT 1
          FROM cst_sync_jobs j
          INNER JOIN cst_sync_batches b ON b.id = j.batch_id
          WHERE j.resource_uuid = r.resource_uuid
            AND b.workflow_type IN ('MANUAL_LIR_MIGRATION', 'INITIAL_MIGRATION')
            AND j.status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'NOT_REQUIRED')
        )
        """,
    ]
    params: list[object] = []
    if not request.include_existing_transactions:
        filters.append("r.resource_uuid NOT IN (SELECT resource_uuid FROM cst_transaction_ledger)")

    search = str(request.search or "").strip().lower()
    if search:
        filters.append(
            """
            lower(
              COALESCE(r.cidr, '') || ' ' || COALESCE(r.start_ip, '') || ' ' || COALESCE(r.end_ip, '') || ' ' ||
              COALESCE(r.customer_name, '') || ' ' || COALESCE(r.organization_name, '') || ' ' || COALESCE(r.organization_id, '') || ' ' ||
              COALESCE(r.service_id, '') || ' ' || COALESCE(r.transaction_id, '') || ' ' || COALESCE(r.resource_uuid, '')
            ) LIKE ?
            """
        )
        params.append(f"%{search}%")

    assignment_status = str(request.assignment_status or "all").strip().lower()
    if assignment_status not in {"", "all"}:
        if assignment_status.isdigit():
            filters.append("r.assignment_status_id = ?")
            params.append(int(assignment_status))
        else:
            status_map = {"internal": 2, "business": 3, "individual": 4, "unassigned": 1}
            status_id = status_map.get(assignment_status)
            if status_id is None:
                return "1 = 0", [], True
            filters.append("r.assignment_status_id = ?")
            params.append(status_id)

    transaction_type = str(request.transaction_type or "all").strip().upper()
    if transaction_type not in {"", "ALL", "SEND"}:
        return "1 = 0", [], True

    validation_status = str(request.validation_status or "all").strip().upper()
    if validation_status == "VALID":
        filters.append("COALESCE(a.cst_sync_ready, 0) = 1")
    elif validation_status == "INVALID":
        filters.append("COALESCE(a.cst_sync_ready, 0) = 0")
    elif validation_status not in {"", "ALL"}:
        return "1 = 0", [], True

    if request.created_from:
        filters.append("substr(r.created_at, 1, 10) >= ?")
        params.append(request.created_from)
    if request.created_to:
        filters.append("substr(r.created_at, 1, 10) <= ?")
        params.append(request.created_to)

    return " AND ".join(filters), params, False


def cst_assignment_review_response(connection: sqlite3.Connection, request: CstMigrationReviewRequest) -> CstMigrationReviewResponse:
    where_sql, params, empty = cst_assignment_review_where(request)
    if empty:
        return CstMigrationReviewResponse(
            page=request.page,
            page_size=request.page_size,
            total=0,
            resource_scope=request.resource_scope,
            generated_at=now_iso(),
            items=[],
            all_matching_review_ids=[],
            counts=CstMigrationReviewCounts(),
        )

    base_from = """
        FROM ip_resources r
        LEFT JOIN assignments a ON r.source_entity_type = 'assignment' AND r.source_entity_id = a.id
        WHERE {where_sql}
    """
    total_row = connection.execute(
        f"""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN COALESCE(a.cst_sync_ready, 0) = 1 THEN 1 ELSE 0 END) AS valid,
               SUM(CASE WHEN COALESCE(a.cst_sync_ready, 0) = 0 THEN 1 ELSE 0 END) AS invalid
        {base_from.format(where_sql=where_sql)}
        """,
        params,
    ).fetchone()
    total = int(total_row["total"] or 0)
    valid_count = int(total_row["valid"] or 0)
    invalid_count = int(total_row["invalid"] or 0)
    all_ids = [
        str(row["review_id"])
        for row in connection.execute(
            f"""
            SELECT 'SEND:' || r.resource_uuid AS review_id
            {base_from.format(where_sql=where_sql)}
            ORDER BY datetime(r.created_at) DESC, r.created_at DESC, r.prefix DESC, r.cidr
            """,
            params,
        ).fetchall()
    ]
    offset = (request.page - 1) * request.page_size
    rows = connection.execute(
        f"""
        SELECT r.*
        {base_from.format(where_sql=where_sql)}
        ORDER BY datetime(r.created_at) DESC, r.created_at DESC, r.prefix DESC, r.cidr
        LIMIT ? OFFSET ?
        """,
        [*params, request.page_size, offset],
    ).fetchall()
    page_items = [cst_review_operation_item(connection, resource_from_row(row), "SEND") for row in rows]
    return CstMigrationReviewResponse(
        page=request.page,
        page_size=request.page_size,
        total=total,
        resource_scope=request.resource_scope,
        generated_at=now_iso(),
        items=page_items,
        all_matching_review_ids=all_ids,
        counts=CstMigrationReviewCounts(
            total_matching=total,
            included_default=total,
            excluded=0,
            selected=0,
            valid=valid_count,
            invalid=invalid_count,
        ),
    )

def cst_assignment_review_items_for_ids(connection: sqlite3.Connection, review_ids: list[str]) -> dict[str, CstMigrationReviewItem]:
    resource_uuids = []
    for review_id in review_ids:
        operation, resource_uuid = parse_cst_review_id(review_id)
        if operation == "SEND" and resource_uuid:
            resource_uuids.append(resource_uuid)
    resource_uuids = list(dict.fromkeys(resource_uuids))
    if not resource_uuids:
        return {}
    placeholders = ", ".join("?" for _ in resource_uuids)
    rows = connection.execute(
        f"""
        SELECT r.*
        FROM ip_resources r
        LEFT JOIN assignments a ON r.source_entity_type = 'assignment' AND r.source_entity_id = a.id
        WHERE r.resource_uuid IN ({placeholders})
          AND r.source_entity_type = 'assignment'
          AND r.ip_type = 'PUBLIC'
          AND r.status != 'RETIRED'
          AND r.assignment_status_id IN (2, 3, 4)
          AND r.resource_uuid NOT IN (SELECT resource_uuid FROM cst_transaction_ledger)
          AND COALESCE(a.migration_conflict_status, '') IN ('', 'ACCEPTED')
          AND NOT EXISTS (
            SELECT 1
            FROM cst_sync_jobs j
            INNER JOIN cst_sync_batches b ON b.id = j.batch_id
            WHERE j.resource_uuid = r.resource_uuid
              AND b.workflow_type IN ('MANUAL_LIR_MIGRATION', 'INITIAL_MIGRATION')
              AND j.status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'NOT_REQUIRED')
          )
        """,
        resource_uuids,
    ).fetchall()
    return {
        cst_review_id("SEND", str(row["resource_uuid"])): cst_review_operation_item(connection, resource_from_row(row), "SEND")
        for row in rows
    }

def cst_migration_review_items(connection: sqlite3.Connection, request: CstMigrationReviewRequest) -> list[CstMigrationReviewItem]:
    scope = normalize_cst_resource_scope(request.resource_scope)
    payload = CstManualMigrationRequest(
        limit=0,
        execute_immediately=False,
        include_existing_transactions=request.include_existing_transactions,
        only_cst_ready=False,
        resource_scope=scope,
    )
    operations, _eligible_count, _parent_delete_count = cst_migration_resource_operations(connection, payload)
    items: list[CstMigrationReviewItem] = []
    seen: set[str] = set()
    for resource, operation in operations:
        review_id = cst_review_id(operation, resource.resource_uuid)
        if review_id in seen:
            continue
        seen.add(review_id)
        if cst_resource_has_existing_job(connection, resource.resource_uuid):
            continue
        item = cst_review_operation_item(connection, resource, operation)
        if cst_review_matches_filter(item, request):
            items.append(item)
    return items

def cst_migration_resource_rows(connection: sqlite3.Connection, payload: CstManualMigrationRequest) -> tuple[list[ResourceRecord], int]:
    materialize_bulk_unassigned_fragments(connection)
    resource_scope = normalize_cst_resource_scope(payload.resource_scope)
    filters = [
        "r.ip_type = 'PUBLIC'",
        "r.status != 'RETIRED'",
        """
        (
          r.source_entity_type != 'pool'
          OR NOT EXISTS (
            SELECT 1
            FROM ip_resources child
            WHERE child.root_pool_uuid = r.resource_uuid
              AND child.resource_uuid != r.resource_uuid
              AND child.status != 'RETIRED'
              AND child.source_entity_type IN ('assignment', 'bulk_unassigned_fragment')
          )
        )
        """,
    ]
    params: list[object] = []
    if resource_scope == "assigned":
        filters.append("r.assignment_status_id IN (2, 3, 4)")
    elif resource_scope == "unassigned":
        filters.append("r.assignment_status_id = 1")
    if not payload.include_existing_transactions:
        filters.append("r.resource_uuid NOT IN (SELECT resource_uuid FROM cst_transaction_ledger)")
    filters.append("(r.source_entity_type != 'assignment' OR COALESCE(a.migration_conflict_status, '') IN ('', 'ACCEPTED'))")
    if payload.only_cst_ready:
        filters.append("(r.source_entity_type != 'assignment' OR COALESCE(a.cst_sync_ready, 0) = 1)")
    where_sql = " AND ".join(filters)
    total = connection.execute(
        f"""
        SELECT COUNT(*)
        FROM ip_resources r
        LEFT JOIN assignments a ON r.source_entity_type = 'assignment' AND r.source_entity_id = a.id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()[0]
    limit_sql = " LIMIT ?" if payload.limit > 0 else ""
    query_params = [*params, payload.limit] if payload.limit > 0 else params
    rows = connection.execute(
        f"""
        SELECT r.*
        FROM ip_resources r
        LEFT JOIN assignments a ON r.source_entity_type = 'assignment' AND r.source_entity_id = a.id
        WHERE {where_sql}
        ORDER BY datetime(r.created_at) DESC, r.created_at DESC, r.prefix DESC, r.cidr
        {limit_sql}
        """,
        query_params,
    ).fetchall()
    return [resource_from_row(row) for row in rows], int(total or 0)


def cst_migration_parent_delete_operations(connection: sqlite3.Connection, resource_scope: str = "all") -> list[tuple[ResourceRecord, str]]:
    materialize_bulk_unassigned_fragments(connection)
    scope = normalize_cst_resource_scope(resource_scope)
    scope_filter = ""
    if scope == "assigned":
        scope_filter = "AND child.assignment_status_id IN (2, 3, 4)"
    elif scope == "unassigned":
        scope_filter = "AND child.assignment_status_id = 1"
    rows = connection.execute(
        f"""
        SELECT parent.*
        FROM ip_resources parent
        WHERE parent.source_entity_type = 'pool'
          AND parent.ip_type = 'PUBLIC'
          AND parent.status != 'RETIRED'
          AND EXISTS (
            SELECT 1
            FROM ip_resources child
            LEFT JOIN assignments child_assignment ON child.source_entity_type = 'assignment' AND child.source_entity_id = child_assignment.id
            WHERE child.root_pool_uuid = parent.resource_uuid
              AND child.resource_uuid != parent.resource_uuid
              AND child.status != 'RETIRED'
              AND child.source_entity_type IN ('assignment', 'bulk_unassigned_fragment')
              AND (child.source_entity_type != 'assignment' OR COALESCE(child_assignment.migration_conflict_status, '') IN ('', 'ACCEPTED'))
              {scope_filter}
          )
        ORDER BY parent.prefix ASC, parent.cidr ASC
        """
    ).fetchall()
    operations: list[tuple[ResourceRecord, str]] = []
    for row in rows:
        resource = resource_from_row(row)
        if cst_resource_reported_to_cst(connection, resource) and not cst_resource_deleted_from_cst(connection, resource):
            operations.append((resource, "DELETE"))
    return operations


def cst_migration_resource_operations(
    connection: sqlite3.Connection,
    payload: CstManualMigrationRequest,
) -> tuple[list[tuple[ResourceRecord, str]], int, int]:
    resources, eligible_count = cst_migration_resource_rows(connection, payload)
    delete_operations = cst_migration_parent_delete_operations(connection, payload.resource_scope)
    operations = [*delete_operations, *[(resource, "SEND") for resource in resources]]
    return operations, eligible_count, len(delete_operations)

def cst_batch_job_stats(connection: sqlite3.Connection, batch_id: str) -> CstMigrationJobStats:
    batch = connection.execute("SELECT * FROM cst_sync_batches WHERE id = ?", (batch_id,)).fetchone()
    if batch is None:
        raise HTTPException(status_code=404, detail="CST migration job batch not found")
    jobs = connection.execute("SELECT * FROM cst_sync_jobs WHERE batch_id = ?", (batch_id,)).fetchall()
    status_counts = {str(row["status"]): int(row["count"]) for row in connection.execute(
        "SELECT status, COUNT(*) AS count FROM cst_sync_jobs WHERE batch_id = ? GROUP BY status",
        (batch_id,),
    ).fetchall()}
    external_api_calls = 0
    last_error = ""
    for row in jobs:
        if str(row["last_error"] or ""):
            last_error = str(row["last_error"])
        try:
            response = json.loads(str(row["response_json"] or "{}"))
        except Exception:
            response = {}
        if response.get("externalApiCalled"):
            external_api_calls += 1
    total_transactions = connection.execute(
        "SELECT COUNT(DISTINCT transaction_id) FROM cst_sync_jobs WHERE batch_id = ?",
        (batch_id,),
    ).fetchone()[0]
    return CstMigrationJobStats(
        batch_id=str(batch["id"]),
        workflow_type=str(batch["workflow_type"]),
        status=str(batch["status"]),
        total_jobs=len(jobs),
        pending_jobs=status_counts.get("PENDING", 0),
        running_jobs=status_counts.get("RUNNING", 0),
        success_jobs=status_counts.get("SUCCESS", 0),
        failed_jobs=status_counts.get("FAILED", 0),
        blocked_jobs=status_counts.get("BLOCKED", 0),
        not_required_jobs=status_counts.get("NOT_REQUIRED", 0),
        external_api_calls=external_api_calls,
        total_transactions=int(total_transactions or 0),
        created_at=str(batch["created_at"]),
        completed_at=str(batch["completed_at"]),
        last_error=last_error,
    )


def process_cst_batch_pending_jobs(connection: sqlite3.Connection, batch_id: str, force_api_override: bool = False) -> list[CstSyncJob]:
    rows = connection.execute(
        "SELECT * FROM cst_sync_jobs WHERE batch_id = ? AND status = 'PENDING' ORDER BY sequence_no, id",
        (batch_id,),
    ).fetchall()
    processed: list[CstSyncJob] = []
    config = ensure_cst_config(connection)
    rate_delay_seconds = cst_rate_limit_delay_seconds(config)
    send_payload_batch_size = cst_send_payload_batch_size(config)
    index = 0
    while index < len(rows):
        row = rows[index]
        job = cst_job_from_row(row)
        if job.operation == "SEND" and send_payload_batch_size > 1:
            send_rows: list[sqlite3.Row] = []
            provider_id = ""
            while index < len(rows) and len(send_rows) < send_payload_batch_size:
                candidate = cst_job_from_row(rows[index])
                if candidate.operation != "SEND":
                    break
                resource_row = connection.execute("SELECT service_provider_id FROM ip_resources WHERE resource_uuid = ?", (candidate.resource_uuid,)).fetchone()
                candidate_provider_id = str(resource_row["service_provider_id"] or DEFAULT_SERVICE_PROVIDER_ID) if resource_row else str(candidate.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID)
                if provider_id and candidate_provider_id != provider_id:
                    break
                provider_id = candidate_provider_id
                send_rows.append(rows[index])
                index += 1
            if len(send_rows) > 1:
                running_rows = [mark_cst_job_running(connection, send_row) for send_row in send_rows]
                connection.commit()
                jobs = retry_cst_jobs(connection, running_rows, force_api_override=force_api_override)
                processed.extend(jobs)
                connection.commit()
                if index < len(rows) and any(cst_job_called_external_api(item) for item in jobs):
                    time.sleep(rate_delay_seconds)
                continue
            if send_rows:
                row = send_rows[0]
        else:
            index += 1
        job = process_cst_job_sequentially(connection, row, force_api_override=force_api_override)
        processed.append(job)
        connection.commit()
        if index < len(rows) and cst_job_called_external_api(job):
            time.sleep(rate_delay_seconds)
    return processed


@app.post("/cst/migration-jobs/review", response_model=CstMigrationReviewResponse)
def review_cst_migration_jobs(request: CstMigrationReviewRequest | None = None) -> CstMigrationReviewResponse:
    request = request or CstMigrationReviewRequest()
    request.resource_scope = normalize_cst_resource_scope(request.resource_scope)
    request.page = max(int(request.page or 1), 1)
    request.page_size = min(max(int(request.page_size or 25), 1), 500)
    with connect() as connection:
        if request.resource_scope == "assigned":
            return cst_assignment_review_response(connection, request)
        items = cst_migration_review_items(connection, request)
    total = len(items)
    valid_count = sum(1 for item in items if item.validation_status == "VALID")
    invalid_count = total - valid_count
    start = (request.page - 1) * request.page_size
    page_items = items[start:start + request.page_size]
    return CstMigrationReviewResponse(
        page=request.page,
        page_size=request.page_size,
        total=total,
        resource_scope=request.resource_scope,
        generated_at=now_iso(),
        items=page_items,
        all_matching_review_ids=[item.review_id for item in items],
        counts=CstMigrationReviewCounts(
            total_matching=total,
            included_default=total,
            excluded=0,
            selected=0,
            valid=valid_count,
            invalid=invalid_count,
        ),
    )


@app.post("/cst/migration-jobs/review/create", response_model=CstMigrationReviewCreateResult)
def create_cst_migration_job_from_review(request: CstMigrationReviewCreateRequest) -> CstMigrationReviewCreateResult:
    if not request.final_confirmed:
        raise HTTPException(status_code=400, detail="Final confirmation is required before creating the CST migration job")
    request.resource_scope = normalize_cst_resource_scope(request.resource_scope)
    included_ids = list(dict.fromkeys([item for item in request.included_review_ids if str(item or "").strip()]))
    excluded_ids = list(dict.fromkeys([item for item in request.excluded_review_ids if str(item or "").strip()]))
    if not included_ids:
        raise HTTPException(status_code=400, detail="At least one CST transaction must be included")

    created_at = now_iso()
    rejected: list[CstMigrationReviewRejectedItem] = []
    jobs: list[CstSyncJob] = []
    batch_id = ""
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        review_request = CstMigrationReviewRequest(
            page=1,
            page_size=500,
            resource_scope=request.resource_scope,
            include_existing_transactions=False,
            validation_status="all",
        )
        if request.resource_scope == "assigned":
            current_items = cst_assignment_review_items_for_ids(connection, included_ids)
        else:
            current_items = {item.review_id: item for item in cst_migration_review_items(connection, review_request)}
        operations: list[tuple[ResourceRecord, str]] = []
        for review_id in included_ids:
            operation, resource_uuid = parse_cst_review_id(review_id)
            item = current_items.get(review_id)
            if item is None:
                rejected.append(CstMigrationReviewRejectedItem(review_id=review_id, resource_uuid=resource_uuid, operation=operation, reason="No longer eligible or already assigned to another migration job"))
                continue
            resource_row = connection.execute("SELECT * FROM ip_resources WHERE resource_uuid = ?", (resource_uuid,)).fetchone()
            if resource_row is None:
                rejected.append(CstMigrationReviewRejectedItem(review_id=review_id, resource_uuid=resource_uuid, cidr=item.cidr, operation=operation, reason="Resource no longer exists"))
                continue
            resource = resource_from_row(resource_row)
            if cst_resource_has_existing_job(connection, resource_uuid):
                rejected.append(CstMigrationReviewRejectedItem(review_id=review_id, resource_uuid=resource_uuid, cidr=resource.cidr, operation=operation, reason="Already assigned to an active or completed CST migration job"))
                continue
            validation_payload = cst_payload_for_resource(resource, "SEND" if operation not in {"SEND", "UPDATE"} else operation, resource.transaction_id or resource_uuid, "migration-review-create")
            integrity_issues = cst_resource_integrity_issues(connection, resource)
            data_quality_warnings = cst_data_quality_issues(resource, operation, validation_payload)
            if integrity_issues:
                rejected.append(CstMigrationReviewRejectedItem(review_id=review_id, resource_uuid=resource_uuid, cidr=resource.cidr, operation=operation, reason="; ".join(integrity_issues)))
                continue
            if data_quality_warnings:
                record_audit(connection, "CST Migration Defaults Applied", "ip_resource", resource.resource_uuid, "", json.dumps({"reviewId": review_id, "cidr": resource.cidr, "operation": operation, "warnings": data_quality_warnings}))
            operations.append((resource, operation))
        if operations:
            jobs = create_cst_sync_jobs(connection, operations, "MANUAL_LIR_MIGRATION", queue_only=True)
            batch_id = jobs[0].batch_id if jobs else ""
        stats = cst_batch_job_stats(connection, batch_id) if batch_id else None
        record_audit(
            connection,
            "Manual CST Migration Job Created From Review",
            "cst_batch",
            batch_id,
            "",
            json.dumps({
                "createdBy": request.created_by,
                "includedReviewIds": included_ids,
                "excludedReviewIds": excluded_ids,
                "createdJobs": len(jobs),
                "rejected": [item.model_dump() for item in rejected],
                "resourceScope": request.resource_scope,
                "createdAt": created_at,
            }),
        )
        message = f"Migration job {batch_id} created with {len(jobs)} transaction(s)." if batch_id else "No CST migration job was created because all selected transactions were rejected."
        return CstMigrationReviewCreateResult(
            batch_id=batch_id,
            created_jobs=len(jobs),
            included_transactions=len(jobs),
            rejected_count=len(rejected),
            skipped_count=max(len(included_ids) - len(jobs) - len(rejected), 0),
            created_at=created_at,
            created_by=request.created_by or "admin",
            message=message,
            rejected=rejected,
            jobs=jobs,
        )

@app.post("/cst/migration-jobs/manual", response_model=CstManualMigrationResult)
def create_manual_cst_migration_job(payload: CstManualMigrationRequest | None = None) -> CstManualMigrationResult:
    payload = payload or CstManualMigrationRequest()
    payload.resource_scope = normalize_cst_resource_scope(payload.resource_scope)
    if payload.limit < 0:
        raise HTTPException(status_code=400, detail="limit must be zero or greater")
    if payload.execute_immediately and not CST_PENDING_PUSH_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another CST push is already running")
    lock_acquired = payload.execute_immediately
    try:
        with connect() as connection:
            operations, eligible_count, parent_delete_count = cst_migration_resource_operations(connection, payload)
            send_count = sum(1 for _resource, operation in operations if operation == "SEND")
            jobs = create_cst_sync_jobs(connection, operations, "MANUAL_LIR_MIGRATION", queue_only=True)
            batch_id = jobs[0].batch_id if jobs else ""
            processed_jobs: list[CstSyncJob] = []
            if payload.execute_immediately and batch_id:
                processed_jobs = process_cst_batch_pending_jobs(connection, batch_id, force_api_override=payload.force_api_override)
                jobs = [cst_job_from_row(row) for row in connection.execute(
                    "SELECT * FROM cst_sync_jobs WHERE batch_id = ? ORDER BY sequence_no, id",
                    (batch_id,),
                ).fetchall()]
            stats = cst_batch_job_stats(connection, batch_id) if batch_id else None
            message = (
                f"Manual CST migration job {batch_id} created with {len(jobs)} transaction job(s) for scope {payload.resource_scope}, including {parent_delete_count} parent delete job(s)."
                if batch_id else
                "No eligible CST resources found. Load public pools/assignments first, or check CST readiness and existing transaction filters."
            )
            record_audit(
                connection,
                "Manual CST Migration Job Created",
                "cst_batch",
                batch_id,
                "",
                json.dumps({
                    "createdJobs": len(jobs),
                    "processedJobs": len(processed_jobs),
                    "eligibleResources": eligible_count,
                    "parentDeleteJobs": parent_delete_count,
                    "resourceScope": payload.resource_scope,
                    "includeExistingTransactions": payload.include_existing_transactions,
                    "onlyCstReady": payload.only_cst_ready,
                    "executeImmediately": payload.execute_immediately,
                    "forceApiOverride": payload.force_api_override,
                }),
            )
            return CstManualMigrationResult(
                batch_id=batch_id,
                created_jobs=len(jobs),
                processed_jobs=len(processed_jobs),
                eligible_resources=eligible_count,
                skipped_resources=max(eligible_count - send_count, 0),
                message=message,
                stats=stats,
                jobs=jobs,
            )
    finally:
        if lock_acquired:
            CST_PENDING_PUSH_LOCK.release()


@app.get("/cst/migration-jobs/stats", response_model=list[CstMigrationJobStats])
def list_cst_migration_job_stats(limit: int = 50) -> list[CstMigrationJobStats]:
    if limit < 1:
        raise HTTPException(status_code=400, detail="limit must be greater than zero")
    with connect() as connection:
        rows = connection.execute(
            "SELECT id FROM cst_sync_batches WHERE workflow_type LIKE '%MIGRATION%' OR workflow_type = 'MANUAL_LIR_MIGRATION' ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [cst_batch_job_stats(connection, str(row["id"])) for row in rows]


@app.get("/cst/migration-jobs/{batch_id}/stats", response_model=CstMigrationJobStats)
def get_cst_migration_job_stats(batch_id: str) -> CstMigrationJobStats:
    with connect() as connection:
        return cst_batch_job_stats(connection, batch_id)

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
        jobs = create_cst_sync_jobs(connection, [(resource, "SEND") for resource in resources], "INITIAL_LIR_MIGRATION", queue_only=True)
        record_audit(connection, "CST Initial Migration Jobs Created", "cst_batch", jobs[0].batch_id if jobs else "", "", json.dumps({"jobs": len(jobs)}))
    return jobs


@app.post("/cst/reconcile", response_model=list[CstSyncJob])
def reconcile_cst_resources() -> list[CstSyncJob]:
    with connect() as connection:
        config = ensure_cst_config(connection)
        page_resource = cst_get_lir_page_resource(config, 1)
        jobs = create_cst_sync_jobs(connection, [(page_resource, "GET")], "CST_RECONCILIATION_GETLIR_PAGE")
        record_audit(connection, "CST GetLIR Page Job Created", "cst_batch", jobs[0].batch_id if jobs else "", "", json.dumps({"jobs": len(jobs), "pageNumber": 1, "pageSize": 1000}))
    return jobs



def push_pending_cst_jobs_with_options(limit: int = 0, force_api_override: bool = False, resource_scope: str = "all") -> CstPendingPushResult:
    resource_scope = normalize_cst_resource_scope(resource_scope)
    if limit < 0:
        raise HTTPException(status_code=400, detail="limit must be zero or greater")
    if not CST_PENDING_PUSH_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another CST push is already running")
    started_at = now_iso()
    processed_jobs: list[CstSyncJob] = []
    requested_jobs = 0
    effective_limit = 0
    batch_size_limit = 0
    hourly_request_limit = 0
    rate_delay_seconds = 0.0
    send_payload_batch_size = 1
    try:
        with connect() as connection:
            config = ensure_cst_config(connection)
            batch_size_limit = max(int(config.batch_size_limit or 500), 1)
            hourly_request_limit = max(int(config.hourly_request_limit or 1000), 1)
            send_payload_batch_size = cst_send_payload_batch_size(config)
            effective_limit = cst_effective_pending_push_limit(config, limit)
            rate_delay_seconds = cst_rate_limit_delay_seconds(config)
            scope_filter = ""
            if resource_scope == "assigned":
                scope_filter = "AND (j.operation = 'DELETE' OR r.assignment_status_id IN (2, 3, 4))"
            elif resource_scope == "unassigned":
                scope_filter = "AND (j.operation = 'DELETE' OR r.assignment_status_id = 1)"
            rows = connection.execute(
                f"""
                SELECT j.*
                FROM cst_sync_jobs j
                LEFT JOIN ip_resources r ON r.resource_uuid = j.resource_uuid
                WHERE j.status = 'PENDING'
                  {scope_filter}
                ORDER BY j.created_at, j.sequence_no, j.id
                LIMIT ?
                """,
                (effective_limit,),
            ).fetchall()
            requested_jobs = len(rows)
            index = 0
            while index < len(rows):
                row = rows[index]
                job = cst_job_from_row(row)
                if job.operation == "SEND" and send_payload_batch_size > 1:
                    send_rows: list[sqlite3.Row] = []
                    provider_id = ""
                    while index < len(rows) and len(send_rows) < send_payload_batch_size:
                        candidate = cst_job_from_row(rows[index])
                        if candidate.operation != "SEND":
                            break
                        resource_row = connection.execute("SELECT service_provider_id FROM ip_resources WHERE resource_uuid = ?", (candidate.resource_uuid,)).fetchone()
                        candidate_provider_id = str(resource_row["service_provider_id"] or DEFAULT_SERVICE_PROVIDER_ID) if resource_row else str(candidate.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID)
                        if provider_id and candidate_provider_id != provider_id:
                            break
                        provider_id = candidate_provider_id
                        send_rows.append(rows[index])
                        index += 1
                    if len(send_rows) > 1:
                        running_rows = [mark_cst_job_running(connection, send_row) for send_row in send_rows]
                        connection.commit()
                        jobs = retry_cst_jobs(connection, running_rows, force_api_override=force_api_override)
                        processed_jobs.extend(jobs)
                        connection.commit()
                        if index < len(rows) and any(cst_job_called_external_api(item) for item in jobs):
                            time.sleep(rate_delay_seconds)
                        continue
                    if send_rows:
                        row = send_rows[0]
                else:
                    index += 1
                job = process_cst_job_sequentially(connection, row, force_api_override=force_api_override)
                processed_jobs.append(job)
                connection.commit()
                if index < len(rows) and cst_job_called_external_api(job):
                    time.sleep(rate_delay_seconds)
    finally:
        CST_PENDING_PUSH_LOCK.release()
    completed_at = now_iso()
    success_jobs = sum(1 for job in processed_jobs if job.status == "SUCCESS")
    failed_jobs = sum(1 for job in processed_jobs if job.status == "FAILED")
    pending_jobs = sum(1 for job in processed_jobs if job.status == "PENDING")
    not_required_jobs = sum(1 for job in processed_jobs if job.status == "NOT_REQUIRED")
    mode = "Force API override processed" if force_api_override else "Processed"
    return CstPendingPushResult(
        started_at=started_at,
        completed_at=completed_at,
        requested_jobs=requested_jobs,
        processed_jobs=len(processed_jobs),
        success_jobs=success_jobs,
        failed_jobs=failed_jobs,
        pending_jobs=pending_jobs,
        not_required_jobs=not_required_jobs,
        message=f"{mode} {len(processed_jobs)} pending CST job(s) sequentially for scope {resource_scope}. Job limit: {batch_size_limit}. SendLIR records per API call: {send_payload_batch_size}. Hourly limit: {hourly_request_limit}.",
        effective_limit=effective_limit,
        batch_size_limit=batch_size_limit,
        send_payload_batch_size=send_payload_batch_size,
        hourly_request_limit=hourly_request_limit,
        rate_delay_seconds=rate_delay_seconds,
        force_api_override=force_api_override,
        resource_scope=resource_scope,
        jobs=processed_jobs,
    )


@app.post("/cst/jobs/push-pending", response_model=CstPendingPushResult)
def push_pending_cst_jobs(limit: int = 0, resource_scope: str = "all") -> CstPendingPushResult:
    return push_pending_cst_jobs_with_options(limit=limit, force_api_override=False, resource_scope=resource_scope)


@app.post("/cst/jobs/push-pending/force", response_model=CstPendingPushResult)
def force_push_pending_cst_jobs(limit: int = 0, resource_scope: str = "all") -> CstPendingPushResult:
    return push_pending_cst_jobs_with_options(limit=limit, force_api_override=True, resource_scope=resource_scope)


@app.post("/cst/jobs/{job_id}/retry", response_model=CstSyncJob)
def retry_cst_job(job_id: str) -> CstSyncJob:
    if not CST_PENDING_PUSH_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another CST push is already running")
    try:
        with connect() as connection:
            row = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="CST job not found")
            return process_cst_job_sequentially(connection, row)
    finally:
        CST_PENDING_PUSH_LOCK.release()


@app.post("/cst/batches/{batch_id}/retry-failed", response_model=list[CstSyncJob])
def retry_failed_cst_batch(batch_id: str) -> list[CstSyncJob]:
    if not CST_PENDING_PUSH_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another CST push is already running")
    try:
        with connect() as connection:
            rows = connection.execute(
                "SELECT * FROM cst_sync_jobs WHERE batch_id = ? AND status IN ('FAILED', 'BLOCKED', 'PENDING', 'RUNNING') ORDER BY sequence_no",
                (batch_id,),
            ).fetchall()
            if not rows:
                return []
            now = now_iso()
            connection.execute(
                """
                UPDATE cst_sync_jobs
                SET status = 'PENDING', last_error = '', updated_at = ?
                WHERE batch_id = ? AND status IN ('FAILED', 'BLOCKED', 'RUNNING')
                """,
                (now, batch_id),
            )
            connection.execute(
                """
                UPDATE cst_transaction_ledger
                SET last_status = 'PENDING'
                WHERE batch_id = ? AND last_status IN ('FAILED', 'BLOCKED', 'RUNNING')
                """,
                (batch_id,),
            )
            connection.execute(
                """
                UPDATE cst_sync_batches
                SET status = 'PENDING', failed_jobs = 0, blocked_jobs = 0, completed_at = ''
                WHERE id = ?
                """,
                (batch_id,),
            )
            connection.commit()
            return process_cst_batch_pending_jobs(connection, batch_id)
    finally:
        CST_PENDING_PUSH_LOCK.release()

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
    validate_private_pool_registration(network)
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


def process_pool_bulk(csv_text: object) -> BulkImportResult:
    imported = 0
    errors: list[str] = []
    output_rows: list[BulkOutputRow] = []
    for index, row in enumerate(csv_rows(csv_text), start=2):
        try:
            networks, name, region = pool_networks_from_bulk_row(row)
            for network in networks:
                validate_private_pool_registration(network)
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
        customer_type="NA",
        subnet_type="NA",
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



def partial_fragment_from_row(row: sqlite3.Row) -> PartialReassignmentFragment:
    return PartialReassignmentFragment(
        id=str(row["id"]),
        operation_id=str(row["operation_id"]),
        kind=str(row["kind"]),
        cidr=str(row["cidr"]),
        cst_operation=str(row["cst_operation"]),
        transaction_id=str(row["transaction_id"]),
        resource_uuid=str(row["resource_uuid"]),
        cst_job_id=str(row["cst_job_id"]),
        status=str(row["status"]),
        last_error=str(row["last_error"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def partial_result_from_db(connection: sqlite3.Connection, operation_id: str, jobs: list[CstSyncJob] | None = None) -> PartialReassignmentResult:
    op = connection.execute("SELECT * FROM partial_reassignment_operations WHERE id = ?", (operation_id,)).fetchone()
    if op is None:
        raise HTTPException(status_code=404, detail="Partial reassignment operation not found")
    fragments = [partial_fragment_from_row(row) for row in connection.execute(
        "SELECT * FROM partial_reassignment_fragments WHERE operation_id = ? ORDER BY created_at, id",
        (operation_id,),
    ).fetchall()]
    if jobs is None:
        job_ids = [fragment.cst_job_id for fragment in fragments if fragment.cst_job_id]
        jobs = []
        if job_ids:
            placeholders = ",".join("?" for _ in job_ids)
            jobs = [cst_job_from_row(row) for row in connection.execute(
                f"SELECT * FROM cst_sync_jobs WHERE id IN ({placeholders}) ORDER BY created_at, sequence_no",
                job_ids,
            ).fetchall()]
    return PartialReassignmentResult(
        id=str(op["id"]),
        original_assignment_id=str(op["original_assignment_id"]),
        original_cidr=str(op["original_cidr"]),
        requested_cidr=str(op["requested_cidr"]),
        status=str(op["status"]),
        original_transaction_id=str(op["original_transaction_id"]),
        assigned_transaction_id=str(op["assigned_transaction_id"]),
        message=str(op["message"]),
        created_at=str(op["created_at"]),
        updated_at=str(op["updated_at"]),
        completed_at=str(op["completed_at"]),
        fragments=fragments,
        jobs=jobs,
    )


def cst_active_transaction_for_resource(connection: sqlite3.Connection, resource: ResourceRecord) -> str:
    row = connection.execute(
        """
        SELECT transaction_id
        FROM cst_transaction_ledger
        WHERE (resource_uuid = ? OR cidr = ?)
          AND retired_at = ''
          AND last_status = 'SUCCESS'
        ORDER BY CASE WHEN resource_uuid = ? THEN 0 ELSE 1 END, first_used_at DESC
        LIMIT 1
        """,
        (resource.resource_uuid, resource.cidr, resource.resource_uuid),
    ).fetchone()
    if row:
        return str(row["transaction_id"])
    if str(resource.cst_sync_status or "").upper() in {"SUCCESS", "SYNCHRONIZED"} and str(resource.transaction_id or "").strip():
        return str(resource.transaction_id).strip()
    raise HTTPException(status_code=409, detail=f"Original CST LIR transaction is missing for {resource.cidr}")


def partial_resource_from_network(original_resource: ResourceRecord, network: IPv4Network, operation_id: str, kind: str) -> ResourceRecord:
    fragment = cst_resource_from_network(
        network,
        stable_uuid("partial-reassignment-fragment", operation_id, kind, str(network)),
        "partial_reassignment",
        f"{operation_id}:{kind}:{network}",
        f"Partial reassignment {operation_id} {kind} fragment {network}",
    )
    return fragment.model_copy(update={
        "ip_type": original_resource.ip_type,
        "service_provider_id": original_resource.service_provider_id or DEFAULT_SERVICE_PROVIDER_ID,
        "service_provider_name": original_resource.service_provider_name or DEFAULT_SERVICE_PROVIDER_NAME,
        "asn": original_resource.asn or DEFAULT_ASN,
        "root_pool_uuid": original_resource.root_pool_uuid,
        "parent_resource_uuid": original_resource.parent_resource_uuid,
        "parent_version_uuid": original_resource.parent_version_uuid,
    })


def partial_fragment_success_for_resource(connection: sqlite3.Connection, operation_id: str, kind: str, resource_uuid: str) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM partial_reassignment_fragments
        WHERE operation_id = ?
          AND kind = ?
          AND resource_uuid = ?
          AND status = 'SUCCESS'
        LIMIT 1
        """,
        (operation_id, kind, resource_uuid),
    ).fetchone()
    return row is not None


def partial_non_success_fragments_for_resource(connection: sqlite3.Connection, operation_id: str, kind: str, resource_uuid: str) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT *
        FROM partial_reassignment_fragments
        WHERE operation_id = ?
          AND kind = ?
          AND resource_uuid = ?
          AND status != 'SUCCESS'
        ORDER BY created_at, id
        """,
        (operation_id, kind, resource_uuid),
    ).fetchall()


def partial_reassignment_mode(original_network: IPv4Network, requested_network: IPv4Network, affected_resources: list[ResourceRecord]) -> str:
    if requested_network.subnet_of(original_network):
        return "SHRINK"
    return "EXPAND_REPLACE" if affected_resources else "EXPAND_APPEND"


def adjacent_expansion_fragments(original_network: IPv4Network, requested_network: IPv4Network) -> list[IPv4Network]:
    if not original_network.subnet_of(requested_network):
        return []
    fragments = network_difference(requested_network, original_network)
    if not fragments:
        return []
    original_start = int(original_network.network_address)
    original_end = int(original_network.broadcast_address)
    for fragment in fragments:
        fragment_start = int(fragment.network_address)
        fragment_end = int(fragment.broadcast_address)
        if fragment_end + 1 == original_start or fragment_start == original_end + 1:
            continue
        raise HTTPException(status_code=409, detail=f"Expansion range {fragment} is not adjacent to original assignment {original_network}")
    return fragments


def partial_assigned_networks_for_mode(original_network: IPv4Network, requested_network: IPv4Network, mode: str) -> list[IPv4Network]:
    if mode == "EXPAND_APPEND":
        return adjacent_expansion_fragments(original_network, requested_network)
    return [requested_network]


def partial_find_cst_affected_resources(
    connection: sqlite3.Connection,
    original_resource: ResourceRecord,
    original_network: IPv4Network,
    requested_network: IPv4Network,
) -> list[ResourceRecord]:
    expansion_networks = network_difference(requested_network, original_network)
    if not expansion_networks:
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM ip_resources
        WHERE ip_type = 'PUBLIC'
          AND status != 'RETIRED'
          AND resource_uuid != ?
        ORDER BY prefix ASC, start_ip ASC
        """,
        (original_resource.resource_uuid,),
    ).fetchall()
    resources: list[ResourceRecord] = []
    seen: set[str] = set()
    for row in rows:
        resource = resource_from_row(row)
        if resource.resource_uuid in seen or not cst_resource_reported_to_cst(connection, resource):
            continue
        if normalize_assignment_status_id(resource.assignment_status_id, None) != 1:
            continue
        resource_network = normalize_network(resource.cidr)
        if any(resource_network.overlaps(fragment) for fragment in expansion_networks):
            resources.append(resource)
            seen.add(resource.resource_uuid)
    return resources


def partial_cst_unassigned_delete_resources(
    connection: sqlite3.Connection,
    original_resource: ResourceRecord,
    original_network: IPv4Network,
    requested_network: IPv4Network,
) -> list[ResourceRecord]:
    expansion_networks = network_difference(requested_network, original_network)
    if not expansion_networks:
        return []
    rows = connection.execute(
        """
        SELECT *
        FROM ip_resources
        WHERE ip_type = 'PUBLIC'
          AND status != 'RETIRED'
          AND resource_uuid != ?
          AND source_entity_type != 'assignment'
        ORDER BY prefix ASC, start_ip ASC
        """,
        (original_resource.resource_uuid,),
    ).fetchall()
    resources: list[ResourceRecord] = []
    seen: set[str] = set()
    for row in rows:
        resource = resource_from_row(row)
        if resource.resource_uuid in seen:
            continue
        if normalize_assignment_status_id(resource.assignment_status_id, None) != 1:
            continue
        if not cst_resource_reported_to_cst(connection, resource):
            continue
        resource_network = normalize_network(resource.cidr)
        if any(resource_network.overlaps(fragment) for fragment in expansion_networks):
            resources.append(resource)
            seen.add(resource.resource_uuid)
    return resources


def partial_unassigned_networks_after_reassignment(
    original_network: IPv4Network,
    requested_network: IPv4Network,
    deleted_unassigned_resources: list[ResourceRecord],
) -> list[IPv4Network]:
    fragments = network_difference(original_network, requested_network)
    for resource in deleted_unassigned_resources:
        fragments.extend(network_difference(normalize_network(resource.cidr), requested_network))
    return normalize_network_list(fragments)


def validate_partial_reassignment_scope(
    connection: sqlite3.Connection,
    original_assignment: Assignment,
    original_network: IPv4Network,
    requested_network: IPv4Network,
) -> None:
    if requested_network == original_network:
        raise HTTPException(status_code=400, detail="Partial reassignment requires a different CIDR than the current assignment")
    is_shrink = requested_network.subnet_of(original_network)
    is_expansion = original_network.subnet_of(requested_network)
    if not (is_shrink or is_expansion):
        raise HTTPException(
            status_code=409,
            detail=f"{requested_network} must either shrink within or expand around original assignment {original_assignment.cidr}",
        )
    if is_expansion:
        adjacent_expansion_fragments(original_network, requested_network)
    parent = root_pool_for_network(original_network, connection)
    if parent is None:
        raise HTTPException(status_code=409, detail=f"Original assignment {original_assignment.cidr} is outside managed parent pools")
    parent_network = network_of(parent)
    if not requested_network.subnet_of(parent_network):
        raise HTTPException(status_code=409, detail=f"{requested_network} is outside managed parent pool {parent.cidr}")
    overlaps = assignment_overlap_candidates(requested_network, {original_assignment.id})
    if overlaps:
        raise HTTPException(status_code=409, detail=assignment_conflict_message(requested_network, overlaps))


def upsert_successful_partial_unassigned_fragments(
    connection: sqlite3.Connection,
    operation_id: str,
    original_resource: ResourceRecord,
) -> list[ResourceRecord]:
    rows = connection.execute(
        """
        SELECT *
        FROM partial_reassignment_fragments
        WHERE operation_id = ?
          AND kind = 'UNASSIGNED'
          AND status = 'SUCCESS'
        ORDER BY cidr
        """,
        (operation_id,),
    ).fetchall()
    resources: list[ResourceRecord] = []
    for row in rows:
        fragment_network = normalize_network(str(row["cidr"]))
        resource = partial_resource_from_network(original_resource, fragment_network, operation_id, "UNASSIGNED").model_copy(update={
            "resource_uuid": str(row["resource_uuid"]),
            "transaction_id": str(row["transaction_id"]),
            "cst_sync_status": "SUCCESS",
            "action_flag": "S",
            "cst_sync_ready": True,
            "cst_validation_status": "READY",
        })
        upsert_resource_record(connection, resource)
        resources.append(resource)
    return resources


def delete_replaced_partial_unassigned_resources(connection: sqlite3.Connection, resources: list[ResourceRecord]) -> None:
    for resource in resources:
        connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (resource.resource_uuid,))
        connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (resource.resource_uuid,))


def record_partial_fragment_job(connection: sqlite3.Connection, operation_id: str, kind: str, resource: ResourceRecord, cst_operation: str, job: CstSyncJob) -> None:
    timestamp = now_iso()
    connection.execute(
        """
        INSERT INTO partial_reassignment_fragments (
          id, operation_id, kind, cidr, cst_operation, transaction_id, resource_uuid,
          cst_job_id, status, payload_json, response_json, last_error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"partial-fragment-{uuid4().hex[:12]}", operation_id, kind, resource.cidr, cst_operation,
            job.transaction_id, resource.resource_uuid, job.id, job.status, job.payload_json,
            job.response_json, job.last_error, timestamp, timestamp,
        ),
    )


def update_partial_fragment_from_job(connection: sqlite3.Connection, fragment_id: str, job: CstSyncJob) -> None:
    connection.execute(
        """
        UPDATE partial_reassignment_fragments
        SET status = ?, payload_json = ?, response_json = ?, last_error = ?, updated_at = ?
        WHERE id = ?
        """,
        (job.status, job.payload_json, job.response_json, job.last_error, now_iso(), fragment_id),
    )


def create_partial_cst_job(connection: sqlite3.Connection, operation_id: str, kind: str, resource: ResourceRecord, cst_operation: str) -> CstSyncJob:
    jobs = create_cst_sync_jobs(connection, [(resource, cst_operation)], f"PARTIAL_REASSIGNMENT:{operation_id}")
    if not jobs:
        raise HTTPException(status_code=409, detail=f"No CST job was created for {kind} {resource.cidr}")
    job = jobs[0]
    record_partial_fragment_job(connection, operation_id, kind, resource, cst_operation, job)
    return job


def retry_partial_fragment_job(connection: sqlite3.Connection, row: sqlite3.Row) -> CstSyncJob:
    job_row = connection.execute("SELECT * FROM cst_sync_jobs WHERE id = ?", (row["cst_job_id"],)).fetchone()
    if job_row is None:
        raise HTTPException(status_code=404, detail=f"CST job {row['cst_job_id']} not found for partial reassignment fragment")
    job = retry_cst_jobs(connection, [job_row])[0]
    update_partial_fragment_from_job(connection, str(row["id"]), job)
    return job


def partial_fragment_success(connection: sqlite3.Connection, operation_id: str, kind: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM partial_reassignment_fragments WHERE operation_id = ? AND kind = ? AND status = 'SUCCESS' LIMIT 1",
        (operation_id, kind),
    ).fetchone()
    return row is not None


def partial_non_success_fragments(connection: sqlite3.Connection, operation_id: str, kinds: set[str] | None = None) -> list[sqlite3.Row]:
    if kinds:
        placeholders = ",".join("?" for _ in kinds)
        return connection.execute(
            f"SELECT * FROM partial_reassignment_fragments WHERE operation_id = ? AND kind IN ({placeholders}) AND status != 'SUCCESS' ORDER BY created_at, id",
            (operation_id, *sorted(kinds)),
        ).fetchall()
    return connection.execute(
        "SELECT * FROM partial_reassignment_fragments WHERE operation_id = ? AND status != 'SUCCESS' ORDER BY created_at, id",
        (operation_id,),
    ).fetchall()


def set_partial_operation_status(connection: sqlite3.Connection, operation_id: str, status: str, message: str = "", completed: bool = False) -> None:
    connection.execute(
        """
        UPDATE partial_reassignment_operations
        SET status = ?, message = ?, updated_at = ?, completed_at = CASE WHEN ? THEN ? ELSE completed_at END
        WHERE id = ?
        """,
        (status, message, now_iso(), 1 if completed else 0, now_iso(), operation_id),
    )


def partial_assignment_payload(operation_row: sqlite3.Row) -> AssignmentCreate:
    return AssignmentCreate.model_validate(json.loads(str(operation_row["assigned_payload_json"] or "{}")))


def upsert_partial_unassigned_fragments_from_jobs(
    connection: sqlite3.Connection,
    operation_id: str,
    original_resource: ResourceRecord,
) -> list[ResourceRecord]:
    rows = connection.execute(
        """
        SELECT *
        FROM partial_reassignment_fragments
        WHERE operation_id = ?
          AND kind = 'UNASSIGNED'
        ORDER BY cidr
        """,
        (operation_id,),
    ).fetchall()
    resources: list[ResourceRecord] = []
    for row in rows:
        fragment_network = normalize_network(str(row["cidr"]))
        status = str(row["status"] or "PENDING")
        resource = partial_resource_from_network(original_resource, fragment_network, operation_id, "UNASSIGNED").model_copy(update={
            "resource_uuid": str(row["resource_uuid"]),
            "transaction_id": str(row["transaction_id"]),
            "cst_sync_status": status,
            "action_flag": "S" if status == "SUCCESS" else "U",
            "cst_sync_ready": True,
            "cst_validation_status": "READY",
        })
        upsert_resource_record(connection, resource)
        resources.append(resource)
    return resources


def complete_partial_reassignment_locally(
    connection: sqlite3.Connection,
    operation_id: str,
    original_assignment: Assignment,
    original_resource: ResourceRecord,
    requested_network: IPv4Network,
    assigned_transaction_id: str,
    replaced_unassigned_resources: list[ResourceRecord],
    local_cst_sync_status: str = "PENDING",
    rebind_cst_transaction: bool = True,
) -> Assignment:
    op = connection.execute("SELECT * FROM partial_reassignment_operations WHERE id = ?", (operation_id,)).fetchone()
    if op is None:
        raise HTTPException(status_code=404, detail="Partial reassignment operation not found")
    payload = partial_assignment_payload(op)
    payload.logical_resource_id = assigned_transaction_id
    payload.cst_sync_status = local_cst_sync_status if resource_requires_cst(original_resource) else "NOT_REQUIRED"
    payload.action_flag = "S"
    assignment = assignment_from_network(requested_network, payload)
    insert_assignment(connection, assignment)
    resource = sync_assignment_resource(connection, assignment)
    if rebind_cst_transaction:
        connection.execute(
            """
            UPDATE cst_transaction_ledger
            SET resource_uuid = ?, cidr = ?
            WHERE transaction_id = ?
            """,
            (resource.resource_uuid, resource.cidr, assigned_transaction_id),
        )
        connection.execute(
            """
            UPDATE cst_sync_jobs
            SET resource_uuid = ?, cidr = ?
            WHERE transaction_id = ?
            """,
            (resource.resource_uuid, resource.cidr, assigned_transaction_id),
        )
        connection.execute(
            """
            UPDATE partial_reassignment_fragments
            SET resource_uuid = ?, updated_at = ?
            WHERE operation_id = ? AND kind = 'ASSIGNED'
            """,
            (resource.resource_uuid, now_iso(), operation_id),
        )
    unassigned_resources = upsert_partial_unassigned_fragments_from_jobs(connection, operation_id, original_resource)
    connection.execute("DELETE FROM assignments WHERE id = ?", (original_assignment.id,))
    connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (original_resource.resource_uuid,))
    connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (original_resource.resource_uuid,))
    delete_replaced_partial_unassigned_resources(connection, replaced_unassigned_resources)
    materialize_bulk_unassigned_fragments(connection)
    completion_message = "Partial reassignment completed after required CST transactions succeeded" if local_cst_sync_status == "SUCCESS" else "Local partial reassignment completed; CST synchronization was not required"
    set_partial_operation_status(
        connection,
        operation_id,
        "COMPLETED",
        completion_message,
        completed=True,
    )
    record_audit(
        connection,
        "Partial LIR Reassignment Completed",
        "partial_reassignment",
        operation_id,
        original_assignment.model_dump_json(),
        json.dumps({
            "newAssignmentId": assignment.id,
            "resourceUuid": resource.resource_uuid,
            "requestedCidr": assignment.cidr,
            "assignedTransactionId": assigned_transaction_id,
            "unassignedFragments": [item.cidr for item in unassigned_resources],
            "deletedExpansionResources": [item.cidr for item in replaced_unassigned_resources],
        }),
    )
    return assignment


def finalize_partial_reassignment(connection: sqlite3.Connection, operation_id: str) -> None:
    op = connection.execute("SELECT * FROM partial_reassignment_operations WHERE id = ?", (operation_id,)).fetchone()
    if op is None:
        raise HTTPException(status_code=404, detail="Partial reassignment operation not found")
    if str(op["status"] or "") == "COMPLETED":
        return
    original = connection.execute("SELECT * FROM assignments WHERE id = ?", (op["original_assignment_id"],)).fetchone()
    if original is None:
        set_partial_operation_status(connection, operation_id, "LOCAL_CONFLICT", "Original assignment is missing; manual reconciliation is required")
        return
    original_assignment = assignment_from_row(original)
    requested_network = normalize_network(str(op["requested_cidr"]))
    original_network = normalize_network(str(op["original_cidr"]))
    try:
        validate_partial_reassignment_scope(connection, original_assignment, original_network, requested_network)
    except HTTPException as exc:
        set_partial_operation_status(connection, operation_id, "LOCAL_CONFLICT", str(exc.detail))
        return
    assigned_fragment = connection.execute(
        "SELECT transaction_id FROM partial_reassignment_fragments WHERE operation_id = ? AND kind = 'ASSIGNED' AND status = 'SUCCESS' LIMIT 1",
        (operation_id,),
    ).fetchone()
    if assigned_fragment is None:
        set_partial_operation_status(connection, operation_id, "PARTIAL", "Assigned fragment has not been reported successfully to CST")
        return
    payload = partial_assignment_payload(op)
    payload.logical_resource_id = str(assigned_fragment["transaction_id"])
    payload.cst_sync_status = "SUCCESS"
    payload.action_flag = "S"
    assignment = assignment_from_network(requested_network, payload)
    insert_assignment(connection, assignment)
    resource = sync_assignment_resource(connection, assignment)
    connection.execute(
        """
        UPDATE cst_transaction_ledger
        SET resource_uuid = ?, cidr = ?
        WHERE transaction_id = ?
        """,
        (resource.resource_uuid, resource.cidr, payload.logical_resource_id),
    )
    connection.execute(
        """
        UPDATE cst_sync_jobs
        SET resource_uuid = ?, cidr = ?
        WHERE transaction_id = ?
        """,
        (resource.resource_uuid, resource.cidr, payload.logical_resource_id),
    )
    connection.execute(
        """
        UPDATE partial_reassignment_fragments
        SET resource_uuid = ?, updated_at = ?
        WHERE operation_id = ? AND kind = 'ASSIGNED'
        """,
        (resource.resource_uuid, now_iso(), operation_id),
    )
    original_resource = find_resource_by_source(connection, "assignment", original_assignment.id)
    unassigned_resources: list[ResourceRecord] = []
    replaced_unassigned_resources: list[ResourceRecord] = []
    if original_resource:
        replaced_unassigned_resources = partial_cst_unassigned_delete_resources(connection, original_resource, original_network, requested_network)
        unassigned_resources = upsert_successful_partial_unassigned_fragments(connection, operation_id, original_resource)
    connection.execute("DELETE FROM assignments WHERE id = ?", (original_assignment.id,))
    if original_resource:
        connection.execute("DELETE FROM assignment_details WHERE resource_uuid = ?", (original_resource.resource_uuid,))
        connection.execute("DELETE FROM ip_resources WHERE resource_uuid = ?", (original_resource.resource_uuid,))
    delete_replaced_partial_unassigned_resources(connection, replaced_unassigned_resources)
    materialize_bulk_unassigned_fragments(connection)
    set_partial_operation_status(connection, operation_id, "COMPLETED", "Partial reassignment completed and local records updated", completed=True)
    record_audit(
        connection,
        "Partial LIR Reassignment Completed",
        "partial_reassignment",
        operation_id,
        original_assignment.model_dump_json(),
        json.dumps({
            "newAssignmentId": assignment.id,
            "resourceUuid": resource.resource_uuid,
            "requestedCidr": assignment.cidr,
            "unassignedFragments": [item.cidr for item in unassigned_resources],
            "deletedExpansionResources": [item.cidr for item in replaced_unassigned_resources],
        }),
    )


def partial_assigned_resource_for_network(
    connection: sqlite3.Connection,
    operation_id: str,
    network: IPv4Network,
    payload: AssignmentCreate,
    original_resource: ResourceRecord,
    transaction_id: str = "",
) -> ResourceRecord:
    assignment_payload = payload.model_copy(update={
        "cidr": str(network),
        "logical_resource_id": transaction_id or str(uuid4()),
        "cst_sync_status": "PENDING",
        "action_flag": "S",
    })
    assignment = assignment_from_network(network, assignment_payload)
    return resource_record_for_assignment(assignment, connection=connection).model_copy(update={
        "transaction_id": assignment_payload.logical_resource_id,
        "ip_type": original_resource.ip_type,
        "root_pool_uuid": original_resource.root_pool_uuid,
        "parent_resource_uuid": original_resource.parent_resource_uuid,
        "parent_version_uuid": original_resource.parent_version_uuid,
    })


def partial_ensure_fragment_job(
    connection: sqlite3.Connection,
    operation_id: str,
    kind: str,
    resource: ResourceRecord,
    cst_operation: str,
) -> list[CstSyncJob]:
    row = connection.execute(
        """
        SELECT *
        FROM partial_reassignment_fragments
        WHERE operation_id = ?
          AND kind = ?
          AND cidr = ?
          AND cst_operation = ?
          AND resource_uuid = ?
        ORDER BY created_at, id
        LIMIT 1
        """,
        (operation_id, kind, resource.cidr, cst_operation, resource.resource_uuid),
    ).fetchone()
    if row is None:
        return [create_partial_cst_job(connection, operation_id, kind, resource, cst_operation)]
    if str(row["status"] or "") == "SUCCESS":
        return []
    return [retry_partial_fragment_job(connection, row)]


def continue_partial_reassignment(connection: sqlite3.Connection, operation_id: str) -> PartialReassignmentResult:
    op = connection.execute("SELECT * FROM partial_reassignment_operations WHERE id = ?", (operation_id,)).fetchone()
    if op is None:
        raise HTTPException(status_code=404, detail="Partial reassignment operation not found")
    if str(op["status"] or "") == "COMPLETED":
        return partial_result_from_db(connection, operation_id)

    jobs: list[CstSyncJob] = []
    original_row = connection.execute("SELECT * FROM assignments WHERE id = ?", (op["original_assignment_id"],)).fetchone()
    if original_row is None:
        set_partial_operation_status(connection, operation_id, "LOCAL_CONFLICT", "Original assignment is missing; manual reconciliation is required")
        return partial_result_from_db(connection, operation_id, jobs)
    original_assignment = assignment_from_row(original_row)
    original_resource = find_resource_by_source(connection, "assignment", original_assignment.id)
    if original_resource is None:
        set_partial_operation_status(connection, operation_id, "LOCAL_CONFLICT", "Original assignment resource is missing; manual reconciliation is required")
        return partial_result_from_db(connection, operation_id, jobs)

    original_network = normalize_network(str(op["original_cidr"]))
    requested_network = normalize_network(str(op["requested_cidr"]))
    try:
        validate_partial_reassignment_scope(connection, original_assignment, original_network, requested_network)
    except HTTPException as exc:
        set_partial_operation_status(connection, operation_id, "LOCAL_CONFLICT", str(exc.detail))
        return partial_result_from_db(connection, operation_id, jobs)

    payload = partial_assignment_payload(op)
    affected_resources = partial_find_cst_affected_resources(connection, original_resource, original_network, requested_network)
    mode = partial_reassignment_mode(original_network, requested_network, affected_resources)
    original_reported_to_cst = cst_resource_reported_to_cst(connection, original_resource)
    cst_required = original_resource.ip_type == "PUBLIC" and (original_reported_to_cst or bool(affected_resources))

    if not cst_required:
        assigned_transaction_id = str(op["assigned_transaction_id"] or "") or str(uuid4())
        connection.execute("UPDATE partial_reassignment_operations SET assigned_transaction_id = ? WHERE id = ?", (assigned_transaction_id, operation_id))
        complete_partial_reassignment_locally(
            connection,
            operation_id,
            original_assignment,
            original_resource,
            requested_network,
            assigned_transaction_id,
            [],
            "NOT_REQUIRED",
        )
        return partial_result_from_db(connection, operation_id, jobs)

    if mode == "SHRINK" and original_reported_to_cst:
        jobs.extend(partial_ensure_fragment_job(connection, operation_id, "ORIGINAL_UPDATE_UNASSIGNED", cst_unassigned_update_resource(original_resource), "UPDATE"))
        if not partial_fragment_success(connection, operation_id, "ORIGINAL_UPDATE_UNASSIGNED"):
            failed_job = next((job for job in jobs if job.operation == "UPDATE" and job.status != "SUCCESS"), None)
            detail = failed_job.last_error if failed_job and failed_job.last_error else "CST UpdateLIRData to Unassigned did not complete successfully"
            set_partial_operation_status(
                connection,
                operation_id,
                "FAILED",
                f"CST UpdateLIRData to Unassigned failed; DeleteLIRData was not sent and local partial reassignment was not completed. {detail}",
            )
            return partial_result_from_db(connection, operation_id, jobs)

    delete_resources: list[tuple[str, ResourceRecord]] = []
    if mode == "SHRINK" and original_reported_to_cst:
        delete_resources.append(("ORIGINAL_DELETE", original_resource))
    elif mode == "EXPAND_REPLACE":
        delete_resources.extend(("EXPANSION_DELETE", resource) for resource in affected_resources)

    for kind, resource in delete_resources:
        jobs.extend(partial_ensure_fragment_job(connection, operation_id, kind, resource, "DELETE"))

    unresolved_deletes = [
        resource for kind, resource in delete_resources
        if not partial_fragment_success_for_resource(connection, operation_id, kind, resource.resource_uuid)
    ]
    if unresolved_deletes:
        set_partial_operation_status(
            connection,
            operation_id,
            "FAILED",
            f"{len(unresolved_deletes)} CST DeleteLIRData operation(s) failed or did not complete; local partial reassignment was not committed",
        )
        return partial_result_from_db(connection, operation_id, jobs)

    assigned_networks = partial_assigned_networks_for_mode(original_network, requested_network, mode)
    for index, assigned_network in enumerate(assigned_networks, start=1):
        existing_fragment = connection.execute(
            """
            SELECT transaction_id
            FROM partial_reassignment_fragments
            WHERE operation_id = ?
              AND kind = 'ASSIGNED'
              AND cidr = ?
            LIMIT 1
            """,
            (operation_id, str(assigned_network)),
        ).fetchone()
        transaction_id = str(existing_fragment["transaction_id"]) if existing_fragment else (str(op["assigned_transaction_id"] or "") if index == 1 else "")
        assigned_resource = partial_assigned_resource_for_network(connection, operation_id, assigned_network, payload, original_resource, transaction_id)
        jobs.extend(partial_ensure_fragment_job(connection, operation_id, "ASSIGNED", assigned_resource, "SEND"))
        if index == 1:
            connection.execute(
                "UPDATE partial_reassignment_operations SET assigned_transaction_id = ? WHERE id = ?",
                (assigned_resource.transaction_id, operation_id),
            )

    unassigned_networks: list[IPv4Network] = []
    if mode == "SHRINK":
        unassigned_networks = network_difference(original_network, requested_network)
    elif mode == "EXPAND_REPLACE":
        for resource in affected_resources:
            resource_network = normalize_network(resource.cidr)
            assigned_inside_resource = [network for network in assigned_networks if network.overlaps(resource_network)]
            unassigned_networks.extend(subtract_allocated_networks(resource_network, assigned_inside_resource))
        unassigned_networks = normalize_network_list(unassigned_networks)

    for fragment_network in unassigned_networks:
        fragment_resource = partial_resource_from_network(original_resource, fragment_network, operation_id, "UNASSIGNED")
        jobs.extend(partial_ensure_fragment_job(connection, operation_id, "UNASSIGNED", fragment_resource, "SEND"))

    remaining = partial_non_success_fragments(connection, operation_id)
    if remaining:
        set_partial_operation_status(
            connection,
            operation_id,
            "FAILED",
            f"{len(remaining)} CST transaction(s) failed or did not complete; local partial reassignment was not committed",
        )
        return partial_result_from_db(connection, operation_id, jobs)

    assigned_transaction_id = str(op["assigned_transaction_id"] or "")
    if not assigned_transaction_id:
        row = connection.execute(
            "SELECT transaction_id FROM partial_reassignment_fragments WHERE operation_id = ? AND kind = 'ASSIGNED' ORDER BY created_at, id LIMIT 1",
            (operation_id,),
        ).fetchone()
        assigned_transaction_id = str(row["transaction_id"] if row else uuid4())
    local_transaction_id = str(op["original_transaction_id"] or original_resource.transaction_id or assigned_transaction_id) if mode.startswith("EXPAND") else assigned_transaction_id
    complete_partial_reassignment_locally(
        connection,
        operation_id,
        original_assignment,
        original_resource,
        requested_network,
        local_transaction_id,
        affected_resources if mode == "EXPAND_REPLACE" else [],
        "SUCCESS",
        not mode.startswith("EXPAND"),
    )
    return partial_result_from_db(connection, operation_id, jobs)


@app.post("/assignments/{assignment_id}/partial-reassign", response_model=PartialReassignmentResult, status_code=202)
def partial_reassign_assignment(assignment_id: str, payload: PartialReassignmentRequest) -> PartialReassignmentResult:
    original = find_assignment(assignment_id)
    original_network = network_of(original)
    requested_network = normalize_network(payload.cidr)
    if str(payload.cidr or "").strip() != str(requested_network):
        raise HTTPException(status_code=400, detail=f"{payload.cidr} is not CIDR-aligned. Choose {requested_network} or a valid boundary.")

    payload.assignment_status_id = normalize_assignment_status_id(payload.assignment_status_id, payload)
    operation_id = f"partial-reassign-{uuid4().hex[:12]}"
    with connect() as connection:
        validate_partial_reassignment_scope(connection, original, original_network, requested_network)
        original_resource = find_resource_by_source(connection, "assignment", assignment_id)
        if original_resource is None:
            raise HTTPException(status_code=404, detail="Original assignment resource not found")

        original_transaction_id = ""
        if cst_resource_reported_to_cst(connection, original_resource):
            original_transaction_id = cst_active_transaction_for_resource(connection, original_resource)
        else:
            original_transaction_id = str(original_resource.transaction_id or "").strip()

        timestamp = now_iso()
        connection.execute(
            """
            INSERT INTO partial_reassignment_operations (
              id, original_assignment_id, original_cidr, requested_cidr, status,
              original_transaction_id, assigned_transaction_id, assigned_payload_json,
              message, created_at, updated_at, completed_at
            )
            VALUES (?, ?, ?, ?, 'RUNNING', ?, '', ?, '', ?, ?, '')
            """,
            (
                operation_id,
                assignment_id,
                str(original_network),
                str(requested_network),
                original_transaction_id,
                payload.model_dump_json(),
                timestamp,
                timestamp,
            ),
        )
        record_audit(
            connection,
            "Partial LIR Reassignment Started",
            "partial_reassignment",
            operation_id,
            original.model_dump_json(),
            json.dumps({"requestedCidr": str(requested_network), "originalTransactionId": original_transaction_id}),
        )
        result = continue_partial_reassignment(connection, operation_id)
    return result


@app.post("/assignments/partial-reassign/{operation_id}/retry", response_model=PartialReassignmentResult)
def retry_partial_reassignment(operation_id: str) -> PartialReassignmentResult:
    with connect() as connection:
        op = connection.execute("SELECT * FROM partial_reassignment_operations WHERE id = ?", (operation_id,)).fetchone()
        if op is None:
            raise HTTPException(status_code=404, detail="Partial reassignment operation not found")
        jobs: list[CstSyncJob] = []
        if str(op["status"] or "") == "COMPLETED":
            jobs = [retry_partial_fragment_job(connection, row) for row in partial_non_success_fragments(connection, operation_id)]
            result = partial_result_from_db(connection, operation_id, jobs)
        else:
            result = continue_partial_reassignment(connection, operation_id)
        record_audit(
            connection,
            "Partial LIR Reassignment Retry",
            "partial_reassignment",
            operation_id,
            "",
            json.dumps({"status": result.status, "remaining": len([fragment for fragment in result.fragments if fragment.status != "SUCCESS"])}),
        )
    return result

@app.post("/assignments", response_model=Assignment, status_code=201)
def add_assignment(payload: AssignmentCreate) -> Assignment:
    network = normalize_network(payload.cidr)
    payload.assignment_status_id = normalize_assignment_status_id(payload.assignment_status_id, payload)
    validate_assignment(network)
    assignment = assignment_from_network(network, payload)
    with connect() as connection:
        insert_assignment(connection, assignment)
        resource = sync_assignment_resource(connection, assignment)
        if resource_requires_cst(resource):
            jobs = create_cst_assignment_create_jobs(connection, assignment, resource, "ASSIGNMENT_CREATE")
            assert_cst_business_flow_succeeded(jobs, "Assignment")
        record_audit(connection, "Subnet Allocation", "assignment", assignment.id, "", assignment.model_dump_json())
    return assignment




def process_assignment_bulk(csv_text: object) -> BulkImportResult:
    imported = 0
    errors: list[str] = []
    output_rows: list[BulkOutputRow] = []
    for index, row in enumerate(csv_rows(csv_text), start=2):
        row_output_start = len(output_rows)
        extra_columns = csv_value(row, "_extra_columns")
        if extra_columns:
            message = "Row has more values than the CSV header. Quote any field that contains commas, especially site/address/notes fields."
            errors.append(f"row {index}: {message} Extra values: {extra_columns}")
            output_rows.append(
                BulkOutputRow(
                    inputRowNumber=index,
                    processingStatus="FAILED",
                    processingMessage=message,
                    cstSyncReady=False,
                    cstValidationStatus="REJECTED",
                    cstValidationErrors=message,
                )
            )
            continue
        try:
            networks, is_pr_format = bulk_assignment_networks_from_row(row)
            assignment_status_id, assignment_status = bulk_assignment_status(row, is_pr_format)
            for network in networks:
                try:
                    assignment_payload = assignment_payload_from_bulk_row(row, network, assignment_status_id, assignment_status, index)
                    validate_cst_lir_assignment(assignment_payload)
                    overlap_assignments = validate_assignment(network, allow_overlap=True)
                    assignment = assignment_from_network(network, assignment_payload)
                    conflict_errors: list[str] = []
                    exact_overlap_conflict = False
                    if overlap_assignments:
                        exact_overlaps = [item for item in overlap_assignments if network_of(item) == network]
                        exact_overlap_conflict = bool(exact_overlaps)
                        conflict_errors = [assignment_conflict_message(network, overlap_assignments)]
                        if exact_overlaps:
                            exact_names = "; ".join(f"{item.customer_name or item.id} allocation {item.cidr}" for item in exact_overlaps[:8])
                            conflict_errors = [f"{network} exactly duplicates existing assignment(s): {exact_names}"]
                        assignment.migration_conflict_status = "CONFLICT"
                        assignment.migration_conflict_reason = conflict_errors[0]
                        assignment.migration_conflict_group = conflict_group_for_assignments(network, overlap_assignments)
                    with connect() as connection:
                        ready, validation_status, validation_errors, validation_warnings = cst_bulk_readiness_for_assignment(connection, assignment, [item for item in assignment.cst_validation_warnings.split("; ") if item])
                        if conflict_errors:
                            validation_errors = list(dict.fromkeys([*conflict_errors, *validation_errors]))
                            ready = False
                            validation_status = "CONFLICT"
                        assignment.cst_sync_ready = ready
                        assignment.cst_validation_status = validation_status
                        assignment.cst_validation_errors = "; ".join(validation_errors)
                        assignment.cst_validation_warnings = "; ".join(validation_warnings)
                        insert_assignment(connection, assignment)
                        resource = resource_record_for_assignment(assignment, connection=connection) if exact_overlap_conflict else sync_assignment_resource(connection, assignment)
                        record_audit(connection, "Subnet Allocation", "assignment", assignment.id, "", assignment.model_dump_json())
                        if conflict_errors:
                            record_audit(connection, "Bulk Assignment Conflict", "assignment", assignment.id, "", json.dumps({"row": index, "conflicts": conflict_errors, "group": assignment.migration_conflict_group, "exactOverlap": exact_overlap_conflict}))
                        if validation_warnings:
                            record_audit(connection, "CST Bulk Import Normalization", "assignment", assignment.id, "", json.dumps({"row": index, "warnings": validation_warnings}))
                    imported += 1
                    processing_message = "Imported with overlap conflict; resolve in Integrity & Conflicts before CST sync" if conflict_errors else "Ready for CST sync" if ready else "Imported but not ready for CST sync"
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="IMPORTED_WITH_CONFLICT" if conflict_errors else "SUCCESS" if ready else "IMPORTED_NOT_READY",
                            processingMessage=processing_message,
                            generatedResourceUuid=resource.resource_uuid,
                            generatedVersionUuid=resource.version_uuid,
                            generatedCidr=assignment.cidr,
                            generatedSize=assignment.size,
                            status=str(resource.assignment_status_id),
                            assignmentDate=assignment.assignment_date,
                            customerName=assignment.customer_name,
                            assignmentType=bulk_assignment_type(row, assignment_status_id),
                            cstSyncReady=ready,
                            cstValidationStatus=validation_status,
                            cstValidationErrors=assignment.cst_validation_errors,
                            cstValidationWarnings=assignment.cst_validation_warnings,
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
                            assignmentType=csv_value(row, "assignmentType", "assignment_type"),
                            cstSyncReady=False,
                            cstValidationStatus="REJECTED",
                            cstValidationErrors=str(exc.detail),
                        )
                    )
                except (sqlite3.IntegrityError, ValueError) as exc:
                    duplicate_detail = "duplicate CIDR already exists; exact duplicate CIDRs cannot be parked as normal assignment rows" if isinstance(exc, sqlite3.IntegrityError) else "invalid assignment"
                    message = f"row {index} {network}: {duplicate_detail}"
                    errors.append(message)
                    output_rows.append(
                        BulkOutputRow(
                            inputRowNumber=index,
                            processingStatus="FAILED_DUPLICATE_CONFLICT" if isinstance(exc, sqlite3.IntegrityError) else "FAILED",
                            processingMessage=duplicate_detail,
                            generatedCidr=str(network),
                            generatedSize=network.num_addresses,
                            status=str(assignment_status_id),
                            assignmentDate=csv_value(row, "assignmentDate", "assignment_date"),
                            customerName=csv_value(row, "customerName", "customer_name"),
                            assignmentType=csv_value(row, "assignmentType", "assignment_type"),
                            cstSyncReady=False,
                            cstValidationStatus="REJECTED",
                            cstValidationErrors=duplicate_detail,
                        )
                    )
            row_outputs = output_rows[row_output_start:]
            if any(item.processingStatus in {"SUCCESS", "IMPORTED_NOT_READY", "IMPORTED_WITH_CONFLICT"} for item in row_outputs) and any(item.processingStatus.startswith("FAILED") for item in row_outputs):
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
    if imported:
        with connect() as connection:
            materialized, deleted_stale = materialize_bulk_unassigned_fragments(connection)
            if materialized or deleted_stale:
                output_rows.append(
                    BulkOutputRow(
                        inputRowNumber=0,
                        processingStatus="MATERIALIZED_UNASSIGNED",
                        processingMessage=f"Materialized {materialized} remaining unassigned CIDR fragment(s); removed {deleted_stale} stale generated fragment(s).",
                        assignmentType="UNASSIGNED",
                        cstSyncReady=True,
                        cstValidationStatus="READY",
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
            if cst_resource_reported_to_cst(connection, resource) and not cst_resource_deleted_from_cst(connection, resource):
                jobs = create_cst_sync_jobs(connection, [(cst_unassigned_update_resource(resource), "UPDATE")], "ASSIGNMENT_RELEASE")
                assert_cst_business_flow_succeeded(jobs, "Assignment release")
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
            jobs = create_cst_sync_jobs(connection, [(resource, "UPDATE")], "ASSIGNMENT_STATUS_CHANGE")
            assert_cst_business_flow_succeeded(jobs, "Assignment status change")
        after = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
        record_audit(connection, "Assignment Changes", "assignment", assignment_id, before.model_dump_json(), after.model_dump_json())
    return after


@app.delete("/assignments/{assignment_id}", status_code=204)
def unassign(assignment_id: str) -> None:
    assignment = find_assignment(assignment_id)
    with connect() as connection:
        resource = find_resource_by_source(connection, "assignment", assignment_id)
        cst_delete_required = cst_resource_reported_to_cst(connection, resource)
        if resource and resource.status == "RETIRED":
            audit_action = "Retired Resource Deletion" if not cst_delete_required else "CST Assignment Status Update"
            audit_new_value = "Deleted retired resource" if not cst_delete_required else "Set CST LIR assignmentStatusId to 1 Unassigned and released locally"
        else:
            assert_resource_can_change(connection, "assignment", assignment_id)
            audit_action = "Subnet Release"
            audit_new_value = "Released to free pool"

        if cst_delete_required:
            connection.execute(
                "UPDATE assignments SET status = ?, action_flag = ? WHERE id = ?",
                ("Retiring", "U", assignment_id),
            )
            retiring_assignment = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
            resource = sync_assignment_resource(connection, retiring_assignment)
            jobs = create_cst_sync_jobs(connection, [(cst_unassigned_update_resource(resource), "UPDATE")], "ASSIGNMENT_UNASSIGN")
            assert_cst_business_flow_succeeded(jobs, "Unassign")
            audit_action = "CST Assignment Status Update"
            audit_new_value = "Set CST LIR assignmentStatusId to 1 Unassigned and released locally"

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
    assignments = [assignment for assignment in list_assignments_from_db() if assignment_active_for_conflict(assignment)]
    pool_ranges = [(network_of(pool), pool) for pool in pools]
    with connect() as connection:
        resource_by_assignment_id = {
            str(row["source_entity_id"]): str(row["resource_uuid"])
            for row in connection.execute(
                "SELECT source_entity_id, resource_uuid FROM ip_resources WHERE source_entity_type = 'assignment'"
            ).fetchall()
        }

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
                        resolution_status="OPEN",
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
                    assignment_ids=[assignment.id],
                    resource_uuids=[resource_by_assignment_id.get(assignment.id, "")],
                    resolution_status="PENDING_RESOLUTION" if assignment.migration_conflict_status else "OPEN",
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
                resolution_status = "PENDING_RESOLUTION" if (
                    active_assignment.migration_conflict_status or assignment.migration_conflict_status
                ) else "OPEN"
                conflicts.append(
                    Conflict(
                        severity="critical",
                        title="Customer assignments overlap",
                        detail=f"{active_assignment.customer_name} overlaps {assignment.customer_name}",
                        ranges=[active_assignment.cidr, assignment.cidr],
                        assignment_ids=[active_assignment.id, assignment.id],
                        resource_uuids=[resource_by_assignment_id.get(active_assignment.id, ""), resource_by_assignment_id.get(assignment.id, "")],
                        resolution_status=resolution_status,
                    )
                )
                if len(conflicts) >= 500:
                    return conflicts
        active_overlaps.append((start, end, assignment))

    return conflicts


def cst_warning_list(value: str) -> list[str]:
    return [item for item in str(value or "").split("; ") if item]


def update_assignment_conflict_state(
    connection: sqlite3.Connection,
    assignment: Assignment,
    *,
    status: str,
    conflict_status: str,
    conflict_reason: str,
    validation_status: str,
    validation_errors: list[str],
    cst_ready: bool,
    cst_sync_status: str,
    action_flag: str,
) -> Assignment:
    validation_warnings = cst_warning_list(assignment.cst_validation_warnings)
    connection.execute(
        """
        UPDATE assignments
        SET status = ?, migration_conflict_status = ?, migration_conflict_reason = ?, migration_conflict_group = ?,
            cst_validation_status = ?, cst_validation_errors = ?, cst_validation_warnings = ?,
            cst_sync_ready = ?, cst_sync_status = ?, action_flag = ?
        WHERE id = ?
        """,
        (
            status,
            conflict_status,
            conflict_reason,
            assignment.migration_conflict_group,
            validation_status,
            "; ".join(dict.fromkeys(validation_errors)),
            "; ".join(dict.fromkeys(validation_warnings)),
            cst_ready,
            cst_sync_status,
            action_flag,
            assignment.id,
        ),
    )
    updated = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment.id,)).fetchone())
    existing_resource = find_resource_by_source(connection, "assignment", updated.id)
    if existing_resource or conflict_status == "ACCEPTED":
        sync_assignment_resource(connection, updated)
    return updated


@app.post("/conflicts/assignments/{assignment_id}/reject", response_model=Assignment)
def reject_conflicting_assignment(assignment_id: str) -> Assignment:
    before = find_assignment(assignment_id)
    with connect() as connection:
        resource = find_resource_by_source(connection, "assignment", assignment_id)
        if resource and cst_resource_reported_to_cst(connection, resource):
            raise HTTPException(status_code=409, detail="Reported CST assignments must be unassigned through the CST delete flow, not rejected as a migration conflict")
        after = update_assignment_conflict_state(
            connection,
            before,
            status="Retiring",
            conflict_status="REJECTED",
            conflict_reason="Rejected during migration conflict resolution",
            validation_status="REJECTED",
            validation_errors=["Rejected during migration conflict resolution"],
            cst_ready=False,
            cst_sync_status="NOT_REQUIRED",
            action_flag="D",
        )
        materialize_bulk_unassigned_fragments(connection)
        record_audit(connection, "Bulk Assignment Conflict Rejected", "assignment", assignment_id, before.model_dump_json(), after.model_dump_json())
    return after


@app.post("/conflicts/assignments/{assignment_id}/accept", response_model=Assignment)
def accept_conflicting_assignment(assignment_id: str) -> Assignment:
    before = find_assignment(assignment_id)
    candidate_network = network_of(before)
    remaining_overlaps = assignment_overlap_candidates(candidate_network, {assignment_id})
    with connect() as connection:
        if remaining_overlaps:
            reason = assignment_conflict_message(candidate_network, remaining_overlaps)
            after = update_assignment_conflict_state(
                connection,
                before,
                status="Active",
                conflict_status="CONFLICT",
                conflict_reason=reason,
                validation_status="CONFLICT",
                validation_errors=[reason],
                cst_ready=False,
                cst_sync_status="PENDING",
                action_flag=before.action_flag or "N",
            )
            record_audit(connection, "Bulk Assignment Conflict Recheck", "assignment", assignment_id, before.model_dump_json(), after.model_dump_json())
            raise HTTPException(status_code=409, detail=f"Cannot accept yet. {reason}")

        candidate = before.model_copy(update={
            "status": "Active",
            "migration_conflict_status": "ACCEPTED",
            "migration_conflict_reason": "",
            "migration_conflict_group": "",
        })
        ready, validation_status, validation_errors, validation_warnings = cst_bulk_readiness_for_assignment(connection, candidate, cst_warning_list(candidate.cst_validation_warnings))
        candidate.cst_sync_ready = ready
        candidate.cst_validation_status = validation_status
        candidate.cst_validation_errors = "; ".join(validation_errors)
        candidate.cst_validation_warnings = "; ".join(validation_warnings)
        after = update_assignment_conflict_state(
            connection,
            candidate,
            status="Active",
            conflict_status="ACCEPTED",
            conflict_reason="",
            validation_status=validation_status,
            validation_errors=validation_errors,
            cst_ready=ready,
            cst_sync_status="PENDING" if ready else before.cst_sync_status or "PENDING",
            action_flag=before.action_flag or "N",
        )
        connection.execute("UPDATE assignments SET migration_conflict_group = '' WHERE id = ?", (assignment_id,))
        after = assignment_from_row(connection.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone())
        sync_assignment_resource(connection, after)
        materialize_bulk_unassigned_fragments(connection)
        record_audit(connection, "Bulk Assignment Conflict Accepted", "assignment", assignment_id, before.model_dump_json(), after.model_dump_json())
    return after

def init_db_with_retry(max_attempts: int = 6) -> None:
    for attempt in range(1, max_attempts + 1):
        try:
            init_db()
            return
        except sqlite3.OperationalError as exc:
            message = str(exc).lower()
            if "database is locked" not in message and "database is busy" not in message:
                raise
            if attempt == max_attempts:
                raise
            delay_seconds = min(2 * attempt, 10)
            print(f"SQLite database is locked during startup migration; retrying in {delay_seconds}s ({attempt}/{max_attempts})")
            time.sleep(delay_seconds)


init_db_with_retry()


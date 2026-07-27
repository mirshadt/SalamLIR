-- Salam LIR PostgreSQL schema-only setup
-- Purpose: create database tables only. No assignment/customer data is inserted.
-- Target database: lir
-- Target owner/user: lir_app
-- Run after creating the database/user:
--   psql -U lir_app -d lir -f docs/postgres_schema_only.sql

BEGIN;

CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  cidr CIDR NOT NULL UNIQUE,
  prefix INTEGER NOT NULL,
  size BIGINT NOT NULL,
  start INET NOT NULL,
  "end" INET NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'IP Subnet',
  lifecycle_state TEXT NOT NULL DEFAULT 'Active',
  resource_status TEXT NOT NULL DEFAULT 'Available',
  operational_state TEXT NOT NULL DEFAULT 'Enabled',
  administrative_state TEXT NOT NULL DEFAULT 'Unlocked',
  usage_state TEXT NOT NULL DEFAULT 'Idle',
  resource_specification_id TEXT NOT NULL DEFAULT 'RS-IP-SUBNET',
  resource_specification_name TEXT NOT NULL DEFAULT 'IPv4 Subnet Logical Resource',
  resource_type TEXT NOT NULL DEFAULT 'LogicalResource.IPSubnet',
  resource_role TEXT NOT NULL DEFAULT 'ParentPool',
  address_family TEXT NOT NULL DEFAULT 'IPv4',
  ip_version TEXT NOT NULL DEFAULT '4',
  parent_resource_id TEXT NOT NULL DEFAULT '',
  parent_cidr TEXT NOT NULL DEFAULT '',
  allocation_policy TEXT NOT NULL DEFAULT 'Boundary partitioning',
  reservation_policy TEXT NOT NULL DEFAULT 'Manual approval',
  vrf_name TEXT NOT NULL DEFAULT '',
  route_distinguisher TEXT NOT NULL DEFAULT '',
  route_target TEXT NOT NULL DEFAULT '',
  vlan_id TEXT NOT NULL DEFAULT '',
  asn TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  site_name TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT 'IPAM',
  cost_center TEXT NOT NULL DEFAULT '',
  security_zone TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  source_system TEXT NOT NULL DEFAULT 'NetAtlas IPAM',
  external_id TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  last_audit_at TIMESTAMPTZ,
  tags TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'API',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  cidr CIDR NOT NULL UNIQUE,
  prefix INTEGER NOT NULL,
  size BIGINT NOT NULL,
  start INET NOT NULL,
  "end" INET NOT NULL,
  first_usable INET NOT NULL,
  last_usable INET NOT NULL,
  assignment_status_id INTEGER NOT NULL DEFAULT 3,
  service_provider_id TEXT NOT NULL DEFAULT '5',
  service_provider_name TEXT NOT NULL DEFAULT 'Salam',
  action_flag CHAR(1) NOT NULL DEFAULT 'N',
  cst_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  ripe_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  assignment_target_type TEXT NOT NULL DEFAULT 'business_customer',
  assignment_name TEXT NOT NULL DEFAULT '',
  assignment_description TEXT NOT NULL DEFAULT '',
  resource_relationship_type TEXT NOT NULL DEFAULT 'ResourceAssignment',
  logical_resource_id TEXT NOT NULL DEFAULT '',
  resource_specification_id TEXT NOT NULL DEFAULT 'RS-IP-SUBNET',
  resource_specification_name TEXT NOT NULL DEFAULT 'IPv4 Subnet Logical Resource',
  resource_type TEXT NOT NULL DEFAULT 'LogicalResource.IPSubnet',
  resource_category TEXT NOT NULL DEFAULT 'IP Subnet',
  resource_role TEXT NOT NULL DEFAULT 'AssignedSubnet',
  resource_lifecycle_state TEXT NOT NULL DEFAULT 'Active',
  resource_usage_state TEXT NOT NULL DEFAULT 'Allocated',
  resource_operational_state TEXT NOT NULL DEFAULT 'Enabled',
  resource_administrative_state TEXT NOT NULL DEFAULT 'Unlocked',
  service_specification_id TEXT NOT NULL DEFAULT '',
  service_specification_name TEXT NOT NULL DEFAULT 'L3 Connectivity Service',
  service_specification_type TEXT NOT NULL DEFAULT 'CustomerFacingServiceSpecification',
  service_instance_id TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL DEFAULT '',
  service_instance_name TEXT NOT NULL DEFAULT '',
  service_type TEXT NOT NULL DEFAULT 'CustomerFacingService',
  service_category TEXT NOT NULL DEFAULT 'L3 Service',
  service_order_id TEXT NOT NULL DEFAULT '',
  siebel_order_number TEXT NOT NULL DEFAULT '',
  bss_customer_id TEXT NOT NULL DEFAULT '',
  siebel_last_sync_at TIMESTAMPTZ,
  siebel_last_checked_at TIMESTAMPTZ,
  siebel_payload_hash TEXT NOT NULL DEFAULT '',
  siebel_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_characteristics TEXT NOT NULL DEFAULT '',
  product_specification_id TEXT NOT NULL DEFAULT '',
  product_specification_name TEXT NOT NULL DEFAULT '',
  product_offering_id TEXT NOT NULL DEFAULT '',
  product_offering_name TEXT NOT NULL DEFAULT '',
  product_instance_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'Enterprise',
  organization_name TEXT NOT NULL DEFAULT '',
  organization_id TEXT NOT NULL DEFAULT '',
  customer_type_id TEXT NOT NULL DEFAULT '',
  region_id TEXT NOT NULL DEFAULT '',
  city_id TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  mobile_number TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  customer_account_id TEXT NOT NULL DEFAULT '',
  customer_segment TEXT NOT NULL DEFAULT 'Enterprise',
  commercial_reg_id TEXT NOT NULL DEFAULT '',
  unified_number TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  internal_consumer_type TEXT NOT NULL DEFAULT '',
  internal_business_unit TEXT NOT NULL DEFAULT '',
  internal_application_id TEXT NOT NULL DEFAULT '',
  internal_application_name TEXT NOT NULL DEFAULT '',
  internal_environment TEXT NOT NULL DEFAULT '',
  internal_owner_team TEXT NOT NULL DEFAULT '',
  internal_cost_center TEXT NOT NULL DEFAULT '',
  internal_project_code TEXT NOT NULL DEFAULT '',
  internal_change_request_id TEXT NOT NULL DEFAULT '',
  internal_justification TEXT NOT NULL DEFAULT '',
  l3_service TEXT NOT NULL DEFAULT 'MPLS L3VPN',
  service TEXT NOT NULL DEFAULT 'L3 service allocation',
  owner TEXT NOT NULL DEFAULT 'Network service desk',
  site TEXT NOT NULL DEFAULT 'Unassigned site',
  site_id TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  latitude TEXT NOT NULL DEFAULT '',
  longitude TEXT NOT NULL DEFAULT '',
  vrf_name TEXT NOT NULL DEFAULT '',
  vlan_id TEXT NOT NULL DEFAULT '',
  asn TEXT NOT NULL DEFAULT '',
  routing_domain TEXT NOT NULL DEFAULT '',
  route_distinguisher TEXT NOT NULL DEFAULT '',
  route_target TEXT NOT NULL DEFAULT '',
  network_slice TEXT NOT NULL DEFAULT '',
  security_zone TEXT NOT NULL DEFAULT '',
  gateway_ip INET,
  dns_profile TEXT NOT NULL DEFAULT '',
  dhcp_scope TEXT NOT NULL DEFAULT '',
  nat_policy TEXT NOT NULL DEFAULT '',
  qos_profile TEXT NOT NULL DEFAULT '',
  access_technology_id TEXT NOT NULL DEFAULT '',
  access_technology TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approval_reference TEXT NOT NULL DEFAULT '',
  reserved_until TIMESTAMPTZ,
  assignment_purpose TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'Production',
  status TEXT NOT NULL DEFAULT 'Planned',
  assignment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ip_resources (
  resource_uuid TEXT PRIMARY KEY,
  version_uuid TEXT NOT NULL,
  parent_resource_uuid TEXT NOT NULL DEFAULT '',
  parent_version_uuid TEXT NOT NULL DEFAULT '',
  transaction_id TEXT NOT NULL DEFAULT '',
  cidr CIDR NOT NULL UNIQUE,
  prefix INTEGER NOT NULL,
  start_ip INET NOT NULL,
  end_ip INET NOT NULL,
  size BIGINT NOT NULL,
  ip_version INTEGER NOT NULL DEFAULT 1,
  ownership_type TEXT NOT NULL,
  status TEXT NOT NULL,
  cidr_role TEXT NOT NULL DEFAULT 'SUBNET',
  service_provider_id TEXT NOT NULL DEFAULT '5',
  service_provider_name TEXT NOT NULL DEFAULT 'Salam',
  asn TEXT NOT NULL DEFAULT 'AS35753',
  assignment_status_id INTEGER NOT NULL DEFAULT 1,
  service_id TEXT NOT NULL DEFAULT '',
  organization_name TEXT NOT NULL DEFAULT '',
  organization_id TEXT NOT NULL DEFAULT '',
  customer_type_id TEXT NOT NULL DEFAULT '',
  region_id TEXT NOT NULL DEFAULT '',
  city_id TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  mobile_number TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  assignment_date TIMESTAMPTZ,
  update_date TIMESTAMPTZ,
  access_technology_id TEXT NOT NULL DEFAULT '',
  access_technology TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  action_flag CHAR(1) NOT NULL DEFAULT 'N',
  cst_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  ripe_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  ip_type TEXT NOT NULL DEFAULT 'PUBLIC',
  root_pool_uuid TEXT NOT NULL DEFAULT '',
  source_entity_type TEXT NOT NULL DEFAULT '',
  source_entity_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_details (
  id TEXT PRIMARY KEY,
  resource_uuid TEXT NOT NULL REFERENCES ip_resources(resource_uuid) ON DELETE CASCADE,
  version_uuid TEXT NOT NULL,
  assignment_type TEXT NOT NULL,
  assignment_status_id INTEGER NOT NULL DEFAULT 3,
  assignment_date TIMESTAMPTZ NOT NULL,
  service_id TEXT NOT NULL DEFAULT '',
  service_order_id TEXT NOT NULL DEFAULT '',
  siebel_order_number TEXT NOT NULL DEFAULT '',
  bss_customer_id TEXT NOT NULL DEFAULT '',
  siebel_last_sync_at TIMESTAMPTZ,
  siebel_last_checked_at TIMESTAMPTZ,
  siebel_payload_hash TEXT NOT NULL DEFAULT '',
  siebel_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_name TEXT NOT NULL DEFAULT '',
  organization_name TEXT NOT NULL DEFAULT '',
  organization_id TEXT NOT NULL DEFAULT '',
  customer_type_id TEXT NOT NULL DEFAULT '',
  region_id TEXT NOT NULL DEFAULT '',
  city_id TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  mobile_number TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  commercial_reg_id TEXT NOT NULL DEFAULT '',
  unified_number TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  service_instance_id TEXT NOT NULL DEFAULT '',
  service_instance_name TEXT NOT NULL DEFAULT '',
  service_type TEXT NOT NULL DEFAULT '',
  service_category TEXT NOT NULL DEFAULT '',
  l3_service TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  access_technology_id TEXT NOT NULL DEFAULT '',
  access_technology TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  "user" TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'ipam-core-services',
  request_id TEXT NOT NULL DEFAULT ''
);

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
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ripe_config (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  connection_timeout INTEGER NOT NULL,
  read_timeout INTEGER NOT NULL,
  default_maintainer TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS siebel_config (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  dsn TEXT NOT NULL,
  connection_timeout INTEGER NOT NULL,
  query_sql TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bss_sync_audit (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL DEFAULT '',
  siebel_order_number TEXT NOT NULL DEFAULT '',
  changed_field TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ripe_allocated_pools (
  id TEXT PRIMARY KEY,
  pool_name TEXT NOT NULL,
  cidr CIDR NOT NULL UNIQUE,
  start_ip INET NOT NULL,
  end_ip INET NOT NULL,
  allocation_type TEXT NOT NULL,
  source TEXT NOT NULL,
  created_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cst_config (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  service_provider_id TEXT NOT NULL DEFAULT '5',
  auto_execute BOOLEAN NOT NULL DEFAULT TRUE,
  scheduled_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
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
  token_expires_at TIMESTAMPTZ,
  auth_password_configured BOOLEAN NOT NULL DEFAULT FALSE,
  api_access_key_configured BOOLEAN NOT NULL DEFAULT FALSE,
  user_key_configured BOOLEAN NOT NULL DEFAULT FALSE,
  token_cached BOOLEAN NOT NULL DEFAULT FALSE,
  verify_ssl BOOLEAN NOT NULL DEFAULT FALSE,
  connection_timeout INTEGER NOT NULL DEFAULT 10,
  read_timeout INTEGER NOT NULL DEFAULT 30,
  token_refresh_buffer_seconds INTEGER NOT NULL DEFAULT 300,
  schedule_time TEXT NOT NULL DEFAULT '00:30',
  schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  last_scheduled_run_date DATE,
  last_scheduled_run_at TIMESTAMPTZ,
  batch_size_limit INTEGER NOT NULL DEFAULT 500,
  hourly_request_limit INTEGER NOT NULL DEFAULT 1000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cst_sync_batches (
  id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  blocked_jobs INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cst_sync_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES cst_sync_batches(id) ON DELETE CASCADE,
  resource_uuid TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  depends_on_job_id TEXT NOT NULL DEFAULT '',
  cidr TEXT NOT NULL,
  service_provider_id TEXT NOT NULL DEFAULT '5',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cst_transaction_ledger (
  transaction_id TEXT PRIMARY KEY,
  cidr TEXT NOT NULL,
  resource_uuid TEXT NOT NULL,
  service_provider_id TEXT NOT NULL DEFAULT '5',
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status TEXT NOT NULL,
  retired_at TIMESTAMPTZ,
  retired_reason TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',
  correlation_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cst_scheduler_runs (
  id TEXT PRIMARY KEY,
  target_date DATE NOT NULL UNIQUE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  batch_id TEXT NOT NULL DEFAULT '',
  total_jobs INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  triggered_by TEXT NOT NULL DEFAULT 'scheduler',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pools_cidr ON pools (cidr);
CREATE INDEX IF NOT EXISTS idx_assignments_cidr ON assignments (cidr);
CREATE INDEX IF NOT EXISTS idx_assignments_customer ON assignments (customer_name);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments (status);
CREATE INDEX IF NOT EXISTS idx_assignments_cst_status ON assignments (cst_sync_status);
CREATE INDEX IF NOT EXISTS idx_assignments_service_id ON assignments (service_id);

CREATE INDEX IF NOT EXISTS idx_ip_resources_cidr ON ip_resources (cidr);
CREATE INDEX IF NOT EXISTS idx_ip_resources_status ON ip_resources (status);
CREATE INDEX IF NOT EXISTS idx_ip_resources_root ON ip_resources (root_pool_uuid);
CREATE INDEX IF NOT EXISTS idx_ip_resources_source ON ip_resources (source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_ip_resources_cst_status ON ip_resources (cst_sync_status);
CREATE INDEX IF NOT EXISTS idx_ip_resources_transaction ON ip_resources (transaction_id);

CREATE INDEX IF NOT EXISTS idx_assignment_details_customer ON assignment_details (customer_name);
CREATE INDEX IF NOT EXISTS idx_assignment_details_resource ON assignment_details (resource_uuid);
CREATE INDEX IF NOT EXISTS idx_assignment_details_service ON assignment_details (service_id);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_bulk_batches_started ON bulk_batches (started_at);
CREATE INDEX IF NOT EXISTS idx_bulk_batches_status ON bulk_batches (status);
CREATE INDEX IF NOT EXISTS idx_bss_sync_assignment ON bss_sync_audit (assignment_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_bss_sync_service ON bss_sync_audit (service_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_bss_sync_order ON bss_sync_audit (siebel_order_number, synced_at);
CREATE INDEX IF NOT EXISTS idx_ripe_allocated_pools_cidr ON ripe_allocated_pools (cidr);
CREATE INDEX IF NOT EXISTS idx_ripe_allocated_pools_created ON ripe_allocated_pools (created_date);

CREATE INDEX IF NOT EXISTS idx_cst_batches_created ON cst_sync_batches (created_at);
CREATE INDEX IF NOT EXISTS idx_cst_batches_status ON cst_sync_batches (status);
CREATE INDEX IF NOT EXISTS idx_cst_jobs_batch ON cst_sync_jobs (batch_id);
CREATE INDEX IF NOT EXISTS idx_cst_jobs_status ON cst_sync_jobs (status);
CREATE INDEX IF NOT EXISTS idx_cst_jobs_transaction ON cst_sync_jobs (transaction_id);
CREATE INDEX IF NOT EXISTS idx_cst_jobs_resource ON cst_sync_jobs (resource_uuid);
CREATE INDEX IF NOT EXISTS idx_cst_ledger_cidr ON cst_transaction_ledger (cidr);
CREATE INDEX IF NOT EXISTS idx_cst_ledger_status ON cst_transaction_ledger (last_status);
CREATE INDEX IF NOT EXISTS idx_cst_ledger_resource ON cst_transaction_ledger (resource_uuid);
CREATE INDEX IF NOT EXISTS idx_cst_scheduler_runs_started ON cst_scheduler_runs (started_at);

COMMIT;

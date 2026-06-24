import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001",
  timeout: 20000
});

const transientStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error)) {
      throw error;
    }

    const config = error.config;
    if (!config || config.method?.toLowerCase() !== "get") {
      throw error;
    }

    const retryCount = Number((config as { _retryCount?: number })._retryCount ?? 0);
    const status = error.response?.status;
    const isTransient = !error.response || (status !== undefined && transientStatusCodes.has(status));
    if (!isTransient || retryCount >= 3) {
      throw error;
    }

    (config as { _retryCount?: number })._retryCount = retryCount + 1;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 800 * (retryCount + 1)));
    return api(config);
  }
);

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("ipam-token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export type Pool = {
  id: string;
  cidr: string;
  prefix: number;
  size: number;
  start: string;
  end: string;
  name: string;
  region: string;
  source: string;
  created_at: string;
  description: string;
  category: string;
  lifecycle_state: string;
  resource_status: string;
  operational_state: string;
  administrative_state: string;
  usage_state: string;
  resource_specification_id: string;
  resource_specification_name: string;
  resource_type: string;
  resource_role: string;
  address_family: string;
  ip_version: string;
  parent_resource_id: string;
  parent_cidr: string;
  allocation_policy: string;
  reservation_policy: string;
  vrf_name: string;
  route_distinguisher: string;
  route_target: string;
  vlan_id: string;
  asn: string;
  site_id: string;
  site_name: string;
  location_name: string;
  owner: string;
  cost_center: string;
  security_zone: string;
  provider: string;
  source_system: string;
  external_id: string;
  href: string;
  version: string;
  start_date: string;
  end_date: string;
  last_audit_at: string;
  tags: string;
};

export type Assignment = {
  id: string;
  cidr: string;
  prefix: number;
  size: number;
  start: string;
  end: string;
  first_usable: string;
  last_usable: string;
  assignment_status_id: number;
  service_provider_id: string;
  service_provider_name: string;
  action_flag: string;
  cst_sync_status: string;
  ripe_sync_status: string;
  assignment_target_type: AssignmentTargetType;
  assignment_name: string;
  assignment_description: string;
  resource_relationship_type: string;
  logical_resource_id: string;
  resource_specification_id: string;
  resource_specification_name: string;
  resource_type: string;
  resource_category: string;
  resource_role: string;
  resource_lifecycle_state: string;
  resource_usage_state: string;
  resource_operational_state: string;
  resource_administrative_state: string;
  service_specification_id: string;
  service_specification_name: string;
  service_specification_type: string;
  service_instance_id: string;
  service_id: string;
  service_instance_name: string;
  service_type: string;
  service_category: string;
  service_order_id: string;
  service_characteristics: string;
  product_specification_id: string;
  product_specification_name: string;
  product_offering_id: string;
  product_offering_name: string;
  product_instance_id: string;
  customer_id: string;
  customer_name: string;
  customer_type: string;
  organization_name: string;
  organization_id: string;
  customer_type_id: string;
  region_id: string;
  city_id: string;
  full_name: string;
  mobile_number: string;
  id_number: string;
  email: string;
  customer_account_id: string;
  customer_segment: string;
  commercial_reg_id: string;
  unified_number: string;
  contact_number: string;
  contact_email: string;
  city: string;
  region: string;
  contact_name: string;
  internal_consumer_type: string;
  internal_business_unit: string;
  internal_application_id: string;
  internal_application_name: string;
  internal_environment: string;
  internal_owner_team: string;
  internal_cost_center: string;
  internal_project_code: string;
  internal_change_request_id: string;
  internal_justification: string;
  l3_service: string;
  service: string;
  owner: string;
  site: string;
  site_id: string;
  location_name: string;
  latitude: string;
  longitude: string;
  vrf_name: string;
  vlan_id: string;
  asn: string;
  routing_domain: string;
  route_distinguisher: string;
  route_target: string;
  network_slice: string;
  security_zone: string;
  gateway_ip: string;
  dns_profile: string;
  dhcp_scope: string;
  nat_policy: string;
  qos_profile: string;
  access_technology_id: string;
  access_technology: string;
  service_description: string;
  requested_by: string;
  approved_by: string;
  approval_reference: string;
  reserved_until: string;
  assignment_purpose: string;
  environment: string;
  status: AssignmentStatus;
  assignment_date: string;
  notes: string;
  created_at: string;
};

export type AssignmentStatus = "Reserved" | "Active" | "Planned" | "Retiring" | "Quarantined" | "Blocked";
export type AssignmentTargetType = "business_customer" | "internal" | "individual";

export type User = {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  status: "Active" | "Disabled";
  created_at: string;
};

export type AuditEvent = {
  id: string;
  user: string;
  timestamp: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: string;
  new_value: string;
};

export type Conflict = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  ranges: string[];
};

export type BulkResult = {
  imported: number;
  blocked: number;
  errors: string[];
  output_rows?: BulkOutputRow[];
};

export type BulkBatch = {
  id: string;
  operation_type: "POOL_IMPORT" | "ASSIGNMENT_IMPORT" | string;
  status: "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | string;
  file_name: string;
  total_rows: number;
  success_count: number;
  failure_count: number;
  imported_count: number;
  blocked_count: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_summary: string;
  result_json: string;
  created_by: string;
};

export type RipeConfig = {
  base_url: string;
  auth_type: string;
  username: string;
  password_configured: boolean;
  connection_timeout: number;
  read_timeout: number;
  default_maintainer: string;
  updated_at: string;
};

export type RipeConfigPayload = {
  base_url: string;
  auth_type: string;
  username: string;
  password?: string;
  connection_timeout: number;
  read_timeout: number;
  default_maintainer: string;
};

export type RipeAllocatedPool = {
  id: string;
  pool_name: string;
  cidr: string;
  start_ip: string;
  end_ip: string;
  allocation_type: string;
  source: string;
  created_date: string;
  created_at: string;
};

export type RipeAllocatedPoolBulkResult = {
  imported: number;
  blocked: number;
  errors: string[];
  pools: RipeAllocatedPool[];
};

export type RipeReportResponse = {
  pool: RipeAllocatedPool;
  report_type: string;
  date_from: string;
  date_to: string;
  maintainer: string;
  rows: Array<Record<string, string | number>>;
  message: string;
};

export type RipeDiscoveredRootPool = {
  pool_name: string;
  allocation_range: string;
  cidr: string;
  total_ips: number;
  start_ip: string;
  end_ip: string;
  ripe_maintainer: string;
  ripe_status: string;
  source: string;
  local_sync_status: string;
  cst_sync_status: string;
  last_sync_date: string;
  object_href: string;
};

export type RipeDiscoveryResponse = {
  maintainer: string;
  rows: RipeDiscoveredRootPool[];
  message: string;
};

export type RipePushResponse = {
  success: boolean;
  status_code: number;
  assignment_id: string;
  cidr: string;
  ripe_sync_status: string;
  message: string;
  request_object: Record<string, unknown>;
  response_body: string;
};

export type BulkOutputRow = {
  inputRowNumber: number;
  processingStatus: "SUCCESS" | "FAILED" | "PARTIAL_SUCCESS";
  processingMessage: string;
  generatedResourceUuid: string;
  generatedVersionUuid: string;
  generatedCidr: string;
  generatedSize: number;
  status: string;
  assignmentDate: string;
  customerName: string;
};

export type ResourceRecord = {
  resource_uuid: string;
  version_uuid: string;
  parent_resource_uuid: string;
  parent_version_uuid: string;
  transaction_id: string;
  cidr: string;
  prefix: number;
  start_ip: string;
  end_ip: string;
  size: number;
  ip_version: number;
  ownership_type: "BUSINESS" | "INDIVIDUAL" | "INTERNAL" | "INFRASTRUCTURE" | "POOL";
  status: "ASSIGNED_TO_BUSINESS" | "RESERVED" | "AVAILABLE" | "RETIRED";
  cidr_role: string;
  service_provider_id: string;
  service_provider_name: string;
  asn: string;
  assignment_status_id: number;
  service_id: string;
  organization_name: string;
  organization_id: string;
  customer_type_id: string;
  region_id: string;
  city_id: string;
  full_name: string;
  mobile_number: string;
  id_number: string;
  email: string;
  customer_name: string;
  assignment_date: string;
  update_date: string;
  access_technology_id: string;
  access_technology: string;
  service_description: string;
  description: string;
  action_flag: string;
  cst_sync_status: string;
  ripe_sync_status: string;
  ip_type: "PUBLIC" | "PRIVATE";
  root_pool_uuid: string;
  source_entity_type: string;
  source_entity_id: string;
  created_at: string;
  updated_at: string;
  assignment: AssignmentDetailRecord | null;
};

export type AssignmentDetailRecord = {
  id: string;
  resource_uuid: string;
  version_uuid: string;
  assignment_type: string;
  assignment_status_id: number;
  assignment_date: string;
  service_id: string;
  customer_name: string;
  organization_name: string;
  organization_id: string;
  customer_type_id: string;
  region_id: string;
  city_id: string;
  full_name: string;
  mobile_number: string;
  id_number: string;
  email: string;
  commercial_reg_id: string;
  unified_number: string;
  contact_number: string;
  contact_email: string;
  city: string;
  region: string;
  contact_name: string;
  service_instance_id: string;
  service_instance_name: string;
  service_type: string;
  service_category: string;
  l3_service: string;
  service: string;
  access_technology_id: string;
  access_technology: string;
  service_description: string;
  owner: string;
  purpose: string;
  created_at: string;
  updated_at: string;
};

export type PartitionDirection = "start" | "end";

export type PartitionResult = {
  allocated: Assignment;
  remaining: {
    start: string | null;
    end: string | null;
    size: number;
    label: string;
    resource_uuid: string | null;
  };
  message: string;
};

export type AssignmentPayload = {
  cidr: string;
  assignment_status_id: number;
  service_provider_id: string;
  service_provider_name: string;
  action_flag: string;
  cst_sync_status: string;
  ripe_sync_status: string;
  assignment_target_type: AssignmentTargetType;
  assignment_name: string;
  assignment_description: string;
  service_specification_id: string;
  service_specification_name: string;
  service_specification_type: string;
  service_instance_id: string;
  service_id: string;
  service_instance_name: string;
  service_type: string;
  service_category: string;
  product_specification_id: string;
  product_specification_name: string;
  product_offering_id: string;
  product_offering_name: string;
  customer_id: string;
  customer_name: string;
  customer_type: string;
  organization_name: string;
  organization_id: string;
  customer_type_id: string;
  region_id: string;
  city_id: string;
  full_name: string;
  mobile_number: string;
  id_number: string;
  email: string;
  customer_account_id: string;
  customer_segment: string;
  commercial_reg_id: string;
  unified_number: string;
  contact_number: string;
  contact_email: string;
  city: string;
  region: string;
  contact_name: string;
  internal_consumer_type: string;
  internal_business_unit: string;
  internal_application_id: string;
  internal_application_name: string;
  internal_environment: string;
  internal_owner_team: string;
  internal_cost_center: string;
  internal_project_code: string;
  internal_change_request_id: string;
  internal_justification: string;
  l3_service: string;
  service: string;
  owner: string;
  site: string;
  site_id: string;
  location_name: string;
  vrf_name: string;
  vlan_id: string;
  asn: string;
  routing_domain: string;
  security_zone: string;
  gateway_ip: string;
  dns_profile: string;
  dhcp_scope: string;
  nat_policy: string;
  qos_profile: string;
  access_technology_id: string;
  access_technology: string;
  service_description: string;
  requested_by: string;
  approved_by: string;
  approval_reference: string;
  reserved_until: string;
  assignment_purpose: string;
  environment: string;
  status: AssignmentStatus;
  assignment_date: string;
  notes: string;
};

export async function login(username: string, password: string) {
  const { data } = await api.post<{ token: string; username: string; role: string }>("/auth/login", { username, password });
  return data;
}

export async function getPools() {
  const { data } = await api.get<Pool[]>("/pools");
  return data;
}

export async function getAssignments() {
  const { data } = await api.get<Assignment[]>("/assignments");
  return data;
}

export async function getResources() {
  const { data } = await api.get<ResourceRecord[]>("/resources");
  return data;
}

export async function getUsers() {
  const { data } = await api.get<User[]>("/users");
  return data;
}

export async function getConflicts() {
  const { data } = await api.get<Conflict[]>("/conflicts");
  return data;
}

export async function getAuditEvents() {
  const { data } = await api.get<AuditEvent[]>("/audit");
  return data;
}

export async function getBulkBatches() {
  const { data } = await api.get<BulkBatch[]>("/bulk/batches");
  return data;
}

export async function getRipeConfig() {
  const { data } = await api.get<RipeConfig>("/ripe/config");
  return data;
}

export async function getRipeAllocatedPools() {
  const { data } = await api.get<RipeAllocatedPool[]>("/ripe/allocated-pools");
  return data;
}

export async function getRipeReportPools() {
  const { data } = await api.get<RipeAllocatedPool[]>("/ripe/reports/pools");
  return data;
}

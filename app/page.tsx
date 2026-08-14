"use client";

import { useEffect, useMemo, useState, type UIEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArchiveRestore,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  FileDown,
  Gauge,
  GitBranch,
  GitMerge,
  History,
  KeyRound,
  Layers3,
  ListTree,
  Loader2,
  Lock,
  LogOut,
  Network,
  Radar,
  RefreshCcw,
  Search,
  Settings,
  Shield,
  CheckCircle2,
  Upload,
  Users
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import axios from "axios";
import {
  api,
  Assignment,
  AssignmentPayload,
  AssignmentStatus,
  AuditEvent,
  createCstMigrationJobFromReview,
  createManualCstMigrationJob,
  BssDeltaSyncResponse,
  BulkBatch,
  BulkResult,
  Conflict,
  CstConfig,
  CstConfigPayload,
  CstMigrationReviewCreateResult,
  CstMigrationReviewResponse,
  CstResourceScope,
  CstSyncBatch,
  CstSyncJob,
  CstSyncSummary,
  CstSchedulerRun,
  CstTransactionLedger,
  DatabaseConnectionPayload,
  DatabaseConnectionStatus,
  DashboardSummary,
  getAssignmentsPage,
  getRegistryCoverageAssignments,
  getAuditEvents,
  getBulkBatches,
  getConflicts,
  acceptConflictAssignment,
  rejectConflictAssignment,
  autoResolveExactDuplicateConflicts,
  getCstBatches,
  getCstBatchJobs,
  getCstConfig,
  getCstJobs,
  getCstSchedulerRuns,
  getCstSummary,
  getCstTransactions,
  getDashboardSummary,
  getDatabaseConnectionStatus,
  getPools,
  getResources,
  getRipeAllocatedPools,
  getRipeConfig,
  getSiebelConfig,
  getUsers,
  login,
  PartitionDirection,
  PartitionResult,
  Pool,
  RipeAllocatedPool,
  RipeConfig,
  RipeConfigPayload,
  RipeDiscoveredRootPool,
  RipeDiscoveryResponse,
  RipePushResponse,
  RipeReportResponse,
  ResourceRecord,
  SiebelConfig,
  SiebelConfigPayload,
  SiebelLookupResponse,
  retryCstJob,
  retryFailedCstBatch,
  pushPendingCstJobs,
  reviewCstMigrationJobs,
  startPartialReassignment,
  runCstDayMinusOneSync,
  updateCstConfig,
  testCstConnection,
  testDatabaseConnection,
  testSiebelConnection,
  reconcileCstResources,
  User
} from "@/lib/api";
import { calculateContinuousFreeRanges, contains, ipToNumber, numberToIp, parseCidr, rangeToCidrs, toRange, type Range } from "@/lib/ipam";
import { beginKeycloakLogin, completeKeycloakLogin, isKeycloakConfigured, keycloakLogoutUrl } from "@/lib/keycloak";
import { cn, formatHosts } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_SIEBEL_QUERY = `SELECT
  sa.serial_num,
  sa.*,
  sa.status_cd sid_status,
  sp.name product_name,
  org.division_count account_number,
  org.name account_name,
  org.main_email_addr,
  org.main_ph_num,
  org.x_itc_b2b_arabic_name,
  org.x_itc_b2b_commercial_regis_num,
  org.x_itc_b2b_unified_number,
  org.x_itc_b2b_ap_identity_id,
  org.x_itc_b2b_ap_name,
  org.ou_type_cd,
  org.x_itc_acnt_sector,
  org.region account_region,
  con.cell_ph_num con_phone_num,
  con.email_addr con_email,
  con.per_title,
  con.fst_name,
  con.last_name,
  conx.attrib_36 contact_id_type,
  conx.attrib_37 contact_id_num,
  addr.addr_name,
  addr.city,
  addr.country
FROM
  siebel.s_asset sa,
  siebel.s_prod_int sp,
  siebel.s_org_ext org,
  siebel.s_contact con,
  siebel.s_contact_x conx,
  siebel.s_addr_per addr
WHERE 1 = 1
  AND org.pr_addr_id = addr.row_id
  AND con.row_id = conx.row_id
  AND org.pr_con_id = con.row_id
  AND sa.prod_id = sp.row_id
  AND sa.serv_acct_id = org.row_id
  AND sa.serial_num LIKE :service_id`;
type ViewKey =
  | "executive"
  | "registry"
  | "summary"
  | "lifecycle"
  | "reservations"
  | "assignments"
  | "capacity"
  | "subnet-operations"
  | "integrity"
  | "bulk"
  | "search"
  | "reports"
  | "administration";

type ResourceType = "LIR" | "Allocation" | "Subnet" | "IP Address";
type ResourceRole = "PUBLIC" | "PRIVATE";
type AdministrativeStatus = "AVAILABLE" | "RESERVED" | "ASSIGNED" | "RETIRED" | "HISTORICAL";
type RipeSyncStatus = "PENDING" | "SUBMITTED" | "SYNCHRONIZED" | "SUCCESS" | "FAILED" | "DECOMMISSION_PENDING" | "EXCLUDED" | "NOT_REQUIRED";
type CstSyncStatus = "NOT_CONFIGURED" | "NOT_REQUIRED" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "BLOCKED" | "SYNCHRONIZED";
type ResourceOwner = "Salam LIR" | "Business Customer" | "Residential Customer" | "Internal" | "Infrastructure" | "Datacenter" | "Peering" | "Cloud Services";

type ManagedResource = {
  id: string;
  uuid: string;
  parentId: string;
  cidr: string;
  serviceProviderId: string;
  serviceProviderName: string;
  asn: string;
  assignmentStatusId: number;
  serviceId: string;
  organizationName: string;
  organizationId: string;
  customerTypeId: string;
  customerType: string;
  subnetType: string;
  productClass: string;
  regionId: string;
  cityId: string;
  fullName: string;
  mobileNumber: string;
  idNumber: string;
  email: string;
  startIp: string;
  endIp: string;
  startNumber: number;
  endNumber: number;
  prefix: number;
  totalIps: number;
  usedIps: number;
  reservedIps: number;
  freeIps: number;
  utilization: number;
  type: ResourceType;
  role: "Allocation" | "Subnet" | "IP Address";
  allocatedPool: boolean;
  classification: ResourceRole;
  owner: ResourceOwner | string;
  status: AdministrativeStatus;
  administrativeStatus: AdministrativeStatus;
  ripeSyncRequired: boolean;
  ripeSyncStatus: RipeSyncStatus;
  cstSyncStatus: CstSyncStatus;
  actionFlag: string;
  accessTechnologyId: string;
  accessTechnology: string;
  serviceDescription: string;
  transactionId: string;
  sourceRegistry: string;
  lastUpdated: string;
  netname: string;
  description: string;
  country: string;
  maintainer: string;
  previousUuid: string;
  sourceUuid: string;
  successorUuid: string;
  operationType: string;
  source: Pool | Assignment | null;
};

type RegistryStats = {
  totalResources: number;
  totalPools: number;
  totalAssignments: number;
  totalReservations: number;
  utilization: number;
  availableCapacity: number;
  largestFreeBlock: ManagedResource | null;
  fragmentation: number;
  integrityIssues: number;
  pendingOperations: number;
};

type SearchFilterField =
  | "cidr"
  | "id"
  | "uuid"
  | "parentId"
  | "startIp"
  | "endIp"
  | "type"
  | "classification"
  | "owner"
  | "assignedTo"
  | "administrativeStatus"
  | "ripeSyncStatus"
  | "cstSyncStatus"
  | "transactionId"
  | "netname"
  | "description";

type SearchFilterCriterion = {
  id: string;
  field: SearchFilterField;
  value: string;
};

type PoolAssignmentDraft = {
  selectionMode: "subnet" | "range";
  parentPoolId: string;
  poolSearch: string;
  startIp: string;
  endIp: string;
  prefix: string;
};

type AppTheme = "default" | "white" | "green" | "salam";

const themeOptions: Array<{ id: AppTheme; label: string }> = [
  { id: "default", label: "Default" },
  { id: "white", label: "White" },
  { id: "green", label: "Green" },
  { id: "salam", label: "Salam" }
];

function storedAppTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "default";
  }
  const storedTheme = window.localStorage.getItem("ipam-theme");
  return storedTheme === "white" || storedTheme === "green" || storedTheme === "salam" || storedTheme === "default" ? storedTheme : "default";
}

function salamLogoForTheme(theme: AppTheme) {
  return theme === "default" ? "/salam-logo-white.png" : "/salam-logo.png";
}

const CST_SYNC_STATUS_OPTIONS: CstSyncStatus[] = ["PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED", "NOT_REQUIRED", "NOT_CONFIGURED", "SYNCHRONIZED"];

const SEARCH_FILTER_FIELDS: Array<{ value: SearchFilterField; label: string; mode: "select" | "text" }> = [
  { value: "cidr", label: "CIDR", mode: "text" },
  { value: "id", label: "Resource ID", mode: "text" },
  { value: "uuid", label: "Resource UUID", mode: "text" },
  { value: "parentId", label: "Parent Resource ID", mode: "text" },
  { value: "startIp", label: "Start IP", mode: "text" },
  { value: "endIp", label: "End IP", mode: "text" },
  { value: "type", label: "Type", mode: "select" },
  { value: "classification", label: "Classification", mode: "select" },
  { value: "owner", label: "Owner", mode: "select" },
  { value: "assignedTo", label: "Assigned To", mode: "select" },
  { value: "administrativeStatus", label: "Status", mode: "select" },
  { value: "ripeSyncStatus", label: "RIPE Status", mode: "select" },
  { value: "cstSyncStatus", label: "CST Sync Status", mode: "select" },
  { value: "transactionId", label: "Transaction ID", mode: "text" },
  { value: "netname", label: "Netname", mode: "text" },
  { value: "description", label: "Description", mode: "text" }
];


const CST_BULK_ASSIGNMENT_TEMPLATE = [
  "assignmentType,cidr,startIp,endIp,size,status,assignmentDate,customerName,organizationName,organizationId,commercialRegId,unifiedNumber,customerTypeId,customerType,subnetType,productClass,regionId,cityId,fullName,mobileNumber,idNumber,email,contactName,contactNumber,contactEmail,customerId,serviceId,serviceDescription,accessTechnologyId,owner,assignmentPurpose,site,city,region,notes",
  "BUSINESS,5.42.224.0/30,,,4,3,2026-06-03,Example Enterprise,Example Enterprise LLC,1010112916,1010112916,,2,CORP,LAN1,14,41,Primary Contact,+966501234567,1234567890,contact@example.com,Primary Contact,+966501234567,contact@example.com,CUST-10001,SVC-10001,Enterprise L3 service,1,Business Customer,Customer L3 service,Riyadh HQ,Riyadh,Riyadh,Ready business example",
  "INTERNAL,5.42.224.4/30,,,4,2,2026-06-03,,,,,,,,,,,,,,,,,,,,Internal firewall management,,,,,,,Ready internal example"
].join("\n");
const BULK_SUBNET_TEMPLATE = [
  "cidr,StartIP,EndIP,Total,name,region,maintainer,description",
  "5.42.226.0/24,,,,Orbit unassigned subnet,Riyadh,ORBIT-MNT,Unassigned subnet owned by Orbit maintainer",
  ",5.42.227.0,5.42.227.255,256,ITC unassigned range,Riyadh,ITC-NOC-MNT,Range import example"
].join("\n");
const navigation: Array<{ id: ViewKey; label: string; icon: React.ReactNode }> = [
  { id: "executive", label: "Home", icon: <Gauge className="h-4 w-4" /> },
  { id: "registry", label: "Resource Registry", icon: <Database className="h-4 w-4" /> },
  { id: "reservations", label: "Reservation Management", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "assignments", label: "Assignment Management", icon: <Users className="h-4 w-4" /> },
  { id: "capacity", label: "Capacity Management", icon: <Radar className="h-4 w-4" /> },
  { id: "subnet-operations", label: "Subnet Operations", icon: <GitBranch className="h-4 w-4" /> },
  { id: "integrity", label: "Integrity & Conflicts", icon: <AlertTriangle className="h-4 w-4" /> },
  { id: "bulk", label: "Bulk Operations", icon: <Upload className="h-4 w-4" /> },
  { id: "search", label: "Global Search", icon: <Search className="h-4 w-4" /> },
  { id: "reports", label: "Reporting", icon: <FileDown className="h-4 w-4" /> },
  { id: "administration", label: "Administration", icon: <Shield className="h-4 w-4" /> }
];

const viewRoutes: Record<ViewKey, string> = {
  executive: "/home",
  registry: "/resource-registry",
  summary: "/resource-summary",
  lifecycle: "/lifecycle-management",
  reservations: "/reservation-management",
  assignments: "/assignment-management",
  capacity: "/capacity-management",
  "subnet-operations": "/subnet-operations",
  integrity: "/integrity-conflicts",
  bulk: "/bulk-operations",
  search: "/global-search",
  reports: "/reporting",
  administration: "/administration"
};

const routeAliases: Record<string, ViewKey> = {
  "": "executive",
  dashboard: "executive",
  executive: "executive",
  home: "executive",
  resourceregistry: "registry",
  "resource-registry": "registry",
  registry: "registry",
  resourcesummary: "summary",
  "resource-summary": "summary",
  summary: "summary",
  lifecyclemanagement: "lifecycle",
  "lifecycle-management": "lifecycle",
  lifecycle: "lifecycle",
  reservationmanagement: "reservations",
  "reservation-management": "reservations",
  reservations: "reservations",
  assignmentmanagement: "assignments",
  "assignment-management": "assignments",
  assignments: "assignments",
  capacitymanagement: "capacity",
  "capacity-management": "capacity",
  capacity: "capacity",
  subnetoperations: "subnet-operations",
  "subnet-operations": "subnet-operations",
  integrityconflicts: "integrity",
  "integrity-conflicts": "integrity",
  integrity: "integrity",
  bulkoperations: "bulk",
  "bulk-operations": "bulk",
  bulk: "bulk",
  globalsearch: "search",
  "global-search": "search",
  search: "search",
  reporting: "reports",
  reports: "reports",
  administration: "administration",
  admin: "administration"
};

const lifecycleStates: AdministrativeStatus[] = ["AVAILABLE", "RESERVED", "ASSIGNED", "RETIRED", "HISTORICAL"];
const userSelectableStatuses: AdministrativeStatus[] = ["AVAILABLE", "RESERVED", "ASSIGNED", "RETIRED"];
const allowedTransitions: Record<AdministrativeStatus, AdministrativeStatus[]> = {
  AVAILABLE: ["RESERVED", "ASSIGNED", "RETIRED"],
  RESERVED: ["AVAILABLE", "ASSIGNED"],
  ASSIGNED: ["AVAILABLE"],
  RETIRED: [],
  HISTORICAL: []
};
const resourceOwners: ResourceOwner[] = ["Business Customer", "Residential Customer", "Internal", "Infrastructure", "Datacenter", "Peering", "Cloud Services"];
const assignmentStatuses: AssignmentStatus[] = ["Reserved", "Planned", "Active", "Retiring", "Quarantined", "Blocked"];
const REGISTRY_RENDER_LIMIT = 200;
const NAVIGATOR_RENDER_LIMIT = 250;
const CHILD_RENDER_LIMIT = 100;
const REPORT_BATCH_SIZE = 100;
const ownerToAssignmentTarget: Record<string, AssignmentPayload["assignment_target_type"]> = {
  "Business Customer": "business_customer",
  "Residential Customer": "individual",
  Internal: "internal",
  Infrastructure: "internal",
  Datacenter: "internal",
  Peering: "internal",
  "Cloud Services": "internal"
};

const assignmentTargetLabels: Record<AssignmentPayload["assignment_target_type"], string> = {
  business_customer: "Business customer",
  internal: "Internal",
  individual: "Individual customer"
};

const assignmentStatusByTarget: Record<AssignmentPayload["assignment_target_type"], number> = {
  business_customer: 3,
  internal: 2,
  individual: 4
};

const assignedToOptions: AssignmentPayload["assignment_target_type"][] = ["internal", "business_customer", "individual"];
const operationalStatuses: AssignmentStatus[] = ["Active", "Blocked"];
const lirCustomerTypeOptions = [
  { value: "CORP", label: "CORP" },
  { value: "RESI", label: "RESI" },
  { value: "COMP", label: "COMP" },
  { value: "NA", label: "NA" }
];
const subnetTypeOptions = [
  ...Array.from({ length: 8 }, (_, index) => ({ value: `LAN${index + 1}`, label: `LAN${index + 1}` })),
  ...Array.from({ length: 3 }, (_, index) => ({ value: `PTP${index + 1}`, label: `PTP${index + 1}` })),
  { value: "NA", label: "NA" }
];
const customerTypeOptions = [
  { value: "1", label: "1 Government" },
  { value: "2", label: "2 Non-Government" }
];
const accessTechnologyOptions = [
  { value: "1", label: "FTTH" },
  { value: "2", label: "ADSL" },
  { value: "3", label: "Mobile" },
  { value: "4", label: "FWA" }
];
const accessTechnologyLabels = Object.fromEntries(accessTechnologyOptions.map((option) => [option.value, option.label]));
const pendingBssBusinessDefaults: Partial<AssignmentPayload> = {
  service_id: "BSS-PENDING-SERVICE",
  service_instance_id: "BSS-PENDING-SERVICE",
  service_instance_name: "Pending BSS service",
  customer_name: "Pending BSS Business Customer",
  organization_name: "Pending BSS Organization",
  organization_id: "BSS-PENDING-ORG",
  customer_type_id: "2",
  region_id: "BSS-PENDING-REGION",
  city_id: "BSS-PENDING-CITY",
  full_name: "Pending BSS Contact",
  mobile_number: "0000000000",
  id_number: "BSS-PENDING-ID",
  email: "pending-bss@salam.sa",
  commercial_reg_id: "BSS-PENDING-CR",
  unified_number: "BSS-PENDING-UNIFIED",
  contact_name: "Pending BSS Contact",
  contact_number: "0000000000",
  contact_email: "pending-bss@salam.sa",
  city: "BSS-PENDING-CITY",
  region: "BSS-PENDING-REGION",
  site: "BSS Pending Site",
  customer_type: "CORP",
  subnet_type: "NA",
  customer_segment: "Enterprise",
  l3_service: "MPLS L3VPN",
  service: "Business IP assignment",
  service_description: "Business IP assignment pending BSS sync"
};

const businessBssFields: AssignmentFieldDefinition[] = [
  { key: "bss_customer_id", label: "bssCustomerId", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "customer_type_id", label: "customerTypeId", placeholder: "Select CST customer type", required: true, options: customerTypeOptions },
  { key: "customer_type", label: "customerType", placeholder: "Select LIR customer type", options: lirCustomerTypeOptions },
  { key: "subnet_type", label: "subnetType", placeholder: "Select subnet type", options: subnetTypeOptions },
  { key: "product_class", label: "Product Class", placeholder: "Product class from Siebel/IP Tool" },
  { key: "service_description", label: "serviceDescription", placeholder: "Auto-populated based on Assigned to" },
  { key: "organization_name", label: "organizationName", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "organization_id", label: "organizationId", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "region_id", label: "regionId", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "city_id", label: "cityId", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "full_name", label: "fullName", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "mobile_number", label: "mobileNumber", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "id_number", label: "idNumber", placeholder: "Auto sync from BSS after assignment", disabled: true },
  { key: "email", label: "email", placeholder: "Auto sync from BSS after assignment", disabled: true }
];

const individualBssFields: AssignmentFieldDefinition[] = [
  { key: "access_technology_id", label: "accessTechnology", placeholder: "Select access technology", options: accessTechnologyOptions },
  { key: "service_description", label: "serviceDescription", placeholder: "Auto-populated based on Assigned to" }
];

const internalAssignmentFields: AssignmentFieldDefinition[] = [
  { key: "service_description", label: "serviceDescription", placeholder: "Internal purpose / service description", required: true },
  { key: "internal_business_unit", label: "Business unit", placeholder: "Network, IT, Cloud, Security" },
  { key: "internal_application_id", label: "Application ID", placeholder: "Internal application ID" },
  { key: "internal_application_name", label: "Application name", placeholder: "Internal application name", required: true },
  { key: "internal_environment", label: "Environment", placeholder: "Production, DR, Lab" },
  { key: "internal_owner_team", label: "Owner team", placeholder: "Owning team" },
  { key: "internal_cost_center", label: "Cost center", placeholder: "Cost center" },
  { key: "internal_project_code", label: "Project code", placeholder: "Project code" },
  { key: "access_technology", label: "accessTechnology", placeholder: "MPLS, Core, Cloud, Management" },
  { key: "service_id", label: "serviceId", placeholder: "Internal service reference" }
];

const assignmentServiceFields: AssignmentFieldDefinition[] = [
  { key: "service_instance_id", label: "Transaction / service instance ID", placeholder: "Service instance / order reference" },
  { key: "service_instance_name", label: "Service instance name", placeholder: "Service instance name" },
  { key: "service_type", label: "Service type", placeholder: "CustomerFacingService / ResourceFacingService" },
  { key: "service_category", label: "Service category", placeholder: "L3 Service, IP Address Resource" },
  { key: "l3_service", label: "L3 service", placeholder: "MPLS L3VPN, Internet, DIA" },
  { key: "service", label: "Service label", placeholder: "Short service label" }
];

const assignmentContactFields: AssignmentFieldDefinition[] = [
  { key: "commercial_reg_id", label: "Commercial reg ID", placeholder: "Commercial registration ID" },
  { key: "unified_number", label: "Unified number", placeholder: "Unified number" },
  { key: "contact_name", label: "Contact name", placeholder: "Contact name" },
  { key: "contact_number", label: "Contact number", placeholder: "Contact number" },
  { key: "contact_email", label: "Contact email", placeholder: "Contact email" },
  { key: "city", label: "City", placeholder: "City" },
  { key: "region", label: "Region", placeholder: "Region" },
  { key: "site", label: "Site", placeholder: "Site name" }
];

const emptyAssignment: AssignmentPayload = {
  cidr: "",
  assignment_status_id: 3,
  service_provider_id: "5",
  service_provider_name: "Salam",
  action_flag: "N",
  cst_sync_status: "PENDING",
  ripe_sync_status: "PENDING",
  assignment_target_type: "business_customer",
  assignment_name: "Resource assignment",
  assignment_description: "",
  service_specification_id: "IP-RESOURCE-SVC",
  service_specification_name: "IP Resource Service",
  service_specification_type: "ResourceFacingServiceSpecification",
  service_instance_id: "",
  service_id: "",
  service_instance_name: "",
  service_type: "ResourceFacingService",
  service_category: "IP Address Resource",
  service_order_id: "",
  siebel_order_number: "",
  bss_customer_id: "",
  siebel_last_sync_at: "",
  siebel_last_checked_at: "",
  siebel_payload_hash: "",
  siebel_payload_json: "",
  service_characteristics: "",
  product_specification_id: "",
  product_specification_name: "",
  product_class: "",
  product_offering_id: "",
  product_offering_name: "",
  product_instance_id: "",
  customer_id: "",
  customer_name: "",
  customer_type: "NA",
  subnet_type: "NA",
  organization_name: "",
  organization_id: "",
  customer_type_id: "",
  region_id: "",
  city_id: "",
  full_name: "",
  mobile_number: "",
  id_number: "",
  email: "",
  customer_account_id: "",
  customer_segment: "Enterprise",
  commercial_reg_id: "",
  unified_number: "",
  contact_number: "",
  contact_email: "",
  city: "",
  region: "",
  contact_name: "",
  internal_consumer_type: "",
  internal_business_unit: "",
  internal_application_id: "",
  internal_application_name: "",
  internal_environment: "",
  internal_owner_team: "",
  internal_cost_center: "",
  internal_project_code: "",
  internal_change_request_id: "",
  internal_justification: "",
  l3_service: "IPv4 Number Resource",
  service: "",
  owner: "Salam LIR",
  site: "",
  site_id: "",
  location_name: "",
  vrf_name: "",
  vlan_id: "",
  asn: "",
  routing_domain: "",
  security_zone: "",
  gateway_ip: "",
  dns_profile: "",
  dhcp_scope: "",
  nat_policy: "",
  qos_profile: "",
  access_technology_id: "",
  access_technology: "",
  service_description: "",
  ...pendingBssBusinessDefaults,
  requested_by: "",
  approved_by: "",
  approval_reference: "",
  reserved_until: "",
  assignment_purpose: "",
  environment: "Production",
  status: "Active",
  assignment_date: "",
  notes: ""
};

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState("");
  const [username, setUsername] = useState("ipam-admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [keycloakEnabled, setKeycloakEnabled] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(storedAppTheme);

  useEffect(() => {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = theme;
    }
    window.localStorage.setItem("ipam-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const finish = (token: string) => {
      if (!cancelled) {
        setSession(token);
        setMounted(true);
      }
    };

    setKeycloakEnabled(isKeycloakConfigured());
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      finish(window.localStorage.getItem("ipam-token") ?? "");
      return;
    }

    completeKeycloakLogin(code, state)
      .then((result) => {
        window.localStorage.setItem("ipam-token", result.accessToken);
        window.localStorage.setItem("ipam-refresh-token", result.refreshToken ?? "");
        window.localStorage.setItem("ipam-username", result.username);
        window.localStorage.setItem("ipam-role", "admin");
        window.localStorage.setItem("ipam-auth-provider", "keycloak");
        window.history.replaceState({}, document.title, window.location.pathname);
        finish(result.accessToken);
      })
      .catch((error) => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setMessage(`Keycloak login failed: ${errorMessage(error)}`);
        finish("");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted) {
    return <ShellLoading />;
  }

  if (!session) {
    return (
      <LoginScreen
        username={username}
        password={password}
        message={message}
        keycloakEnabled={keycloakEnabled}
        theme={theme}
        onUsername={setUsername}
        onPassword={setPassword}
        onKeycloakLogin={() => beginKeycloakLogin().catch((error) => setMessage(`Keycloak login failed: ${errorMessage(error)}`))}
        onSubmit={async () => {
          try {
            const result = await login(username.trim(), password);
            window.localStorage.setItem("ipam-token", result.token);
            window.localStorage.setItem("ipam-username", result.username);
            window.localStorage.setItem("ipam-role", result.role);
            window.localStorage.setItem("ipam-auth-provider", "local");
            setSession(result.token);
            setPassword("");
            setMessage("");
          } catch (error) {
            setMessage(`Login failed: ${errorMessage(error)}. Confirm FastAPI is running on port 3001.`);
          }
        }}
      />
    );
  }

  return (
    <RegistryWorkspace
      theme={theme}
      onTheme={setTheme}
      onLogout={() => {
        const provider = window.localStorage.getItem("ipam-auth-provider");
        window.localStorage.removeItem("ipam-token");
        window.localStorage.removeItem("ipam-refresh-token");
        window.localStorage.removeItem("ipam-username");
        window.localStorage.removeItem("ipam-role");
        window.localStorage.removeItem("ipam-auth-provider");
        setSession("");
        if (provider === "keycloak") {
          const logoutUrl = keycloakLogoutUrl();
          if (logoutUrl) {
            window.location.assign(logoutUrl);
          }
        }
      }}
    />
  );
}

function ShellLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src="/salam-favicon.png" alt="Salam" className="h-16 w-16 rounded-md object-contain" />
          <CardTitle>LIR Resource Registry</CardTitle>
          <CardDescription>Loading registry session</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

function cstBaseUrlFromHostPort(host: string | undefined, port: number | string | undefined) {
  const cleanHost = String(host ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0];
  const cleanPort = Number(port) || 443;
  return cleanHost ? `https://${cleanHost}:${cleanPort}` : "";
}

function cstBaseUrlUsesPlaceholderHost(baseUrl: string | undefined) {
  const value = String(baseUrl ?? "").trim();
  if (!value) {
    return true;
  }
  try {
    return new URL(value).hostname.toLowerCase() === "host";
  } catch {
    return value.toLowerCase() === "host" || value.toLowerCase().startsWith("https://host") || value.toLowerCase().startsWith("http://host");
  }
}

function normalizeCstConfigFormForSave(form: CstConfigPayload): CstConfigPayload {
  const derivedBaseUrl = cstBaseUrlFromHostPort(form.host, form.port);
  return {
    ...form,
    base_url: derivedBaseUrl
  };
}

function LoginScreen(props: {
  username: string;
  password: string;
  message: string;
  keycloakEnabled: boolean;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  onKeycloakLogin: () => void;
  theme: AppTheme;
}) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src={salamLogoForTheme(props.theme)} alt="Salam" className="h-10 w-44 object-contain" />
          <CardTitle>LIR Resource Registry</CardTitle>
          <CardDescription>Authoritative IPv4 number resource registry</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {props.keycloakEnabled ? (
            <Button onClick={props.onKeycloakLogin}>
              <Shield className="h-4 w-4" />
              Login with Keycloak
            </Button>
          ) : null}
          <Input name="ipam-application-username" autoComplete="username" value={props.username} onChange={(event) => props.onUsername(event.target.value)} placeholder="Application username" />
          <div className="relative">
            <Input className="pr-11" name="ipam-application-password" autoComplete="current-password" value={props.password} onChange={(event) => props.onPassword(event.target.value)} placeholder="Application password" type={showPassword ? "text" : "password"} />
            <button className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button onClick={props.onSubmit}>
            <KeyRound className="h-4 w-4" />
            Login
          </Button>
          {props.message ? <p className="text-sm text-red-300">{props.message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}

function RegistryWorkspace({ theme, onTheme, onLogout }: { theme: AppTheme; onTheme: (theme: AppTheme) => void; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewKey>("executive");
  const [routeReady, setRouteReady] = useState(false);
  const [signedInUser, setSignedInUser] = useState("admin");
  const [signedInRole, setSignedInRole] = useState<User["role"]>("operator");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchFilters, setGlobalSearchFilters] = useState<SearchFilterCriterion[]>([]);
  const [activeRegistryPanel, setActiveRegistryPanel] = useState<RegistryPanelId>("subnet-navigator");
  const [poolForm, setPoolForm] = useState({ cidr: "10.24.0.0/16", name: "Private IPv4 Allocation", region: "Riyadh", description: "Private allocation registered locally. Public allocations are synchronized from RIPE." });
  const [assignmentForm, setAssignmentForm] = useState<AssignmentPayload>({ ...emptyAssignment, cidr: "", customer_name: "", assignment_date: today() });
  const [poolAssignmentDraft, setPoolAssignmentDraft] = useState<PoolAssignmentDraft>({ selectionMode: "subnet", parentPoolId: "", poolSearch: "", startIp: "", endIp: "", prefix: "24" });
  const [reservationForm, setReservationForm] = useState({ cidr: "5.42.225.0/24", purpose: "Enterprise Expansion", requestedBy: "", expiryDate: "", notes: "" });
  const [splitForm, setSplitForm] = useState({ poolId: "", search: "", prefix: "24", direction: "start" as PartitionDirection });
  const [mergeForm, setMergeForm] = useState({ leftPoolId: "", rightPoolId: "", leftSearch: "", rightSearch: "" });
  const [bulkPoolCsv, setBulkPoolCsv] = useState(BULK_SUBNET_TEMPLATE);
  const [bulkPoolAllocated, setBulkPoolAllocated] = useState(false);
  const [bulkAssignmentAllowConflicts, setBulkAssignmentAllowConflicts] = useState(false);
  const [bulkAssignmentCsv, setBulkAssignmentCsv] = useState(CST_BULK_ASSIGNMENT_TEMPLATE);
  const [ripeConfigForm, setRipeConfigForm] = useState<RipeConfigPayload>({ base_url: "https://rest.db.ripe.net", auth_type: "Basic Authentication", username: "", password: "", connection_timeout: 10, read_timeout: 30, default_maintainer: "ITC-NOC-MNT" });
  const [siebelConfigForm, setSiebelConfigForm] = useState<SiebelConfigPayload>({ username: "LIR_USER", password: "", dsn: "172.31.23.101:1525/SIDB", connection_timeout: 10, query_sql: DEFAULT_SIEBEL_QUERY });
  const [databaseConnectionForm, setDatabaseConnectionForm] = useState<DatabaseConnectionPayload>({ host: "localhost", port: 5432, database: "lir", username: "lir_app", password: "", ssl_mode: "prefer", connect_timeout: 10 });
  const [cstResourceScope, setCstResourceScope] = useState<CstResourceScope>("all");
  const [cstMigrationReviewOpen, setCstMigrationReviewOpen] = useState(false);
  const [cstMigrationReview, setCstMigrationReview] = useState<CstMigrationReviewResponse | null>(null);
  const [cstMigrationReviewLoading, setCstMigrationReviewLoading] = useState(false);
  const [cstMigrationReviewPage, setCstMigrationReviewPage] = useState(1);
  const [cstMigrationReviewFilters, setCstMigrationReviewFilters] = useState({ search: "", assignment_status: "all", transaction_type: "all", validation_status: "all", created_from: "", created_to: "" });
  const [cstReviewSelectedIds, setCstReviewSelectedIds] = useState<string[]>([]);
  const [cstReviewExcludedIds, setCstReviewExcludedIds] = useState<string[]>([]);
  const [cstReviewCreateResult, setCstReviewCreateResult] = useState<CstMigrationReviewCreateResult | null>(null);
  const [cstConfigForm, setCstConfigForm] = useState<CstConfigPayload>({
    enabled: true,
    auto_execute: true,
    scheduled_sync_enabled: true,
    send_enabled: true,
    update_enabled: true,
    delete_enabled: true,
    get_enabled: true,
    resource_scope: "all",
    integration_mode: "Real API",
    host: "cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local",
    port: 443,
    base_url: "https://cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local:443",
    token_path: "/api/rest/v1.0/OAuthToken",
    send_path: "/api/rest/v1.0/LIRDataService/SendLIRData",
    update_path: "/api/rest/v1.0/LIRDataService/UpdateLIRData",
    delete_path: "/api/rest/v1.0/LIRDataService/DeleteLIRData",
    get_path: "/api/rest/v1.0/LIRDataService/GetLIRData",
    auth_username: "",
    accept_language: "EN",
    auth_password: "",
    api_access_key: "",
    user_key: "",
    verify_ssl: false,
    connection_timeout: 10,
    read_timeout: 30,
    token_refresh_buffer_seconds: 300,
    batch_size_limit: 500,
    send_payload_batch_size: 1,
    hourly_request_limit: 1000
  });
  const [cstConfigFormDirty, setCstConfigFormDirty] = useState(false);
  const [ripePoolCsv, setRipePoolCsv] = useState("pool_name,cidr,allocation_type,source,created_date\nRIPE Allocation 5.42.224.0,5.42.224.0/19,RIPE Allocated Pool,RIPE Database,2026-06-01");
  const [ripeReportForm, setRipeReportForm] = useState({ dateFrom: "", dateTo: "", reportType: "RIPE Assignment Report" });
  const [ripeReportResult, setRipeReportResult] = useState<RipeReportResponse | null>(null);
  const [ripeDiscoveryResult, setRipeDiscoveryResult] = useState<RipeDiscoveryResponse | null>(null);
  const [ripeDiscoveryStatus, setRipeDiscoveryStatus] = useState<"idle" | "running" | "complete">("idle");
  const [ripeDiscoveryActionKey, setRipeDiscoveryActionKey] = useState("");
  const [ripePushResourceId, setRipePushResourceId] = useState("");
  const [ripeReportStatus, setRipeReportStatus] = useState<"idle" | "running" | "complete">("idle");
  const [bulkPoolFileName, setBulkPoolFileName] = useState("");
  const [bulkAssignmentFileName, setBulkAssignmentFileName] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "operator" as User["role"] });
  const [passwordReset, setPasswordReset] = useState({ userId: "", password: "" });
  const [confirm, setConfirm] = useState<{ title: string; detail: string; action: () => void; destructive?: boolean } | null>(null);
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null);
  const [lastGoodAssignments, setLastGoodAssignments] = useState<Assignment[]>([]);
  const [lastGoodRegistryAssignments, setLastGoodRegistryAssignments] = useState<Assignment[]>([]);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignmentPageSize, setAssignmentPageSize] = useState(100);
  const [assignmentSearch, setAssignmentSearch] = useState("");

  const liveQueryOptions = { staleTime: 30000, refetchOnMount: true as const, refetchOnWindowFocus: false, retry: 3, retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000) };
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: getPools, ...liveQueryOptions });
  const assignmentPageNeeded = view === "assignments";
  const registryCoverageNeeded = view !== "executive" && view !== "assignments" && view !== "administration";
  const assignmentsQuery = useQuery({
    queryKey: ["assignments", assignmentPage, assignmentPageSize, assignmentSearch],
    queryFn: () => getAssignmentsPage({ page: assignmentPage, page_size: assignmentPageSize, search: assignmentSearch }),
    enabled: assignmentPageNeeded,
    ...liveQueryOptions
  });
  const registryAssignmentsQuery = useQuery({ queryKey: ["assignments", "registry-coverage"], queryFn: getRegistryCoverageAssignments, enabled: registryCoverageNeeded, ...liveQueryOptions });
  const persistedResourcesQuery = useQuery({ queryKey: ["resources"], queryFn: getResources, ...liveQueryOptions });
  const dashboardSummaryQuery = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboardSummary, ...liveQueryOptions });
  const conflictsQuery = useQuery({ queryKey: ["conflicts"], queryFn: getConflicts, ...liveQueryOptions });
  const auditQuery = useQuery({ queryKey: ["audit"], queryFn: getAuditEvents, ...liveQueryOptions });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: getUsers, ...liveQueryOptions });
  const ripeConfigQuery = useQuery({ queryKey: ["ripe-config"], queryFn: getRipeConfig, ...liveQueryOptions });
  const siebelConfigQuery = useQuery({ queryKey: ["siebel-config"], queryFn: getSiebelConfig, ...liveQueryOptions });
  const ripeAllocatedPoolsQuery = useQuery({ queryKey: ["ripe-allocated-pools"], queryFn: getRipeAllocatedPools, ...liveQueryOptions });
  const databaseStatusQuery = useQuery({ queryKey: ["database-status"], queryFn: getDatabaseConnectionStatus, ...liveQueryOptions });
  const cstConfigQuery = useQuery({ queryKey: ["cst-config"], queryFn: getCstConfig, ...liveQueryOptions });
  const cstSummaryQuery = useQuery({ queryKey: ["cst-summary"], queryFn: getCstSummary, ...liveQueryOptions });
  const cstBatchesQuery = useQuery({ queryKey: ["cst-batches"], queryFn: () => getCstBatches({ limit: 1000 }), ...liveQueryOptions });
  const cstSchedulerRunsQuery = useQuery({ queryKey: ["cst-scheduler-runs"], queryFn: getCstSchedulerRuns, ...liveQueryOptions });
  const cstJobsQuery = useQuery({
    queryKey: ["cst-jobs"],
    queryFn: getCstJobs,
    refetchInterval: (query) => query.state.data?.some((job) => ["PENDING", "RUNNING"].includes(job.status)) ? 3000 : false,
    ...liveQueryOptions
  });
  const cstTransactionsQuery = useQuery({ queryKey: ["cst-transactions"], queryFn: getCstTransactions, ...liveQueryOptions });
  const bulkBatchesQuery = useQuery({
    queryKey: ["bulk-batches"],
    queryFn: getBulkBatches,
    refetchInterval: (query) => query.state.data?.some((batch) => batch.status === "RUNNING") ? 3000 : false,
    ...liveQueryOptions
  });

  const pools = poolsQuery.data ?? [];
  const assignmentPageData = assignmentsQuery.data ?? null;
  const assignments = assignmentPageData?.items ?? lastGoodAssignments;
  const registryAssignments = registryAssignmentsQuery.data ?? lastGoodRegistryAssignments ?? assignments;
  const persistedResources = persistedResourcesQuery.data ?? [];
  const dashboardSummary = dashboardSummaryQuery.data ?? null;
  const assignmentTotal = dashboardSummary?.assignment_records ?? assignmentPageData?.total ?? registryAssignments.length ?? lastGoodAssignments.length;
  const conflicts = conflictsQuery.data ?? [];
  const auditEvents = auditQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const ripeConfig = ripeConfigQuery.data ?? null;
  const siebelConfig = siebelConfigQuery.data ?? null;
  const ripeAllocatedPools = ripeAllocatedPoolsQuery.data ?? [];
  const databaseConnectionStatus = databaseStatusQuery.data ?? null;
  const cstConfig = cstConfigQuery.data ?? null;
  const cstSummary = cstSummaryQuery.data ?? null;
  const cstBatches = cstBatchesQuery.data ?? [];
  const cstJobs = cstJobsQuery.data ?? [];
  const cstSchedulerRuns = cstSchedulerRunsQuery.data ?? [];
  const cstTransactions = cstTransactionsQuery.data ?? [];
  const bulkBatches = bulkBatchesQuery.data ?? [];

  const updateCstConfigForm = (value: CstConfigPayload) => {
    setCstConfigFormDirty(true);
    setCstConfigForm(value);
  };

  useEffect(() => {
    if (assignmentsQuery.data) {
      setLastGoodAssignments(assignmentsQuery.data.items);
    }
  }, [assignmentsQuery.data]);

  useEffect(() => {
    if (registryAssignmentsQuery.data) {
      setLastGoodRegistryAssignments(registryAssignmentsQuery.data);
    }
  }, [registryAssignmentsQuery.data]);

  useEffect(() => {
    setSignedInUser(window.localStorage.getItem("ipam-username") ?? "admin");
    const storedRole = window.localStorage.getItem("ipam-role");
    setSignedInRole(storedRole === "admin" || storedRole === "viewer" ? storedRole : "operator");
  }, []);

  useEffect(() => {
    if (!ripeConfig) {
      return;
    }
    setRipeConfigForm({
      base_url: ripeConfig.base_url,
      auth_type: ripeConfig.auth_type,
      username: ripeConfig.username,
      password: "",
      connection_timeout: ripeConfig.connection_timeout,
      read_timeout: ripeConfig.read_timeout,
      default_maintainer: ripeConfig.default_maintainer
    });
  }, [ripeConfig]);

  useEffect(() => {
    if (!siebelConfig) {
      return;
    }
    setSiebelConfigForm({
      username: siebelConfig.username,
      password: "",
      dsn: siebelConfig.dsn,
      connection_timeout: siebelConfig.connection_timeout,
      query_sql: siebelConfig.query_sql || DEFAULT_SIEBEL_QUERY
    });
  }, [siebelConfig]);

  useEffect(() => {
    if (!cstConfig || cstConfigFormDirty) {
      return;
    }
    setCstConfigForm({
      enabled: cstConfig.enabled,
      auto_execute: cstConfig.auto_execute,
      scheduled_sync_enabled: cstConfig.scheduled_sync_enabled,
      send_enabled: cstConfig.send_enabled,
      update_enabled: cstConfig.update_enabled,
      delete_enabled: cstConfig.delete_enabled,
      get_enabled: cstConfig.get_enabled,
      resource_scope: cstConfig.resource_scope ?? "all",
      integration_mode: cstConfig.integration_mode,
      host: cstConfig.host,
      port: cstConfig.port,
      base_url: cstBaseUrlUsesPlaceholderHost(cstConfig.base_url) ? cstBaseUrlFromHostPort(cstConfig.host, cstConfig.port) : cstConfig.base_url,
      token_path: cstConfig.token_path,
      send_path: cstConfig.send_path,
      update_path: cstConfig.update_path,
      delete_path: cstConfig.delete_path,
      get_path: cstConfig.get_path,
      auth_username: cstConfig.auth_username,
      accept_language: cstConfig.accept_language,
      auth_password: "",
      api_access_key: "",
      user_key: "",
      verify_ssl: false,
      connection_timeout: cstConfig.connection_timeout,
      read_timeout: cstConfig.read_timeout,
      token_refresh_buffer_seconds: cstConfig.token_refresh_buffer_seconds,
      batch_size_limit: cstConfig.batch_size_limit,
      send_payload_batch_size: cstConfig.send_payload_batch_size,
      hourly_request_limit: cstConfig.hourly_request_limit
    });
    setCstResourceScope(cstConfig.resource_scope ?? "all");
  }, [cstConfig, cstConfigFormDirty]);

  useEffect(() => {
    const applyRoute = () => {
      const nextView = viewFromPath(window.location.pathname);
      setView(nextView);
      const resourceId = new URLSearchParams(window.location.search).get("resourceId");
      if (resourceId) {
        setSelectedResourceId(resourceId);
      }
      setRouteReady(true);
    };
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);

  const resources = useMemo(() => buildRegistryResources(pools, registryAssignments, persistedResources), [pools, registryAssignments, persistedResources]);
  const stats = useMemo(() => buildRegistryStats(resources, conflicts), [resources, conflicts]);
  const selectedResource = resources.find((resource) => resource.id === selectedResourceId) ?? resources[0] ?? null;
  const usingCachedAssignments = assignmentsQuery.isError && lastGoodAssignments.length > 0;
  const registryUnavailable =
    (poolsQuery.isError && poolsQuery.data === undefined) ||
    (registryCoverageNeeded && registryAssignmentsQuery.isError && registryAssignmentsQuery.data === undefined && lastGoodRegistryAssignments.length === 0) ||
    (assignmentPageNeeded && assignmentsQuery.isError && assignmentsQuery.data === undefined && lastGoodAssignments.length === 0);

  useEffect(() => {
    if (!selectedResourceId && resources[0]) {
      setSelectedResourceId(resources[0].id);
    }
  }, [resources, selectedResourceId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pools"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments"] });
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    void queryClient.invalidateQueries({ queryKey: ["siebel-config"] });
    void queryClient.invalidateQueries({ queryKey: ["bulk-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["ripe-config"] });
    void queryClient.invalidateQueries({ queryKey: ["ripe-allocated-pools"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-config"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-scheduler-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["cst-transactions"] });
    void poolsQuery.refetch();
    void assignmentsQuery.refetch();
    void persistedResourcesQuery.refetch();
    if (registryCoverageNeeded) {
      void registryAssignmentsQuery.refetch();
    }
    void dashboardSummaryQuery.refetch();
    void conflictsQuery.refetch();
    void auditQuery.refetch();
    void usersQuery.refetch();
    void bulkBatchesQuery.refetch();
    void ripeConfigQuery.refetch();
    void ripeAllocatedPoolsQuery.refetch();
    void cstConfigQuery.refetch();
    void cstSummaryQuery.refetch();
    void cstBatchesQuery.refetch();
    void cstJobsQuery.refetch();
    void cstSchedulerRunsQuery.refetch();
    void cstTransactionsQuery.refetch();
  };

  useEffect(() => {
    if (view === "search") {
      void poolsQuery.refetch();
      void assignmentsQuery.refetch();
      if (registryCoverageNeeded) {
        void registryAssignmentsQuery.refetch();
      }
      void dashboardSummaryQuery.refetch();
      void conflictsQuery.refetch();
    }
  }, [view]);

  useEffect(() => {
    if (!routeReady) {
      return;
    }
    const nextRoute = routeForView(view, selectedResourceId);
    const currentRoute = `${window.location.pathname}${window.location.search}`;
    if (currentRoute !== nextRoute) {
      window.history.pushState({ view, selectedResourceId }, "", nextRoute);
    }
  }, [routeReady, selectedResourceId, view]);

  useEffect(() => {
    if (!cstMigrationReviewOpen) {
      return;
    }
    let cancelled = false;
    setCstMigrationReviewLoading(true);
    reviewCstMigrationJobs({
      page: cstMigrationReviewPage,
      page_size: 25,
      resource_scope: cstResourceScope,
      search: cstMigrationReviewFilters.search,
      assignment_status: cstMigrationReviewFilters.assignment_status,
      transaction_type: cstMigrationReviewFilters.transaction_type,
      validation_status: cstMigrationReviewFilters.validation_status,
      created_from: cstMigrationReviewFilters.created_from,
      created_to: cstMigrationReviewFilters.created_to,
    })
      .then((review) => {
        if (!cancelled) {
          setCstMigrationReview(review);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          window.alert(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCstMigrationReviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    cstMigrationReviewOpen,
    cstMigrationReviewPage,
    cstResourceScope,
    cstMigrationReviewFilters.search,
    cstMigrationReviewFilters.assignment_status,
    cstMigrationReviewFilters.transaction_type,
    cstMigrationReviewFilters.validation_status,
    cstMigrationReviewFilters.created_from,
    cstMigrationReviewFilters.created_to,
  ]);
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: refresh,
    onError: (error) => window.alert(errorMessage(error))
  });

  const run = (operation: () => Promise<unknown>) => mutation.mutate(operation);
  const navigateTo = (nextView: ViewKey, registryPanel?: RegistryPanelId) => {
    if (registryPanel) {
      setActiveRegistryPanel(registryPanel);
    }
    setView(nextView);
  };
  const openResource = (resource: ManagedResource) => {
    setSelectedResourceId(resource.id);
    setView("summary");
  };
  const submitAssignment = async () => {
    let payload: AssignmentPayload | null = null;
    try {
      payload = buildAssignmentPayload(assignmentForm, poolAssignmentDraft, resources);
      const { data } = await api.post<Assignment>("/assignments", payload);
      refresh();
      setNotice({
        title: "Assignment Created",
        detail: assignmentResultDetail("Success", data)
      });
    } catch (error) {
      setNotice({
        title: "Assignment Failed",
        detail: assignmentFailureDetail(payload ?? assignmentForm, error)
      });
    }
  };

  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto grid max-w-[1500px] gap-4">
        <header className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button className="shrink-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={() => navigateTo("executive")} aria-label="Go to home">
              <img src={salamLogoForTheme(theme)} alt="Salam" className="h-9 w-36 object-contain" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Salam LIR</p>
              <h1 className="truncate text-2xl font-semibold tracking-normal">Salam Local Internet Registry</h1>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 md:justify-end">
            <Badge variant={registryUnavailable ? "danger" : "success"}>
              <Database className="mr-1 h-3 w-3" />
              SQLite {registryUnavailable ? "unavailable" : "online"}
            </Badge>
            <Badge variant="default">{signedInUser}</Badge>
            <ThemeSelector theme={theme} onTheme={onTheme} />
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>

        {registryUnavailable ? (
          <Card className="border-destructive/60 bg-destructive/10">
            <CardContent className="pt-5 text-sm text-red-200">
              FastAPI is not reachable at {process.env.NEXT_PUBLIC_API_URL ?? "/api"}. Confirm the backend service is running on port 3001 and the Next.js API proxy is rebuilt.
            </CardContent>
          </Card>
        ) : null}

        {usingCachedAssignments ? (
          <Card className="border-amber-500/60 bg-amber-500/10">
            <CardContent className="pt-5 text-sm text-amber-100">
              Assignment refresh failed, so the last successfully loaded assignment list is still being shown. Use Refresh after the API recovers.
            </CardContent>
          </Card>
        ) : null}
        <div className={cn("grid gap-4", view === "executive" ? "" : "lg:grid-cols-[18px_1fr]")}>
          {view !== "executive" ? <aside className="group relative z-20 h-fit w-4 overflow-hidden rounded-lg border border-transparent bg-card/60 p-1 transition-all duration-200 hover:w-16 hover:border-border hover:bg-card hover:p-2 focus-within:w-16 focus-within:border-border focus-within:bg-card focus-within:p-2 lg:sticky lg:top-4">
            <span className="pointer-events-none absolute inset-y-3 left-1.5 w-1 rounded-full bg-muted-foreground/40 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
            <nav className="pointer-events-none grid justify-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100" aria-label="Registry modules">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:h-5 [&_svg]:w-5",
                    view === item.id ? "bg-primary text-primary-foreground shadow-sm" : ""
                  )}
                  onClick={() => navigateTo(item.id)}
                  aria-label={item.label}
                  title={item.label}
                >
                  {item.icon}
                </button>
              ))}
            </nav>
          </aside> : null}

          <section className="min-w-0">
            {view !== "executive" ? <BreadcrumbNavigation view={view} resource={selectedResource} onNavigate={navigateTo} /> : null}
            {view === "executive" ? <ExecutiveDashboard stats={stats} resources={resources} summary={dashboardSummary} assignmentTotal={assignmentTotal} cstSummary={cstSummary} currentRole={signedInRole} onNavigate={navigateTo} /> : null}
            {view === "registry" ? (
              <ResourceRegistry
                resources={resources}
                expanded={expanded}
                activePanel={activeRegistryPanel}
                globalSearch={globalSearch}
                poolForm={poolForm}
                onActivePanel={setActiveRegistryPanel}
                onExpanded={setExpanded}
                onGlobalSearch={setGlobalSearch}
                onPoolForm={setPoolForm}
                onOpen={openResource}
                onCreatePool={() => run(async () => { await api.post("/pools", poolForm); })}
                onRefresh={refresh}
                onRefreshNavigator={() => {
                  void poolsQuery.refetch();
                  void registryAssignmentsQuery.refetch();
                  void dashboardSummaryQuery.refetch();
                  void conflictsQuery.refetch();
                }}
                navigatorRefreshing={poolsQuery.isFetching || registryAssignmentsQuery.isFetching}
                assignmentCoverageCount={registryAssignments.length}
                assignmentCoverageLoading={registryAssignmentsQuery.isFetching}
                assignmentCoverageError={registryAssignmentsQuery.isError && registryAssignmentsQuery.data === undefined}
                ripeDiscoveryResult={ripeDiscoveryResult}
                ripeDiscoveryStatus={ripeDiscoveryStatus}
                ripeDiscoveryActionKey={ripeDiscoveryActionKey}
                ripePushResourceId={ripePushResourceId}
                cstConfig={cstConfig}
                cstSummary={cstSummary}
                cstBatches={cstBatches}
                cstJobs={cstJobs}
                cstSchedulerRuns={cstSchedulerRuns}
                cstTransactions={cstTransactions}
                cstBusy={cstConfigQuery.isFetching || cstSummaryQuery.isFetching || cstBatchesQuery.isFetching || cstJobsQuery.isFetching || cstSchedulerRunsQuery.isFetching || cstTransactionsQuery.isFetching}
                cstResourceScope={cstResourceScope}
                onCstResourceScope={(scope) => { setCstResourceScope(scope); updateCstConfigForm({ ...cstConfigForm, resource_scope: scope }); }}
                onRefreshCst={() => {
                  void cstConfigQuery.refetch();
                  void cstSummaryQuery.refetch();
                  void cstBatchesQuery.refetch();
                  void cstJobsQuery.refetch();
                  void cstSchedulerRunsQuery.refetch();
                  void cstTransactionsQuery.refetch();
                }}
                onBootstrapCst={() => {
                  setCstMigrationReviewOpen(true);
                  setCstMigrationReviewPage(1);
                  setCstReviewSelectedIds([]);
                  setCstReviewExcludedIds([]);
                  setCstReviewCreateResult(null);
                }}
                onReconcileCst={() => run(async () => {
                  const jobs = await reconcileCstResources();
                  setNotice({ title: "CST GetLIR Sent", detail: `${jobs.length} provider-wide GetLIR API job(s) created. GetLIR pulls CST data using pageNumber/pageSize, not per-subnet filtering.` });
                })}
                onRunCstDayMinusOne={() => run(async () => {
                  const result = await runCstDayMinusOneSync();
                  setNotice({ title: "CST Day-1 Sync", detail: `${result.message}\nBatch: ${result.batch_id}` });
                })}
                onRetryCstJob={(job) => run(async () => {
                  await retryCstJob(job.id);
                  setNotice({ title: "CST Job Retried", detail: `${job.id} was retried against the real CST API.` });
                })}
                onRetryCstBatch={(batch) => run(async () => {
                  const jobs = await retryFailedCstBatch(batch.id);
                  void cstSummaryQuery.refetch();
                  void cstJobsQuery.refetch();
                  void cstBatchesQuery.refetch();
                  void cstTransactionsQuery.refetch();
                  setNotice({ title: "CST Batch Retry", detail: `${jobs.length} pending/failed job(s) retried against the real CST API.` });
                })}
                onPushPendingCstJobs={(limit) => run(async () => {
                  const result = await pushPendingCstJobs(limit, cstResourceScope);
                  void cstSummaryQuery.refetch();
                  void cstJobsQuery.refetch();
                  void cstBatchesQuery.refetch();
                  void cstTransactionsQuery.refetch();
                  setNotice({ title: "CST Pending Push", detail: `${result.processed_jobs}/${result.requested_jobs} pending job(s) processed sequentially for ${cstScopeLabel(result.resource_scope)}. Success: ${result.success_jobs}, failed: ${result.failed_jobs}, still pending: ${result.pending_jobs}. Job limit: ${result.batch_size_limit}, SendLIR records per API call: ${result.send_payload_batch_size}, hourly limit: ${result.hourly_request_limit}.` });
                })}
                onToggleCstEnabled={(enabled) => run(async () => { await updateCstConfig({ enabled }); })}
                onToggleCstAutoExecute={(auto_execute) => run(async () => { await updateCstConfig({ auto_execute }); })}
                onToggleCstSchedule={(scheduled_sync_enabled) => run(async () => { await updateCstConfig({ scheduled_sync_enabled }); })}
                onDiscoverRipePools={() => {
                  setRipeDiscoveryStatus("running");
                  run(async () => {
                    try {
                      const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools", { timeout: 120000 });
                      setRipeDiscoveryResult(data);
                      setRipeDiscoveryStatus("complete");
                    } catch (error) {
                      setRipeDiscoveryStatus("idle");
                      throw error;
                    }
                  });
                }}
                onSyncRipePool={(pool) => {
                  const actionKey = `local:${ripeDiscoveryPoolKey(pool)}`;
                  setRipeDiscoveryActionKey(actionKey);
                  run(async () => {
                    try {
                      await api.post("/ripe/discovery/root-pools/sync", pool);
                      const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools", { timeout: 120000 });
                      setRipeDiscoveryResult(data);
                      refresh();
                    } finally {
                      setRipeDiscoveryActionKey("");
                    }
                  });
                }}
                onSyncCstLir={(pool) => {
                  const actionKey = `cst:${ripeDiscoveryPoolKey(pool)}`;
                  setRipeDiscoveryActionKey(actionKey);
                  run(async () => {
                    try {
                      await api.post("/ripe/discovery/root-pools/cst-sync", pool);
                      const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools", { timeout: 120000 });
                      setRipeDiscoveryResult(data);
                      refresh();
                    } finally {
                      setRipeDiscoveryActionKey("");
                    }
                  });
                }}
                onPushToRipe={(resource) => {
                  setRipePushResourceId(resource.id);
                  run(async () => {
                    try {
                      if (!resource.source || !("customer_name" in resource.source)) {
                        window.alert("Only persisted assignment rows can be pushed to RIPE.");
                        return;
                      }
                      const { data } = await api.post<RipePushResponse>(`/ripe/assignments/${resource.source.id}/push`);
                      const removing = resource.operationType === "RETIRE" || resource.ripeSyncStatus === "DECOMMISSION_PENDING";
                      setNotice({
                        title: data.success
                          ? removing ? "RIPE Removal Succeeded" : "RIPE Push Succeeded"
                          : removing ? "RIPE Removal Failed" : "RIPE Push Failed",
                        detail: ripePushNoticeDetail(data)
                      });
                      refresh();
                    } finally {
                      setRipePushResourceId("");
                    }
                  });
                }}
              />
            ) : null}
            {view === "summary" ? (
              <ResourceSummary
                resource={selectedResource}
                resources={resources}
                auditEvents={auditEvents}
                onOpen={openResource}
                onReserve={(resource) => {
                  setReservationForm((current) => ({ ...current, cidr: resource.cidr }));
                  setView("reservations");
                }}
                onAssign={(resource) => {
                  if (resource.administrativeStatus === "AVAILABLE") {
                    setPoolAssignmentDraft({ selectionMode: "subnet", parentPoolId: resource.id, poolSearch: resource.cidr, startIp: resource.startIp, endIp: resource.endIp, prefix: String(resource.prefix) });
                    setAssignmentForm((current) => ({ ...current, cidr: "", assignment_date: current.assignment_date || today() }));
                  } else {
                    setPoolAssignmentDraft({ selectionMode: "subnet", parentPoolId: "", poolSearch: "", startIp: "", endIp: "", prefix: "24" });
                    setAssignmentForm((current) => ({ ...current, cidr: resource.cidr, assignment_date: current.assignment_date || today() }));
                  }
                  setView("assignments");
                }}
                onRelease={(resource) => {
                  const source = resource.source;
                  if (!source || !("customer_name" in source)) {
                    window.alert("This resource is not backed by a persisted assignment or reservation record.");
                    return;
                  }
                  setConfirm({
                    title: resource.administrativeStatus === "RESERVED" ? "Remove reservation" : "Release assignment",
                    detail: resource.administrativeStatus === "RESERVED"
                      ? `Move ${resource.cidr} back to AVAILABLE?`
                      : ["SUCCESS", "SYNCHRONIZED", "DECOMMISSION_PENDING"].includes(resource.ripeSyncStatus) ? `Move ${resource.cidr} to RIPE removal pending? CST UpdateLIRData will set assignmentStatusId to 1 Unassigned if this assignment was reported to CST.` : `Unassign ${resource.cidr} locally? If it was reported to CST, UpdateLIRData will mark it Unassigned; if never reported, no CST update is required.`,
                    destructive: true,
                    action: () => run(async () => {
                      if (resource.administrativeStatus === "RESERVED") {
                        await api.delete(`/assignments/${source.id}`);
                      } else {
                        if (["SUCCESS", "SYNCHRONIZED", "DECOMMISSION_PENDING"].includes(resource.ripeSyncStatus)) {
                          await api.patch(`/assignments/${source.id}/status`, { status: "Retiring" });
                        } else {
                          await api.delete(`/assignments/${source.id}`);
                        }
                      }
                    })
                  });
                }}
                onRetire={(resource) => {
                  const source = resource.source;
                  setConfirm({
                    title: "Retire resource",
                    detail: `Retire ${resource.cidr}? Retired resources become read-only and can be deleted only after retirement.`,
                    destructive: true,
                    action: () => run(async () => {
                      if (source && "customer_name" in source) {
                        await api.patch(`/assignments/${source.id}/status`, { status: "Retiring" });
                      } else if (source) {
                        await api.patch(`/pools/${source.id}`, { resource_status: "RETIRED", lifecycle_state: "Retired" });
                      } else {
                        const parent = resources.find((item) => item.id === resource.parentId);
                        if (parent?.source && !("customer_name" in parent.source) && parent.cidr === resource.cidr) {
                          await api.patch(`/pools/${parent.source.id}`, { resource_status: "RETIRED", lifecycle_state: "Retired" });
                          return;
                        }
                        await api.post("/assignments", {
                          ...emptyAssignment,
                          cidr: resource.cidr,
                          assignment_target_type: "internal",
                          assignment_name: `Retired resource ${resource.cidr}`,
                          assignment_description: "Lifecycle retirement record for an available subnet.",
                          service_instance_id: `retire-${resource.cidr}`,
                          service_instance_name: `Retired ${resource.cidr}`,
                          customer_name: "Internal Registry",
                          internal_consumer_type: "Registry",
                          internal_business_unit: "LIR Registry",
                          internal_owner_team: "IPAM Administration",
                          l3_service: "IPv4 Number Resource",
                          service: "Resource Retirement",
                          owner: "Salam LIR",
                          assignment_purpose: "Retire available subnet",
                          status: "Retiring",
                          assignment_date: today(),
                          notes: "Created by Resource Summary retire action."
                        });
                      }
                    })
                  });
                }}
                onDeleteRetired={(resource) => {
                  const source = resource.source;
                  if (!source) {
                    window.alert("Calculated resources cannot be deleted directly.");
                    return;
                  }
                  setConfirm({
                    title: "Delete retired resource",
                    detail: `Delete retired resource ${resource.cidr}?`,
                    destructive: true,
                    action: () => run(async () => {
                      if ("customer_name" in source) {
                        await api.delete(`/assignments/${source.id}`);
                      } else {
                        await api.delete(`/pools/${source.id}`);
                      }
                    })
                  });
                }}
              />
            ) : null}
            {view === "lifecycle" ? (
              <LifecycleManagement
                resource={selectedResource}
                resources={resources}
                onOpen={openResource}
                onTransition={(resource, status) => {
                  const source = resource.source;
                  if (source && "customer_name" in source) {
                    setConfirm({
                      title: `Move resource to ${status}`,
                      detail: `Apply lifecycle transition to ${resource.cidr}?`,
                      action: () => run(async () => { await api.patch(`/assignments/${source.id}/status`, { status: statusToAssignmentStatus(status) }); })
                    });
                  }
                }}
              />
            ) : null}
            {view === "reservations" ? (
              <ReservationManagement
                resources={resources}
                form={reservationForm}
                onForm={setReservationForm}
                onReserve={() => setConfirm({
                  title: "Create reservation",
                  detail: `Reserve ${reservationForm.cidr} for ${reservationForm.purpose}?`,
                  action: () => run(async () => {
                    await api.post("/assignments", {
                      ...emptyAssignment,
                      cidr: reservationForm.cidr,
                      assignment_target_type: "internal",
                      assignment_name: reservationForm.purpose,
                      customer_name: reservationForm.requestedBy || "Reserved Capacity",
                      owner: "Salam LIR",
                      service: reservationForm.purpose,
                      assignment_purpose: reservationForm.purpose,
                      requested_by: reservationForm.requestedBy,
                      reserved_until: reservationForm.expiryDate,
                      notes: reservationForm.notes,
                      status: "Reserved",
                      assignment_date: today()
                    });
                  })
                })}
                onRelease={(resource) => {
                  const source = resource.source;
                  if (!source || !("customer_name" in source)) {
                    window.alert("This reservation does not have a persisted assignment record to release.");
                    return;
                  }
                  setConfirm({
                    title: "Remove reservation",
                    detail: `Release reservation ${resource.cidr} back to AVAILABLE?`,
                    destructive: true,
                    action: () => run(async () => { await api.delete(`/assignments/${source.id}`); })
                  });
                }}
              />
            ) : null}
            {view === "assignments" ? (
              <AssignmentManagement
                resources={resources}
                assignments={assignments}
                assignmentTotal={assignmentTotal}
                assignmentPage={assignmentPageData?.page ?? assignmentPage}
                assignmentPageSize={assignmentPageSize}
                assignmentTotalPages={assignmentPageData?.total_pages ?? 1}
                assignmentSearch={assignmentSearch}
                assignmentsLoading={assignmentsQuery.isFetching}
                searchQuery={globalSearch}
                searchFilters={globalSearchFilters}
                searchRefreshing={poolsQuery.isFetching || registryAssignmentsQuery.isFetching || conflictsQuery.isFetching}
                searchLastUpdated={Math.max(poolsQuery.dataUpdatedAt, registryAssignmentsQuery.dataUpdatedAt, conflictsQuery.dataUpdatedAt)}
                onSearchQuery={setGlobalSearch}
                onSearchFilters={setGlobalSearchFilters}
                onSearchRefresh={refresh}
                onSearchOpen={() => { void registryAssignmentsQuery.refetch(); }}
                onAssignmentPage={setAssignmentPage}
                onAssignmentPageSize={(value) => { setAssignmentPageSize(value); setAssignmentPage(1); }}
                onAssignmentSearch={(value) => { setAssignmentSearch(value); setAssignmentPage(1); }}
                onOpen={openResource}
                form={assignmentForm}
                poolDraft={poolAssignmentDraft}
                onForm={setAssignmentForm}
                onPoolDraft={setPoolAssignmentDraft}
                onAssign={() => setConfirm({
                  title: "Create assignment",
                  detail: `Assign ${assignmentPreviewCidr(assignmentForm, poolAssignmentDraft, resources)} to ${assignmentForm.customer_name || assignmentForm.internal_application_name}?`,
                  action: () => { void submitAssignment(); }
                })}
                onRelease={(assignment) => setConfirm({
                  title: "Confirm Unassign",
                  detail: ["SUCCESS", "SYNCHRONIZED", "DECOMMISSION_PENDING"].includes(String(assignment.ripe_sync_status || "").toUpperCase())
                    ? `Are you sure you want to unassign ${assignment.cidr}? This assignment has RIPE history, so it will be moved to removal pending. If it was reported to CST, CST UpdateLIRData will mark it as Unassigned.`
                    : `Are you sure you want to unassign ${assignment.cidr}? The subnet will be released locally. If it was reported to CST, CST UpdateLIRData will mark it as Unassigned; if never reported, no CST update is required.`,
                  destructive: true,
                  action: () => {
                    void (async () => {
                      try {
                        const ripeSynced = ["SUCCESS", "SYNCHRONIZED", "DECOMMISSION_PENDING"].includes(String(assignment.ripe_sync_status || "").toUpperCase());
                        if (ripeSynced) {
                          await api.patch(`/assignments/${assignment.id}/status`, { status: "Retiring" });
                        } else {
                          await api.delete(`/assignments/${assignment.id}`);
                        }
                        refresh();
                        setNotice({
                          title: "Unassign Completed",
                          detail: ripeSynced
                            ? `${assignment.cidr} was moved to RIPE removal pending. CST was updated first when required.`
                            : `${assignment.cidr} was unassigned successfully. CST was updated first when required.`
                        });
                      } catch (error) {
                        setNotice({
                          title: "Unassign Failed",
                          detail: `${assignment.cidr} could not be unassigned.

${errorMessage(error)}`
                        });
                      }
                    })();
                  }
                })}
                onPartialReassign={(assignment, partialCidr) => setConfirm({
                  title: "Partial LIR reassignment",
                  detail: `Reassign ${partialCidr} from original block ${assignment.cidr}? CST will update the original to Unassigned, delete it, then send the assigned and remaining unassigned fragments.`,
                  action: () => run(async () => {
                    const payload = {
                      ...assignmentForm,
                      cidr: partialCidr,
                      assignment_status_id: assignmentStatusByTarget[assignmentForm.assignment_target_type],
                      status: "Active" as AssignmentStatus
                    };
                    const result = await startPartialReassignment(assignment.id, payload);
                    void assignmentsQuery.refetch();
                    void registryAssignmentsQuery.refetch();
                    void poolsQuery.refetch();
                    void conflictsQuery.refetch();
                    void cstJobsQuery.refetch();
                    void cstBatchesQuery.refetch();
                    void cstTransactionsQuery.refetch();
                    setNotice({ title: "Partial LIR Reassignment", detail: `${result.status}: ${result.message || `${result.fragments.length} CST operation(s) tracked under ${result.id}`}` });
                  })
                })}
                onStatus={(assignment, status) => run(async () => { await api.patch(`/assignments/${assignment.id}/status`, { status }); })}
                onRefreshSiebelAssignment={(assignment) => run(async () => {
                  const { data } = await api.post<BssDeltaSyncResponse>(`/assignments/${assignment.id}/siebel-refresh`);
                  void assignmentsQuery.refetch();
                  void registryAssignmentsQuery.refetch();
                  void poolsQuery.refetch();
                  setNotice({ title: "BSS Delta Sync", detail: `${data.message}: ${data.updated} updated, ${data.unchanged} unchanged, ${data.failed} failed.` });
                })}
                onLookupSiebelService={(serviceId) => run(async () => {
                  const { data } = await api.post<SiebelLookupResponse>("/siebel/business-customer", { service_id: serviceId });
                  if (!data.found) {
                    setNotice({ title: "Siebel Lookup", detail: data.message || `No details found for service ID ${serviceId}.` });
                    return;
                  }
                  setAssignmentForm((current) => ({
                    ...current,
                    ...data.assignment,
                    assignment_target_type: "business_customer",
                    service_id: data.assignment.service_id || serviceId
                  }));
                  setNotice({ title: "Siebel Details Loaded", detail: `Business customer details were populated for service ID ${serviceId}.` });
                })}
              />
            ) : null}
            {view === "capacity" ? <CapacityManagement resources={resources} /> : null}
            {view === "subnet-operations" ? (
              <SubnetOperations
                pools={pools}
                resources={resources}
                splitForm={splitForm}
                mergeForm={mergeForm}
                onSplitForm={setSplitForm}
                onMergeForm={setMergeForm}
                onSplit={() => setConfirm({
                  title: "Split resource",
                  detail: `Split selected parent from the ${splitForm.direction} into /${splitForm.prefix}?`,
                  action: () => run(async () => {
                    const { data } = await api.post<PartitionResult>("/pools/partition", {
                      pool_id: splitForm.poolId || pools[0]?.id,
                      target_prefix: Number.parseInt(splitForm.prefix, 10),
                      direction: splitForm.direction
                    });
                    const remainingUuid = data.remaining.resource_uuid ?? stableUuid(`remaining:${data.allocated.id}:${data.remaining.label}`);
                    window.alert(
                      `${data.message}\n\nNew child UUIDs:\nAllocated ${data.allocated.cidr}: ${resourceUuid("assignment", data.allocated.id, data.allocated.cidr)}\nRemaining ${data.remaining.label}: ${remainingUuid}`
                    );
                  })
                })}
                onMerge={() => setConfirm({
                  title: "Merge resources",
                  detail: "Merge adjacent resources with the same parent and status?",
                  action: () => run(async () => { await api.post("/pools/join", { left_pool_id: mergeForm.leftPoolId, right_pool_id: mergeForm.rightPoolId }); })
                })}
              />
            ) : null}
            {view === "integrity" ? <IntegrityManagement conflicts={conflicts} resources={resources} onOpen={openResource} onAcceptAssignment={(assignmentId) => run(async () => { await acceptConflictAssignment(assignmentId); })} onRejectAssignment={(assignmentId) => run(async () => { await rejectConflictAssignment(assignmentId); })} onAutoResolveExactDuplicates={() => run(async () => { const result = await autoResolveExactDuplicateConflicts(); setNotice({ title: "Integrity Auto-Resolve Complete", detail: result.message }); void assignmentsQuery.refetch(); void registryAssignmentsQuery.refetch(); void conflictsQuery.refetch(); void cstSummaryQuery.refetch(); })} /> : null}
            {view === "bulk" ? (
              <BulkOperations
                poolCsv={bulkPoolCsv}
                assignmentCsv={bulkAssignmentCsv}
                poolFileName={bulkPoolFileName}
                assignmentFileName={bulkAssignmentFileName}
                poolAllocated={bulkPoolAllocated}
                assignmentAllowConflicts={bulkAssignmentAllowConflicts}
                batches={bulkBatches}
                isRefreshing={bulkBatchesQuery.isFetching}
                onPoolCsv={setBulkPoolCsv}
                onAssignmentCsv={setBulkAssignmentCsv}
                onPoolFileName={setBulkPoolFileName}
                onAssignmentFileName={setBulkAssignmentFileName}
                onPoolAllocated={setBulkPoolAllocated}
                onAssignmentAllowConflicts={setBulkAssignmentAllowConflicts}
                onRefresh={() => void bulkBatchesQuery.refetch()}
                onImportPools={() => run(async () => {
                  const { data } = await api.post<BulkBatch>("/pools/bulk", { csv_text: bulkPoolCsv, file_name: bulkPoolFileName, allocated_pool: bulkPoolAllocated });
                  setNotice({ title: "Bulk transaction started", detail: `${data.id} is processing ${data.total_rows} subnet rows. Track status in Bulk Transaction History.` });
                })}
                onImportAssignments={() => run(async () => {
                  const { data } = await api.post<BulkBatch>("/assignments/bulk", { csv_text: bulkAssignmentCsv, file_name: bulkAssignmentFileName, allow_conflicts: bulkAssignmentAllowConflicts }, { timeout: 15 * 60 * 1000 });
                  setNotice({ title: "Bulk transaction started", detail: `${data.id} is processing ${data.total_rows} assignment rows. Track status in Bulk Transaction History.` });
                })}
              />
            ) : null}
            {view === "search" ? (
              <GlobalSearch
                resources={resources}
                query={globalSearch}
                filters={globalSearchFilters}
                isRefreshing={poolsQuery.isFetching || assignmentsQuery.isFetching || conflictsQuery.isFetching}
                lastUpdated={Math.max(poolsQuery.dataUpdatedAt, assignmentsQuery.dataUpdatedAt, conflictsQuery.dataUpdatedAt)}
                onQuery={setGlobalSearch}
                onFilters={setGlobalSearchFilters}
                onRefresh={refresh}
                onOpen={openResource}
              />
            ) : null}
            {view === "reports" ? (
              <Reporting
                resources={resources}
                auditEvents={auditEvents}
                conflicts={conflicts}
                ripeReportForm={ripeReportForm}
                ripeReportResult={ripeReportResult}
                ripeReportStatus={ripeReportStatus}
                onRipeReportForm={setRipeReportForm}
                onClearRipeReport={() => {
                  setRipeReportResult(null);
                  setRipeReportStatus("idle");
                }}
                onRunRipeReport={() => {
                  setRipeReportResult(null);
                  setRipeReportStatus("running");
                  run(async () => {
                    try {
                      const { data } = await api.post<RipeReportResponse>("/ripe/reports/query", {
                        date_from: ripeReportForm.dateFrom,
                        date_to: ripeReportForm.dateTo,
                        report_type: ripeReportForm.reportType
                      });
                      setRipeReportResult(data);
                      setRipeReportStatus("complete");
                    } catch (error) {
                      setRipeReportStatus("idle");
                      throw error;
                    }
                  });
                }}
              />
            ) : null}
            {view === "administration" ? (
              <Administration
                stats={stats}
                users={users}
                auditEvents={auditEvents}
                currentRole={signedInRole}
                newUser={newUser}
                passwordReset={passwordReset}
                ripeConfig={ripeConfig}
                ripeConfigForm={ripeConfigForm}
                siebelConfig={siebelConfig}
                siebelConfigForm={siebelConfigForm}
                databaseConnectionStatus={databaseConnectionStatus}
                databaseConnectionForm={databaseConnectionForm}
                cstConfig={cstConfig}
                cstConfigForm={cstConfigForm}
                cstResourceScope={cstResourceScope}
                ripePoolCsv={ripePoolCsv}
                ripeAllocatedPools={ripeAllocatedPools}
                onNewUser={setNewUser}
                onPasswordReset={setPasswordReset}
                onRipeConfigForm={setRipeConfigForm}
                onSiebelConfigForm={setSiebelConfigForm}
                onDatabaseConnectionForm={setDatabaseConnectionForm}
                onCstConfigForm={updateCstConfigForm}
                onCstResourceScope={(scope) => { setCstResourceScope(scope); updateCstConfigForm({ ...cstConfigForm, resource_scope: scope }); }}
                onRipePoolCsv={setRipePoolCsv}
                onAddUser={() => run(async () => { await api.post("/users", newUser); setNewUser({ username: "", password: "", role: "operator" }); })}
                onSetPassword={() => run(async () => { await api.patch(`/users/${passwordReset.userId}/password`, { password: passwordReset.password }); setPasswordReset((current) => ({ ...current, password: "" })); })}
                onToggleUser={(user) => run(async () => { await api.patch(`/users/${user.id}/status`, { status: user.status === "Active" ? "Disabled" : "Active" }); })}
                onSaveRipeConfig={() => run(async () => { await api.put("/ripe/config", ripeConfigForm); })}
                onSaveSiebelConfig={() => run(async () => { await api.put("/siebel/config", siebelConfigForm); void siebelConfigQuery.refetch(); })}
                onTestDatabaseConnection={() => run(async () => {
                  const result = await testDatabaseConnection(databaseConnectionForm);
                  void databaseStatusQuery.refetch();
                  setNotice({ title: "PostgreSQL Test Succeeded", detail: `${result.message}\nDatabase: ${result.database}\nUser: ${result.username}\nTested: ${result.tested_at.slice(0, 19)}` });
                })}
                onTestSiebelConnection={() => run(async () => {
                  await api.put("/siebel/config", siebelConfigForm);
                  const result = await testSiebelConnection();
                  void siebelConfigQuery.refetch();
                  setNotice({ title: "Siebel Test Succeeded", detail: `${result.message}\nDSN: ${result.dsn}\nTested: ${result.tested_at.slice(0, 19)}` });
                })}
                onSaveCstConfig={() => run(async () => {
                  const saved = await updateCstConfig(normalizeCstConfigFormForSave(cstConfigForm));
                  setCstConfigForm({ ...normalizeCstConfigFormForSave(saved), auth_password: "", api_access_key: "", user_key: "" });
                  setCstConfigFormDirty(false);
                  queryClient.setQueryData(["cst-config"], saved);
                  void cstConfigQuery.refetch();
                  setNotice({ title: "CST Settings Saved", detail: `Operation switches and CST API settings were saved. Mode: ${saved.auto_execute ? "Auto execute" : "Queue only"}.` });
                })}
                onTestCstConnection={() => run(async () => {
                  const saved = await updateCstConfig(normalizeCstConfigFormForSave(cstConfigForm));
                  setCstConfigForm({ ...normalizeCstConfigFormForSave(saved), auth_password: "", api_access_key: "", user_key: "" });
                  setCstConfigFormDirty(false);
                  queryClient.setQueryData(["cst-config"], saved);
                  const result = await testCstConnection();
                  void cstConfigQuery.refetch();
                  setNotice({ title: "CST Token Test Succeeded", detail: `${result.message}\nPath: ${result.token_path}\nToken expires: ${result.token_expires_at ? result.token_expires_at.slice(0, 19) : "not returned"}` });
                })}
                onRunSiebelDeltaSync={() => run(async () => {
                  const { data } = await api.post<BssDeltaSyncResponse>("/siebel/delta-sync");
                  void assignmentsQuery.refetch();
                  void registryAssignmentsQuery.refetch();
                  void poolsQuery.refetch();
                  void auditQuery.refetch();
                  setNotice({ title: "BSS Delta Sync", detail: `Checked ${data.checked}. Updated ${data.updated}, unchanged ${data.unchanged}, failed ${data.failed}.` });
                })}
                onImportRipePools={() => run(async () => {
                  const { data } = await api.post("/ripe/allocated-pools/bulk", { csv_text: ripePoolCsv, file_name: "ripe-allocated-pools.csv" });
                  setNotice({ title: "RIPE Allocated Pools Imported", detail: `${data.imported} imported, ${data.blocked} blocked.${data.errors?.length ? `\n${data.errors.slice(0, 8).join("\n")}` : ""}` });
                })}
              />
            ) : null}
          </section>
        </div>
      </div>

      <CstMigrationReviewDialog
        open={cstMigrationReviewOpen}
        review={cstMigrationReview}
        loading={cstMigrationReviewLoading}
        page={cstMigrationReviewPage}
        filters={cstMigrationReviewFilters}
        selectedIds={cstReviewSelectedIds}
        excludedIds={cstReviewExcludedIds}
        result={cstReviewCreateResult}
        resourceScope={cstResourceScope}
        onOpenChange={setCstMigrationReviewOpen}
        onPage={setCstMigrationReviewPage}
        onFilters={(filters) => { setCstMigrationReviewFilters(filters); setCstMigrationReviewPage(1); }}
        onSelectedIds={setCstReviewSelectedIds}
        onExcludedIds={setCstReviewExcludedIds}
        onCreate={(includedIds, excludedIds) => run(async () => {
          if (!includedIds.length) {
            return;
          }
          if (!window.confirm(`Create pending CST migration job with ${includedIds.length} included transaction(s)? CST API will not be called until you push pending jobs.`)) {
            return;
          }
          const result = await createCstMigrationJobFromReview({
            included_review_ids: includedIds,
            excluded_review_ids: excludedIds,
            resource_scope: cstResourceScope,
            final_confirmed: true,
            created_by: signedInUser,
          });
          setCstReviewCreateResult(result);
          setCstReviewSelectedIds([]);
          void cstSummaryQuery.refetch();
          void cstJobsQuery.refetch();
          void cstBatchesQuery.refetch();
          void cstTransactionsQuery.refetch();
          setNotice({
            title: result.batch_id ? "Pending CST Migration Job Created" : "CST Migration Job Not Created",
            detail: `${result.message}\nJob ID: ${result.batch_id || "-"}\nIncluded: ${result.included_transactions}\nRejected/skipped: ${result.rejected_count + result.skipped_count}\nCreated: ${result.created_at.slice(0, 19)}\nCreated by: ${result.created_by}${result.rejected.length ? `\n\nRejected:\n${result.rejected.map((item) => `${item.review_id} ${item.cidr}: ${item.reason}`).join("\n")}` : ""}`
          });
        })}
      />
      <Dialog open={Boolean(confirm)} onOpenChange={() => setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.detail}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>No</Button>
            <Button
              variant={confirm?.destructive ? "destructive" : "default"}
              onClick={() => {
                confirm?.action();
                setConfirm(null);
              }}
            >
              Yes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(notice)} onOpenChange={() => setNotice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{notice?.title}</DialogTitle>
            <DialogDescription className="max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {notice?.detail}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={() => setNotice(null)}>OK</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ThemeSelector({ theme, onTheme }: { theme: AppTheme; onTheme: (theme: AppTheme) => void }) {
  return (
    <div className="relative w-32" aria-label="Theme selector">
      <select
        className="h-9 w-full appearance-none rounded-md border bg-muted/40 py-0 pl-3 pr-8 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25"
        value={theme}
        onChange={(event) => onTheme(event.target.value as AppTheme)}
        title="Application theme"
      >
        {themeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
function ExecutiveDashboard({
  stats,
  resources,
  summary,
  assignmentTotal,
  cstSummary,
  currentRole,
  onNavigate
}: {
  stats: RegistryStats;
  resources: ManagedResource[];
  summary: DashboardSummary | null;
  assignmentTotal: number;
  cstSummary: CstSyncSummary | null;
  currentRole: User["role"];
  onNavigate: (view: ViewKey, registryPanel?: RegistryPanelId) => void;
}) {
  const [metricOwnerMenuOpen, setMetricOwnerMenuOpen] = useState(false);
  const [metricOwnerSelection, setMetricOwnerSelection] = useState<Record<string, boolean>>({});
  const metricOwnerOptions = useMemo(
    () => uniqueSorted(resources.map((resource) => String(resource.owner || "Unknown").trim() || "Unknown")),
    [resources]
  );
  const selectedMetricOwners = metricOwnerOptions.filter((owner) => metricOwnerSelection[owner] !== false);
  const allMetricOwnersSelected = metricOwnerOptions.length === 0 || selectedMetricOwners.length === metricOwnerOptions.length;
  const selectedMetricOwnerSet = new Set(selectedMetricOwners);
  const metricResources = allMetricOwnersSelected ? resources : resources.filter((resource) => selectedMetricOwnerSet.has(String(resource.owner || "Unknown").trim() || "Unknown"));
  const fallbackPools = metricResources.filter(isRegisteredSubnet);
  const fallbackAssignments = metricResources.filter((resource) => resource.administrativeStatus === "ASSIGNED");
  const fallbackAssignedIps = fallbackAssignments.reduce((sum, resource) => sum + resource.totalIps, 0);
  const fallbackTotalIps = fallbackPools.reduce((sum, resource) => sum + resource.totalIps, 0);
  const fallbackTotalPools = fallbackPools.length;
  const salamOwnerSelected = selectedMetricOwners.length === 1 && selectedMetricOwners[0].trim().toLowerCase() === "salam";
  const assignedIps = allMetricOwnersSelected ? summary?.assigned_ips ?? fallbackAssignedIps : salamOwnerSelected ? summary?.salam_assigned_ips ?? fallbackAssignedIps : fallbackAssignedIps;
  const assignmentRecords = allMetricOwnersSelected ? summary?.assignment_records ?? assignmentTotal : salamOwnerSelected ? summary?.salam_assignment_records ?? fallbackAssignments.length : fallbackAssignments.length;
  const totalPools = allMetricOwnersSelected ? summary?.total_pools ?? stats.totalPools : salamOwnerSelected ? summary?.salam_total_pools ?? fallbackTotalPools : fallbackTotalPools;
  const totalIps = allMetricOwnersSelected ? summary?.total_ips ?? stats.totalResources : salamOwnerSelected ? summary?.salam_total_ips ?? fallbackTotalIps : fallbackTotalIps;
  const availableIps = Math.max(totalIps - assignedIps, 0);
  const utilization = totalIps ? round1((assignedIps / totalIps) * 100) : 0;
  const ripePending = allMetricOwnersSelected ? summary?.ripe_pending ?? resources.filter((resource) => ["PENDING", "FAILED", "DECOMMISSION_PENDING"].includes(resource.ripeSyncStatus)).length : salamOwnerSelected ? summary?.salam_ripe_pending ?? metricResources.filter((resource) => ["PENDING", "FAILED", "DECOMMISSION_PENDING"].includes(resource.ripeSyncStatus)).length : metricResources.filter((resource) => ["PENDING", "FAILED", "DECOMMISSION_PENDING"].includes(resource.ripeSyncStatus)).length;
  const cstPending = allMetricOwnersSelected ? summary?.cst_pending ?? cstSummary?.pending_jobs ?? resources.filter((resource) => resource.cstSyncStatus === "PENDING").length : salamOwnerSelected ? summary?.salam_cst_pending ?? metricResources.filter((resource) => resource.cstSyncStatus === "PENDING").length : metricResources.filter((resource) => resource.cstSyncStatus === "PENDING").length;
  const criticalConflicts = stats.integrityIssues;
  const metricScopeLabel = allMetricOwnersSelected ? "All owners" : selectedMetricOwners.length ? selectedMetricOwners.join(", ") : "No owners selected";
  const setOwnerSelected = (owner: string, selected: boolean) => setMetricOwnerSelection((current) => ({ ...current, [owner]: selected }));
  const setAllOwnersSelected = (selected: boolean) => setMetricOwnerSelection(Object.fromEntries(metricOwnerOptions.map((owner) => [owner, selected])) as Record<string, boolean>);
  const workflowTileDefinitions: Array<{
    title: string;
    detail: string;
    status: string;
    accent: string;
    icon: React.ReactNode;
    view: ViewKey;
    registryPanel?: RegistryPanelId;
    adminOnly?: boolean;
  }> = [
    { title: "Resource Registry", detail: "Browse allocated pools, child pools, available blocks, assignments, and RIPE-discovered roots.", status: `${totalPools} registered subnets`, accent: "cyan", icon: <Database className="h-5 w-5" />, view: "registry", registryPanel: "subnet-navigator" },
    { title: "Assignment Management", detail: "Assign, reserve, release, and retire customer or internal subnet resources.", status: `${assignmentRecords} active assignments`, accent: "green", icon: <Users className="h-5 w-5" />, view: "assignments" },
    { title: "Global Search", detail: "Find resources by CIDR, UUID, transaction ID, owner, netname, or status.", status: "CIDR and transaction lookup", accent: "slate", icon: <Search className="h-5 w-5" />, view: "search" },
    { title: "RIPE Discovery", detail: "Discover RIPE root pools maintained by Salam and sync them into the local LIR registry.", status: "Maintainer discovery", accent: "blue", icon: <Radar className="h-5 w-5" />, view: "registry", registryPanel: "lir-discovery" },
    { title: "RIPE Sync Worklist", detail: "Review pending RIPE create/delete work items, failures, and retry actions.", status: `${ripePending} pending or failed`, accent: ripePending ? "amber" : "green", icon: <ListTree className="h-5 w-5" />, view: "registry", registryPanel: "ripe-worklist" },
    { title: "Reporting", detail: "Run RIPE Assignment, CST/LIR registry, utilization, and subnet summary exports.", status: "CSV and XLSX exports", accent: "cyan", icon: <FileDown className="h-5 w-5" />, view: "reports" },
    { title: "CST Sync Monitor", detail: "Monitor transaction jobs, daily schedule, retries, batches, and ledger status.", status: `${cstPending} pending jobs`, accent: cstPending ? "violet" : "green", icon: <Network className="h-5 w-5" />, view: "registry", registryPanel: "cst-sync-monitor" },
    { title: "Integrity & Conflicts", detail: "Investigate overlaps, orphan resources, duplicates, and registry consistency issues.", status: `${criticalConflicts} issues`, accent: criticalConflicts ? "red" : "green", icon: <AlertTriangle className="h-5 w-5" />, view: "integrity" },
    { title: "Bulk Operations", detail: "Import assignment migration CSVs, review CST readiness, and export row-level error or warning reports.", status: "Admin import tools", accent: "blue", icon: <Upload className="h-5 w-5" />, view: "bulk", adminOnly: true },
    { title: "Administration", detail: "Manage users, RIPE settings, CST controls, policies, and integration configuration.", status: "Admin controls", accent: "slate", icon: <Shield className="h-5 w-5" />, view: "administration", adminOnly: true }
  ];
  const workflowTiles = workflowTileDefinitions.filter((tile) => !tile.adminOnly || currentRole === "admin");

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Dashboard metrics</p>
            <p className="text-xs text-muted-foreground">Scope: {metricScopeLabel}</p>
          </div>
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setMetricOwnerMenuOpen((current) => !current)} aria-expanded={metricOwnerMenuOpen} aria-label="Dashboard metric owner settings">
              <Settings className="h-4 w-4" />
              Metrics
            </Button>
            {metricOwnerMenuOpen ? (
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Metric Owners</p>
                    <p className="text-xs text-muted-foreground">Toggle each resource owner included in the cards.</p>
                  </div>
                  <Badge variant="muted">{selectedMetricOwners.length}/{metricOwnerOptions.length}</Badge>
                </div>
                <div className="grid max-h-64 gap-2 overflow-auto pr-1">
                  {metricOwnerOptions.map((owner) => {
                    const selected = metricOwnerSelection[owner] !== false;
                    return (
                      <button
                        key={owner}
                        type="button"
                        role="switch"
                        aria-checked={selected}
                        className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/35"
                        onClick={() => setOwnerSelected(owner, !selected)}
                      >
                        <span className="font-medium">{owner}</span>
                        <span className={cn("relative h-5 w-9 rounded-full border transition", selected ? "border-primary bg-primary" : "border-border bg-muted")}>
                          <span className={cn("absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-background shadow transition", selected ? "left-5" : "left-1")} />
                        </span>
                      </button>
                    );
                  })}
                  {!metricOwnerOptions.length ? <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">No owners found yet.</p> : null}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAllOwnersSelected(false)} disabled={!metricOwnerOptions.length}>Clear</Button>
                  <Button size="sm" variant="secondary" onClick={() => setAllOwnersSelected(true)} disabled={!metricOwnerOptions.length}>All Owners</Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <HomeMetric label="Available IPs" value={formatHosts(availableIps)} detail={`${metricScopeLabel} free capacity ready for assignment`} tone="cyan" emphasis />
          <HomeMetric label="Assigned IPs" value={formatHosts(assignedIps)} detail={`${assignmentRecords} active assignment records`} tone="green" emphasis />
          <HomeMetric label="Utilization" value={`${utilization}%`} detail={`${formatHosts(assignedIps)} of ${formatHosts(totalIps)} IPs used`} tone={utilization >= 85 ? "amber" : "violet"} progress={utilization} emphasis />
          <HomeMetric label="Total Pool Size" value={formatHosts(totalIps)} detail={`${totalPools} allocated pool${totalPools === 1 ? "" : "s"}`} tone="cyan" emphasis />
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Main Workflows</h3>
          </div>
          <Badge variant={stats.integrityIssues ? "warning" : "success"}>{stats.integrityIssues ? `${stats.integrityIssues} integrity items` : "Registry healthy"}</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {workflowTiles.map((tile) => (
            <HomeWorkflowTile key={tile.title} {...tile} onOpen={() => onNavigate(tile.view, tile.registryPanel)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function HomeMetric({ label, value, detail, tone, progress, emphasis = false }: { label: string; value: string; detail: string; tone: "cyan" | "green" | "amber" | "violet"; progress?: number; emphasis?: boolean }) {
  const toneClass = {
    cyan: "border-cyan-400/50 bg-cyan-400/10 text-cyan-300",
    green: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    amber: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    violet: "border-violet-400/40 bg-violet-400/10 text-violet-200"
  }[tone];
  const progressValue = Math.max(0, Math.min(progress ?? 0, 100));
  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="pt-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={cn("mt-2 font-bold tracking-normal text-foreground", emphasis ? "text-5xl leading-none" : "text-3xl")}>{value}</p>
        <p className="mt-2 text-sm">{detail}</p>
        {progress !== undefined ? (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-background/60">
            <div className="h-full rounded-full bg-current transition-all" style={{ width: `${progressValue}%` }} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HomeWorkflowTile({ title, status, accent, icon, onOpen }: { title: string; detail: string; status: string; accent: string; icon: React.ReactNode; onOpen: () => void }) {
  const accentClass = {
    cyan: "border-cyan-400/50 text-cyan-300",
    blue: "border-sky-400/50 text-sky-200",
    green: "border-emerald-400/50 text-emerald-200",
    amber: "border-amber-400/50 text-amber-200",
    red: "border-red-400/50 text-red-200",
    violet: "border-violet-400/50 text-violet-200",
    slate: "border-slate-400/40 text-slate-200"
  }[accent] ?? "border-slate-400/40 text-slate-200";
  return (
    <button className="group min-h-[122px] rounded-lg border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/70 hover:bg-muted/20" type="button" onClick={onOpen}>
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted/30 [&_svg]:h-8 [&_svg]:w-8", accentClass)}>{icon}</span>
          <ChevronRight className="mt-1 h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
        </div>
        <div className="grid gap-2">
          <h4 className="text-base font-semibold leading-tight text-foreground">{title}</h4>
          <span className={cn("w-fit rounded-md border px-2 py-1 text-xs font-semibold", accentClass)}>{status}</span>
        </div>
      </div>
    </button>
  );
}

function HealthRow({ label, value, status }: { label: string; value: string; status: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-base font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{status}</p>
    </div>
  );
}

type CstMonitorProps = {
  cstConfig: CstConfig | null;
  cstSummary: CstSyncSummary | null;
  cstBatches: CstSyncBatch[];
  cstJobs: CstSyncJob[];
  cstSchedulerRuns: CstSchedulerRun[];
  cstTransactions: CstTransactionLedger[];
  cstBusy: boolean;
  cstResourceScope: CstResourceScope;
  onCstResourceScope: (scope: CstResourceScope) => void;
  onRefreshCst: () => void;
  onBootstrapCst: () => void;
  onReconcileCst: () => void;
  onRunCstDayMinusOne: () => void;
  onRetryCstJob: (job: CstSyncJob) => void;
  onRetryCstBatch: (batch: CstSyncBatch) => void;
  onPushPendingCstJobs: (limit: number) => void;
  onToggleCstEnabled: (enabled: boolean) => void;
  onToggleCstAutoExecute: (autoExecute: boolean) => void;
  onToggleCstSchedule: (scheduled: boolean) => void;
};

type RegistryPanelId = "register" | "lir-discovery" | "ripe-worklist" | "cst-sync-monitor" | "subnet-navigator";

function ResourceRegistry(props: {
  resources: ManagedResource[];
  activePanel: RegistryPanelId;
  expanded: Record<string, boolean>;
  globalSearch: string;
  poolForm: { cidr: string; name: string; region: string; description: string };
  ripeDiscoveryResult: RipeDiscoveryResponse | null;
  ripeDiscoveryStatus: "idle" | "running" | "complete";
  ripeDiscoveryActionKey: string;
  ripePushResourceId: string;
  onActivePanel: (panel: RegistryPanelId) => void;
  onExpanded: (value: Record<string, boolean>) => void;
  onGlobalSearch: (value: string) => void;
  onPoolForm: (value: { cidr: string; name: string; region: string; description: string }) => void;
  onOpen: (resource: ManagedResource) => void;
  onCreatePool: () => void;
  onRefresh: () => void;
  onRefreshNavigator: () => void;
  navigatorRefreshing: boolean;
  assignmentCoverageCount: number;
  assignmentCoverageLoading: boolean;
  assignmentCoverageError: boolean;
  onDiscoverRipePools: () => void;
  onSyncRipePool: (pool: RipeDiscoveredRootPool) => void;
  onSyncCstLir: (pool: RipeDiscoveredRootPool) => void;
  onPushToRipe: (resource: ManagedResource) => void;
} & CstMonitorProps) {
  const visible = filterResources(registryAllocatedPools(props.resources), props.globalSearch);
  const activeRegistryPanel = props.activePanel;
  const registryPanels: Array<{ id: RegistryPanelId; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { id: "lir-discovery", label: "RIPE Discovery", icon: <Radar className="h-6 w-6" /> },
    { id: "ripe-worklist", label: "RIPE Worklist", icon: <ListTree className="h-6 w-6" /> },
    { id: "cst-sync-monitor", label: "CST Sync Monitor", icon: <Network className="h-6 w-6" /> },
    { id: "subnet-navigator", label: "Subnet Navigator", icon: <Layers3 className="h-6 w-6" /> },
    { id: "register", label: "Register Subnet", icon: <Database className="h-6 w-6" />, disabled: true }
  ];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {registryPanels.map((panel) => (
          <RegistryPanelButton
            key={panel.id}
            active={activeRegistryPanel === panel.id}
            disabled={panel.disabled}
            icon={panel.icon}
            label={panel.label}
            onClick={() => props.onActivePanel(panel.id)}
          />
        ))}
      </div>

      {activeRegistryPanel === "register" ? (
        <Card>
          <CardHeader>
            <CardTitle>Register Subnet</CardTitle>
            <CardDescription>Register private IPv4 subnets only. Public allocated pools are synchronized from RIPE.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Input value={props.poolForm.cidr} onChange={(event) => props.onPoolForm({ ...props.poolForm, cidr: event.target.value })} placeholder="CIDR" />
            <Input value={props.poolForm.name} onChange={(event) => props.onPoolForm({ ...props.poolForm, name: event.target.value })} placeholder="Netname / subnet name" />
            <Input value={props.poolForm.region} onChange={(event) => props.onPoolForm({ ...props.poolForm, region: event.target.value })} placeholder="Country / region" />
            <Button onClick={props.onCreatePool}>
              <Database className="h-4 w-4" />
              Register Subnet
            </Button>
            <Textarea className="md:col-span-4" value={props.poolForm.description} onChange={(event) => props.onPoolForm({ ...props.poolForm, description: event.target.value })} placeholder="Description" />
          </CardContent>
        </Card>
      ) : null}

      {activeRegistryPanel === "lir-discovery" ? (
        <RipePoolsDiscovery
          result={props.ripeDiscoveryResult}
          status={props.ripeDiscoveryStatus}
          actionKey={props.ripeDiscoveryActionKey}
          onDiscover={props.onDiscoverRipePools}
          onSync={props.onSyncRipePool}
          onSyncCstLir={props.onSyncCstLir}
        />
      ) : null}

      {activeRegistryPanel === "ripe-worklist" ? (
        <RipeSyncWorklist resources={props.resources} activeResourceId={props.ripePushResourceId} onOpen={props.onOpen} onPushToRipe={props.onPushToRipe} onRefresh={props.onRefresh} />
      ) : null}

      {activeRegistryPanel === "cst-sync-monitor" ? <CstIntegrationMonitor {...props} /> : null}

      {activeRegistryPanel === "subnet-navigator" ? <SubnetNavigator resources={visible} query={props.globalSearch} isRefreshing={props.navigatorRefreshing} assignmentCoverageCount={props.assignmentCoverageCount} assignmentCoverageLoading={props.assignmentCoverageLoading} assignmentCoverageError={props.assignmentCoverageError} onQuery={props.onGlobalSearch} onRefresh={props.onRefreshNavigator} onOpen={props.onOpen} /> : null}
    </div>
  );
}

function RegistryPanelButton({ active, disabled = false, icon, label, onClick }: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        "flex min-h-[94px] flex-col items-center justify-center gap-2 rounded-lg border bg-card px-3 py-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled ? "cursor-not-allowed border-border/60 opacity-50" : "hover:border-primary/70 hover:bg-muted/20",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
      )}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? `${label} is disabled for now` : label}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-md border bg-background/60 text-current">{icon}</span>
      <span className="text-sm font-semibold leading-tight text-foreground">{label}</span>
    </button>
  );
}
function RipePoolsDiscovery({
  result,
  status,
  actionKey,
  onDiscover,
  onSync,
  onSyncCstLir
}: {
  result: RipeDiscoveryResponse | null;
  status: "idle" | "running" | "complete";
  actionKey: string;
  onDiscover: () => void;
  onSync: (pool: RipeDiscoveredRootPool) => void;
  onSyncCstLir: (pool: RipeDiscoveredRootPool) => void;
}) {
  const rows = result?.rows ?? [];
  const [visibleDiscoveryRows, setVisibleDiscoveryRows] = useState(REPORT_BATCH_SIZE);
  const renderedRows = rows.slice(0, visibleDiscoveryRows);
  const synced = rows.filter((row) => row.local_sync_status === "LIR Synced").length;
  const unsynced = rows.length - synced;
  const running = status === "running";
  useEffect(() => {
    setVisibleDiscoveryRows(REPORT_BATCH_SIZE);
  }, [rows.length]);
  const loadMoreDiscoveryRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, visibleDiscoveryRows, rows.length)) {
      setVisibleDiscoveryRows((current) => Math.min(current + REPORT_BATCH_SIZE, rows.length));
    }
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>RIPE Discovery</CardTitle>
              {running ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-100">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Discovering
                </span>
              ) : status === "complete" ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Complete
                </span>
              ) : null}
            </div>
            <CardDescription>Discover RIPE root inetnum pools by merging mnt-by and mnt-lower maintainer lookups, de-duplicating, and keeping only largest non-contained ranges.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">{rows.length} discovered</Badge>
            <Badge variant="success">{synced} synced</Badge>
            <Badge variant={unsynced ? "warning" : "muted"}>{unsynced} not synced</Badge>
            <Button size="sm" onClick={onDiscover} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              {running ? "Discovering" : "Discover RIPE Pools"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRipeDiscoveryRows(rows, "csv")} disabled={!rows.length}>
              <FileDown className="h-4 w-4" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRipeDiscoveryRows(rows, "xlsx")} disabled={!rows.length}>
              <FileDown className="h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {result?.message ? <p className="text-sm text-muted-foreground">{result.message}</p> : null}
        {rows.length ? <p className="text-xs text-muted-foreground">Showing {Math.min(visibleDiscoveryRows, rows.length)} of {rows.length} discovered RIPE root pools. Export includes all rows.</p> : null}
        <div className="max-h-[420px] overflow-auto rounded-md border" onScroll={loadMoreDiscoveryRows}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pool Name</TableHead>
                <TableHead>Allocation Range</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>Total IPs</TableHead>
                <TableHead>RIPE Maintainer</TableHead>
                <TableHead>RIPE Status</TableHead>
                <TableHead>Local Sync</TableHead>
                <TableHead>CST Sync</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderedRows.map((pool) => {
                const poolKey = ripeDiscoveryPoolKey(pool);
                const localRunning = actionKey === `local:${poolKey}`;
                const cstRunning = actionKey === `cst:${poolKey}`;
                return (
                  <TableRow key={poolKey}>
                    <TableCell className="font-semibold">{pool.pool_name}</TableCell>
                    <TableCell>{pool.allocation_range}</TableCell>
                    <TableCell>{pool.cidr}</TableCell>
                    <TableCell>{formatHosts(pool.total_ips)}</TableCell>
                    <TableCell>{pool.ripe_maintainer}</TableCell>
                    <TableCell>{pool.ripe_status || "-"}</TableCell>
                    <TableCell><Badge variant={pool.local_sync_status === "LIR Synced" ? "success" : "warning"}>{pool.local_sync_status}</Badge></TableCell>
                    <TableCell><Badge variant={pool.cst_sync_status === "CST Synced" ? "success" : pool.cst_sync_status === "Partially Synced" ? "warning" : "muted"}>{pool.cst_sync_status}</Badge></TableCell>
                    <TableCell>{pool.last_sync_date || "-"}</TableCell>
                    <TableCell className="min-w-[260px]">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={localRunning || pool.local_sync_status === "LIR Synced"}
                          title={pool.cidr.includes(",") ? "This RIPE range will be synced as multiple local LIR pools." : "Sync this RIPE root pool to local LIR."}
                          onClick={() => onSync(pool)}
                        >
                          {localRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Sync to Local LIR
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cstRunning || pool.local_sync_status !== "LIR Synced" || pool.cst_sync_status === "CST Synced"}
                          title={pool.local_sync_status !== "LIR Synced" ? "Sync to Local LIR before syncing to CST LIR." : "Mark this local LIR pool as synced to CST LIR."}
                          onClick={() => onSyncCstLir(pool)}
                        >
                          {cstRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Sync to CST LIR
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">
                    Run discovery to retrieve RIPE root pools for the configured maintainer.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ripeDiscoveryPoolKey(pool: RipeDiscoveredRootPool) {
  return `${pool.cidr}-${pool.allocation_range}`;
}

function RipeSyncWorklist({
  resources,
  activeResourceId,
  onOpen,
  onPushToRipe,
  onRefresh
}: {
  resources: ManagedResource[];
  activeResourceId: string;
  onOpen: (resource: ManagedResource) => void;
  onPushToRipe: (resource: ManagedResource) => void;
  onRefresh: () => void;
}) {
  const syncCandidates = presentationResources(resources).filter(isRipePushEligible);
  const pending = syncCandidates.filter((resource) => resource.ripeSyncStatus !== "FAILED").length;
  const failed = syncCandidates.filter((resource) => resource.ripeSyncStatus === "FAILED").length;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>RIPE Sync Worklist</CardTitle>
            <CardDescription>Assignment and application-triggered unassignment rows whose RIPE synchronization is not completed. API execution will be wired in the next release step.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">{pending} pending</Badge>
            <Badge variant={failed ? "danger" : "muted"}>{failed} failed</Badge>
            <Badge variant="default">{syncCandidates.length} eligible</Badge>
            <Button size="sm" variant="outline" onClick={onRefresh} title="Refresh RIPE sync worklist">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[360px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subnet</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>RIPE Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {syncCandidates.map((resource, resourceIndex) => (
                <TableRow key={resourceKey(resource, resourceIndex, "ripe-sync-worklist")}>
                  <TableCell>
                    <p className="font-semibold text-sky-300">{resource.cidr}</p>
                    <p className="text-xs text-muted-foreground">{resource.startIp} - {resource.endIp}</p>
                    <p className="text-xs text-muted-foreground">{resource.uuid}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold">{resource.organizationName || resource.fullName || resource.owner || (resource.administrativeStatus === "AVAILABLE" ? "Unassigned resource" : "Assigned resource")}</p>
                    <p className="text-xs text-muted-foreground">{resource.operationType === "RETIRE" ? "Unassignment" : resource.administrativeStatus === "AVAILABLE" ? "Unassigned" : "Assignment"}</p>
                    <p className="text-xs text-muted-foreground">{resource.serviceId || resource.serviceDescription || resource.transactionId}</p>
                  </TableCell>
                  <TableCell><Badge variant={ripeBadgeVariant(resource.ripeSyncStatus)}>{ripeStatusLabel(resource.ripeSyncStatus)}</Badge></TableCell>
                  <TableCell>{resource.lastUpdated}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => onOpen(resource)}>Review</Button>
                      <Button size="sm" variant={resource.ripeSyncStatus === "FAILED" ? "destructive" : "default"} disabled={activeResourceId === resource.id} onClick={() => onPushToRipe(resource)}>
                        {activeResourceId === resource.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {resource.ripeSyncStatus === "FAILED"
                          ? resource.operationType === "RETIRE" ? "Retry RIPE Removal" : "Retry RIPE Push"
                          : resource.operationType === "RETIRE" ? "Remove from RIPE" : "Push to RIPE"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!syncCandidates.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No assignment or application-triggered unassignment rows are currently eligible for RIPE push.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SubnetNavigator({
  resources,
  query,
  isRefreshing = false,
  assignmentCoverageCount = 0,
  assignmentCoverageLoading = false,
  assignmentCoverageError = false,
  onQuery,
  onRefresh,
  onOpen
}: {
  resources: ManagedResource[];
  query?: string;
  isRefreshing?: boolean;
  assignmentCoverageCount?: number;
  assignmentCoverageLoading?: boolean;
  assignmentCoverageError?: boolean;
  onQuery?: (value: string) => void;
  onRefresh: () => void;
  onOpen: (resource: ManagedResource) => void;
}) {
  const displayResources = presentationSubnets(resources);
  const renderedSubnets = displayResources.slice(0, NAVIGATOR_RENDER_LIMIT);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Subnet Navigator</CardTitle>
              <Badge variant={assignmentCoverageError ? "danger" : assignmentCoverageLoading ? "warning" : "success"}>
                {assignmentCoverageError ? "Assignment coverage failed" : assignmentCoverageLoading ? "Loading assignment coverage" : `${assignmentCoverageCount} assignments loaded`}
              </Badge>
            </div>
            <CardDescription>Only allocated pools are shown here. Select a row to drill into the common Resource Summary page.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            {onQuery ? (
              <Input className="md:max-w-sm" value={query ?? ""} onChange={(event) => onQuery(event.target.value)} placeholder="Search CIDR, resource ID, owner, status, netname" />
            ) : null}
            <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCcw className={cn("h-4 w-4", isRefreshing ? "animate-spin" : "")} />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button variant="outline" onClick={() => exportLocalAllocatedPoolUtilizationRows(localAllocatedPoolUtilizationRows(displayResources), "csv")} disabled={!displayResources.length}>
              <FileDown className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[560px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subnet</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>In Use</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Free</TableHead>
                <TableHead>Usage %</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>RIPE</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderedSubnets.map((subnet, subnetIndex) => (
                  <TableRow key={resourceKey(subnet, subnetIndex, "subnet-navigator")} className="cursor-pointer" onClick={() => onOpen(subnet)}>
                    <TableCell>
                      <p className="font-semibold text-sky-300">{subnet.cidr}</p>
                      <p className="text-xs text-muted-foreground">{subnet.netname}</p>
                      {isRipeAllocatedPoolResource(subnet) ? <AllocatedPoolBadge /> : null}
                      <p className="text-xs text-muted-foreground">{subnet.uuid}</p>
                    </TableCell>
                    <TableCell>
                      <p>{subnet.classification}</p>
                      <p className="text-xs text-muted-foreground">{subnet.owner}</p>
                    </TableCell>
                    <TableCell>{formatHosts(subnet.totalIps)}</TableCell>
                    <TableCell>{formatHosts(subnet.usedIps)}</TableCell>
                    <TableCell>{formatHosts(subnet.reservedIps)}</TableCell>
                    <TableCell>{formatHosts(subnet.freeIps)}</TableCell>
                    <TableCell>{subnet.utilization}%</TableCell>
                    <TableCell><Badge variant={badgeForResource(subnet)}>{subnet.administrativeStatus}</Badge></TableCell>
                    <TableCell><Badge variant={subnet.ripeSyncStatus === "FAILED" ? "danger" : subnet.ripeSyncStatus === "PENDING" ? "warning" : "default"}>{subnet.ripeSyncStatus}</Badge></TableCell>
                    <TableCell>{subnet.lastUpdated}</TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {displayResources.length > renderedSubnets.length ? (
          <p className="mt-3 text-sm text-muted-foreground">Showing first {renderedSubnets.length} of {displayResources.length} subnets. Use registry search to narrow results.</p>
        ) : null}
        {!displayResources.length ? <p className="mt-3 text-sm text-muted-foreground">No subnets match the current registry search.</p> : null}
      </CardContent>
    </Card>
  );
}

function presentationSubnets(resources: ManagedResource[]) {
  return presentationResources(resources.filter((resource) => resource.type === "Subnet"));
}

function registryAllocatedPools(resources: ManagedResource[]) {
  return presentationResources(resources.filter((resource) => isRegisteredSubnet(resource) && isRipeAllocatedPoolResource(resource)));
}

function presentationResources(resources: ManagedResource[]) {
  const byCidr = new Map<string, ManagedResource>();
  for (const resource of resources) {
    const current = byCidr.get(resource.cidr);
    if (!current || presentationSubnetRank(resource) > presentationSubnetRank(current)) {
      byCidr.set(resource.cidr, resource);
    }
  }
  return Array.from(byCidr.values()).sort((left, right) => left.startNumber - right.startNumber || left.prefix - right.prefix);
}

function isAllocatedContainerResource(resource: ManagedResource) {
  return resource.type === "Subnet" && isRipeAllocatedPoolResource(resource) && (resource.usedIps > 0 || resource.reservedIps > 0 || resource.utilization > 0);
}

function isAssignableAvailableResource(resource: ManagedResource) {
  return resource.type === "Subnet" && resource.administrativeStatus === "AVAILABLE" && !isAllocatedContainerResource(resource);
}
function presentationSubnetRank(resource: ManagedResource) {
  if (resource.operationType === "RETIRE" || resource.ripeSyncStatus === "DECOMMISSION_PENDING") {
    return 8;
  }
  if (resource.administrativeStatus === "ASSIGNED" || resource.administrativeStatus === "RESERVED") {
    return 6;
  }
  if (resource.ripeSyncStatus === "PENDING") {
    return 5;
  }
  if (resource.source && !("customer_name" in resource.source)) {
    return 4;
  }
  if (resource.operationType === "CALCULATED_FREE_SPACE") {
    return 1;
  }
  return 2;
}

function ResourceSummary({
  resource,
  resources,
  auditEvents,
  onOpen,
  onReserve,
  onAssign,
  onRelease,
  onRetire,
  onDeleteRetired
}: {
  resource: ManagedResource | null;
  resources: ManagedResource[];
  auditEvents: AuditEvent[];
  onOpen: (resource: ManagedResource) => void;
  onReserve: (resource: ManagedResource) => void;
  onAssign: (resource: ManagedResource) => void;
  onRelease: (resource: ManagedResource) => void;
  onRetire: (resource: ManagedResource) => void;
  onDeleteRetired: (resource: ManagedResource) => void;
}) {
  if (!resource) {
    return <EmptyState title="No Resource Selected" detail="Register or import a subnet to begin using the common Resource Summary page." />;
  }

  const parent = resources.find((item) => item.id === resource.parentId);
  const children = resources
    .filter((item) => item.parentId === resource.id)
    .sort((left, right) => left.startNumber - right.startNumber || left.prefix - right.prefix || resourceTypeLabel(left).localeCompare(resourceTypeLabel(right)));
  const history = auditEvents.filter((event) => event.entity_id === resource.id || event.new_value.includes(resource.cidr) || event.old_value.includes(resource.cidr)).slice(0, 10);
  const actions = resourceActions(resource, children);

  return (
    <div className="grid gap-5">
      <PageTitle title="Resource Summary" description="Common summary page for registered, available, assigned, reserved, retired, and calculated subnet blocks." />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">{resource.cidr}</CardTitle>
              <CardDescription>{resourceTypeLabel(resource)} / {resource.classification} / {resource.owner} / RIPE {resource.ripeSyncStatus}</CardDescription>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <Badge variant={badgeForResource(resource)}>{resource.status}</Badge>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" disabled={!actions.canReserve} title={actions.reserveReason} onClick={() => onReserve(resource)}>
                  Reserve
                </Button>
                <Button size="sm" variant="outline" disabled={!actions.canAssign} title={actions.assignReason} onClick={() => onAssign(resource)}>
                  Assign
                </Button>
                <Button size="sm" variant="outline" disabled={!actions.canRelease} title={actions.releaseReason} onClick={() => onRelease(resource)}>
                  Release
                </Button>
                <Button size="sm" variant="destructive" disabled={!actions.canRetire} title={actions.retireReason} onClick={() => onRetire(resource)}>
                  Retire
                </Button>
                <Button size="sm" variant="destructive" disabled={!actions.canDeleteRetired} title={actions.deleteReason} onClick={() => onDeleteRetired(resource)}>
                  Delete Retired
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <SummaryCard title="Resource Information" rows={[
          ["Resource ID", resource.id],
          ["Resource UUID", resource.uuid],
          ["Version UUID", resource.sourceUuid || resource.uuid],
          ["Transaction ID", resource.transactionId],
          ["CIDR", resource.cidr],
          ["Assignment Status ID", resource.assignmentStatusId],
          ["Parent Resource", parent ? `${parent.cidr} (${parent.id})` : "Root"],
          ["Resource Type", resourceTypeLabel(resource)],
          ["Classification", resource.classification],
          ["Administrative Status", resource.administrativeStatus],
          ["RIPE Sync Status", resource.ripeSyncStatus],
          ["Owner", resource.owner]
        ]} />
        <SummaryCard title="Capacity Information" rows={[
          ["Total IPs", formatHosts(resource.totalIps)],
          ["Used IPs", formatHosts(resource.usedIps)],
          ["Reserved IPs", formatHosts(resource.reservedIps)],
          ["Free IPs", formatHosts(resource.freeIps)],
          ["Utilization", `${resource.utilization}%`],
          ["Range", `${resource.startIp} - ${resource.endIp}`]
        ]} />
        <SummaryCard title="Registry Information" rows={[
          ["Service Provider ID", resource.serviceProviderId],
          ["Service Provider Name", resource.serviceProviderName],
          ["ASN", resource.asn],
          ["Action Flag", resource.actionFlag],
          ["CST Sync Status", resource.cstSyncStatus],
          ["Sync Required", resource.ripeSyncRequired ? "Yes" : "No"],
          ["RIPE Status", resource.ripeSyncStatus],
          ["Transaction ID", resource.transactionId],
          ["Source Registry", resource.sourceRegistry],
          ["Last Updated", resource.lastUpdated]
        ]} />
        <SummaryCard title="RIPE Readiness Attributes" rows={[
          ["Netname", resource.netname],
          ["Description", resource.description],
          ["Country", resource.country],
          ["Maintainer", resource.maintainer],
          ["Source Registry", resource.sourceRegistry]
        ]} />
        <SummaryCard title="Lineage" rows={[
          ["Previous UUID", resource.previousUuid],
          ["Source UUID", resource.sourceUuid],
          ["Successor UUID", resource.successorUuid],
          ["Operation Type", resource.operationType]
        ]} />
        <SummaryCard title="Dynamic Assignment Attributes" rows={[
          ["Service ID", resource.serviceId],
          ["Organization Name", resource.organizationName],
          ["Organization ID", resource.organizationId],
          ["Customer Type ID", resource.customerTypeId],
          ["Customer Type", resource.customerType],
          ["Subnet Type", resource.subnetType],
          ["Product Class", resource.productClass],
          ["Region ID", resource.regionId],
          ["City ID", resource.cityId],
          ["Full Name", resource.fullName],
          ["Mobile Number", resource.mobileNumber],
          ["ID Number", resource.idNumber],
          ["Email", resource.email],
          ["Access Technology ID", resource.accessTechnologyId],
          ["Access Technology", resource.accessTechnology],
          ["Service Description", resource.serviceDescription]
        ]} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Child Resources</CardTitle>
          <CardDescription>Direct children of this resource.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {children.map((child, childIndex) => (
            <button key={resourceKey(child, childIndex, "summary-child")} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-left hover:border-primary/70" type="button" title="Open resource summary" onClick={() => onOpen(child)}>
              <span>
                <span className="block font-semibold">{child.cidr}</span>
                <span className="text-sm text-muted-foreground">{resourceTypeLabel(child)} / {child.owner}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {isRipeAllocatedPoolResource(child) ? <AllocatedPoolBadge /> : null}
                <Badge variant={badgeForResource(child)}>{child.status}</Badge>
              </span>
            </button>
          ))}
          {!children.length ? <p className="text-sm text-muted-foreground">No direct child resources.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Resource History</CardTitle>
          <CardDescription>Create, update, split, merge, assign, release, reserve, and restore events.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {history.map((event) => (
            <div key={event.id} className="rounded-md border bg-muted/20 p-3">
              <p className="font-semibold">{event.action}</p>
              <p className="text-sm text-muted-foreground">{event.user} / {event.timestamp}</p>
            </div>
          ))}
          {!history.length ? <p className="text-sm text-muted-foreground">No resource-specific history yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function LifecycleManagement({ resource, resources, onOpen, onTransition }: { resource: ManagedResource | null; resources: ManagedResource[]; onOpen: (resource: ManagedResource) => void; onTransition: (resource: ManagedResource, status: AdministrativeStatus) => void }) {
  const managed = resources.filter((item) => item.type !== "IP Address");
  return (
    <div className="grid gap-5">
      <PageTitle title="Resource Lifecycle Management" description="AVAILABLE, RESERVED, ASSIGNED, RETIRED, and system-managed HISTORICAL status transitions. Every transition is audited." />
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle Flow</CardTitle>
          <CardDescription>Standard registry state model</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {lifecycleStates.map((state, index) => (
            <span key={state} className="flex items-center gap-2">
              <Badge variant={state === resource?.status ? "success" : "default"}>{state}</Badge>
              {index < lifecycleStates.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
            </span>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Managed Resources</CardTitle>
          <CardDescription>Select a registry resource and apply an allowed lifecycle action.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {managed.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <button className="text-left" onClick={() => onOpen(item)}>
                <p className="font-semibold">{item.cidr}</p>
                <p className="text-sm text-muted-foreground">{item.type} / {item.classification} / {item.owner}</p>
              </button>
              <div className="flex flex-wrap gap-2">
                <Badge variant={badgeForResource(item)}>{item.administrativeStatus}</Badge>
                {userSelectableStatuses.map((status) => (
                  <Button key={status} size="sm" variant="outline" onClick={() => onTransition(item, status)} disabled={!allowedTransitions[item.administrativeStatus].includes(status)}>
                    {status}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ReservationManagement(props: {
  resources: ManagedResource[];
  form: { cidr: string; purpose: string; requestedBy: string; expiryDate: string; notes: string };
  onForm: (value: { cidr: string; purpose: string; requestedBy: string; expiryDate: string; notes: string }) => void;
  onReserve: () => void;
  onRelease: (resource: ManagedResource) => void;
}) {
  const reservations = props.resources.filter((resource) => resource.administrativeStatus === "RESERVED");
  const availableMatches = filterResources(presentationResources(props.resources).filter((resource) => resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet"), props.form.cidr).slice(0, 8);
  const expired = reservations.filter((resource) => resource.source && "reserved_until" in resource.source && resource.source.reserved_until && resource.source.reserved_until < today());
  return (
    <div className="grid gap-5">
      <PageTitle title="Reservation Management" description="Reserve capacity for enterprise expansion, mobile networks, datacenters, and cloud services." />
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Active Reservations" value={String(reservations.length)} detail="Reserved resources" />
        <Metric label="Expired Reservations" value={String(expired.length)} detail="Past expiry date" />
        <Metric label="Upcoming Expirations" value={String(reservations.filter((item) => item.source && "reserved_until" in item.source && item.source.reserved_until).length)} detail="With expiry date" />
        <Metric label="Reserved Capacity" value={formatHosts(reservations.reduce((sum, item) => sum + item.totalIps, 0))} detail="IPs held for future use" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create Reservation</CardTitle>
          <CardDescription>Reservations are registry resources with Reserved lifecycle state.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input value={props.form.cidr} onChange={(event) => props.onForm({ ...props.form, cidr: event.target.value })} placeholder="Search CIDR, UUID, parent allocation" />
          <div className="md:col-span-3">
            <DynamicResourceList resources={availableMatches} selectedId="" onSelect={(resource) => props.onForm({ ...props.form, cidr: resource.cidr })} />
          </div>
          <Input value={props.form.purpose} onChange={(event) => props.onForm({ ...props.form, purpose: event.target.value })} placeholder="Reservation purpose" />
          <Input value={props.form.requestedBy} onChange={(event) => props.onForm({ ...props.form, requestedBy: event.target.value })} placeholder="Requested by" />
          <Input value={props.form.expiryDate} onChange={(event) => props.onForm({ ...props.form, expiryDate: event.target.value })} placeholder="Reserved until" type="datetime-local" />
          <Input className="md:col-span-2" value={props.form.notes} onChange={(event) => props.onForm({ ...props.form, notes: event.target.value })} placeholder="Notes" />
          <Button className="w-fit" onClick={props.onReserve}>
            <Lock className="h-4 w-4" />
            Reserve Resource
          </Button>
        </CardContent>
      </Card>
      <ResourceTable resources={reservations} empty="No active reservations." onRelease={props.onRelease} />
    </div>
  );
}

type AssignmentWorkflow = "assign" | "unassign" | "partial" | "search";

function AssignmentManagement(props: {
  resources: ManagedResource[];
  assignments: Assignment[];
  assignmentTotal: number;
  assignmentPage: number;
  assignmentPageSize: number;
  assignmentTotalPages: number;
  assignmentSearch: string;
  assignmentsLoading: boolean;
  searchQuery: string;
  searchFilters: SearchFilterCriterion[];
  searchRefreshing: boolean;
  searchLastUpdated: number;
  onSearchQuery: (value: string) => void;
  onSearchFilters: (value: SearchFilterCriterion[]) => void;
  onSearchRefresh: () => void;
  onSearchOpen: () => void;
  onAssignmentPage: (page: number) => void;
  onAssignmentPageSize: (pageSize: number) => void;
  onAssignmentSearch: (search: string) => void;
  onOpen: (resource: ManagedResource) => void;
  form: AssignmentPayload;
  poolDraft: PoolAssignmentDraft;
  onForm: (value: AssignmentPayload) => void;
  onPoolDraft: (value: PoolAssignmentDraft) => void;
  onAssign: () => void;
  onRelease: (assignment: Assignment) => void;
  onPartialReassign: (assignment: Assignment, partialCidr: string) => void;
  onStatus: (assignment: Assignment, status: AssignmentStatus) => void;
  onRefreshSiebelAssignment: (assignment: Assignment) => void;
  onLookupSiebelService: (serviceId: string) => void;
}) {
  const [workflow, setWorkflow] = useState<AssignmentWorkflow>("assign");
  const [partialAssignmentId, setPartialAssignmentId] = useState("");
  const [partialCidr, setPartialCidr] = useState("");
  const available = presentationResources(props.resources).filter(isAssignableAvailableResource);
  const parentPoolMatches = filterResources(available, props.poolDraft.poolSearch);
  const assignmentSummary = assignmentDraftSummary(props.form, props.poolDraft, props.resources);
  const partialAssignment = props.assignments.find((assignment) => assignment.id === partialAssignmentId) ?? null;
  const partialSummary = partialReassignmentDraftSummary(partialAssignment, partialCidr, props.resources);
  const mergeForm = (patch: Partial<AssignmentPayload>) => props.onForm({ ...props.form, ...patch });
  const update = <Key extends keyof AssignmentPayload>(key: Key, value: AssignmentPayload[Key]) => mergeForm({ [key]: value } as Partial<AssignmentPayload>);
  const updatePoolDraft = (value: Partial<PoolAssignmentDraft>) => props.onPoolDraft({ ...props.poolDraft, ...value });
  const targetType = props.form.assignment_target_type;
  const dynamicOwnerFields =
    targetType === "business_customer" ? businessBssFields : targetType === "individual" ? individualBssFields : internalAssignmentFields;
  const detailTitle = targetType === "business_customer" ? "Business customer details" : targetType === "individual" ? "Individual customer details" : "Internal assignment details";
  const assignmentTableTitle = workflow === "partial" ? "Choose Original Assignment" : "Unassign Assignments";
  const assignmentTableDescription = workflow === "partial"
    ? "Select the existing CST-reported block that needs to be split and partially reassigned."
    : "Release an assignment, refresh BSS details, or temporarily suspend operational use.";
  const filteredAssignments = props.assignments;
  const resourceByAssignmentId = new Map(props.resources.map((resource) => [resource.source && "customer_name" in resource.source ? resource.source.id : "", resource]));
  const resourceByCidr = new Map(props.resources.map((resource) => [resource.cidr, resource]));
  const resourceForAssignment = (assignment: Assignment) => resourceByAssignmentId.get(assignment.id) ?? resourceByCidr.get(assignment.cidr) ?? null;
  const openAssignmentSummary = (assignment: Assignment) => {
    const resource = resourceForAssignment(assignment);
    if (resource) {
      props.onOpen(resource);
    }
  };

  const openWorkflow = (nextWorkflow: AssignmentWorkflow) => {
    setWorkflow(nextWorkflow);
    if (nextWorkflow !== "partial") {
      setPartialAssignmentId("");
      setPartialCidr("");
    } else if (partialAssignment && !partialCidr.trim()) {
      setPartialCidr(partialAssignment.cidr);
    }
  };

  const selectPartialAssignment = (assignment: Assignment) => {
    setWorkflow("partial");
    setPartialAssignmentId(assignment.id);
    setPartialCidr(assignment.cidr);
    props.onForm({
      ...props.form,
      ...assignment,
      cidr: assignment.cidr,
      assignment_date: props.form.assignment_date || assignment.assignment_date || today()
    });
  };

  const workflowTiles: Array<{
    id: string;
    title: string;
    description: string;
    metric: string;
    icon: typeof Network;
    action: () => void;
    active: boolean;
  }> = [
    {
      id: "assign",
      title: "Assign IP",
      description: "Create a new assignment from an available subnet or IP range.",
      metric: `${available.length} available subnet${available.length === 1 ? "" : "s"}`,
      icon: Network,
      action: () => openWorkflow("assign"),
      active: workflow === "assign"
    },
    {
      id: "unassign",
      title: "Unassign IP",
      description: "Release an existing assignment without mixing it with creation steps.",
      metric: `${props.assignmentTotal} current assignment${props.assignmentTotal === 1 ? "" : "s"}`,
      icon: ArchiveRestore,
      action: () => openWorkflow("unassign"),
      active: workflow === "unassign"
    },
    {
      id: "partial",
      title: "Partial Reassign",
      description: "Split one reported block into assigned and unassigned CST fragments.",
      metric: partialAssignment ? `Selected ${partialAssignment.cidr}` : "Select original block",
      icon: GitBranch,
      action: () => openWorkflow("partial"),
      active: workflow === "partial"
    },
    {
      id: "global-search",
      title: "Global Search",
      description: "Search CIDR, resource, transaction, customer, service, owner, and status without leaving Assignment Management.",
      metric: "CIDR and transaction lookup",
      icon: Search,
      action: () => { props.onSearchOpen(); openWorkflow("search"); },
      active: workflow === "search"
    }
  ];
  const assignmentDetailsPanel = (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-semibold">{workflow === "partial" ? "1. Assigned Fragment Details" : "2. Enter Details"}</p>
          <p className="text-xs text-muted-foreground">Choose the assignment owner type, operational status, date, and required dynamic attributes.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Assigned to</span>
            <Select
              value={props.form.assignment_target_type}
              values={assignedToOptions}
              labels={assignmentTargetLabels}
              onChange={(assignmentTarget) => mergeForm(assignmentDefaultsForTarget(assignmentTarget as AssignmentPayload["assignment_target_type"], props.form))}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Operational status</span>
            <Select value={operationalStatuses.includes(props.form.status) ? props.form.status : "Active"} values={operationalStatuses} onChange={(status) => update("status", status as AssignmentStatus)} />
          </label>
          <Input value={props.form.assignment_date} onChange={(event) => update("assignment_date", event.target.value)} placeholder="Assignment date" type="date" />
          <Input value={props.form.requested_by} onChange={(event) => update("requested_by", event.target.value)} placeholder="Requested by" />
          <Input value={props.form.approved_by} onChange={(event) => update("approved_by", event.target.value)} placeholder="Approved by" />
          <Input value={props.form.approval_reference} onChange={(event) => update("approval_reference", event.target.value)} placeholder="Approval reference" />
          <div className="flex flex-wrap items-center gap-2 md:col-span-4">
            <Badge variant="default">Assignment lifecycle: ASSIGNED</Badge>
            <Badge variant="default">CST assignmentStatusId: {assignmentStatusByTarget[targetType]}</Badge>
            <Badge variant={props.form.status === "Blocked" ? "danger" : "success"}>Operational: {operationalStatuses.includes(props.form.status) ? props.form.status : "Active"}</Badge>
          </div>
        </div>
        {targetType === "business_customer" ? (
          <div className="grid gap-3 rounded-md border bg-background/40 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">BSS service ID</span>
              <Input value={props.form.service_id} onChange={(event) => update("service_id", event.target.value)} placeholder="Service ID" />
            </label>
            <Button variant="secondary" onClick={() => props.onLookupSiebelService(props.form.service_id)} disabled={!props.form.service_id.trim()}>
              <Search className="h-4 w-4" />
              Query Siebel
            </Button>
            <p className="text-xs text-muted-foreground md:col-span-2">Fetch business customer details from Siebel by service ID and populate the fields below. Customer ID is synced as data, not used as the key.</p>
          </div>
        ) : null}
        <AssignmentFieldGroup title={detailTitle} fields={dynamicOwnerFields} form={props.form} onChange={update} />
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-semibold">{workflow === "partial" ? "2. Notes" : "3. Notes"}</p>
          <p className="text-xs text-muted-foreground">Optional operational notes for this assignment.</p>
        </div>
        <Textarea value={props.form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Assignment notes" />
      </div>
    </div>
  );

  const renderAssignmentForm = () => (
    <Card>
      <CardHeader>
        <CardTitle>{workflow === "partial" ? "Partial Reassignment Details" : "Assign IP"}</CardTitle>
        <CardDescription>
          {workflow === "partial"
            ? "Define the reassigned fragment and the owner details that will be sent to CST after the original block is retired."
            : "Assignments consume a registry resource and attach owner, service, contact, and transaction context."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {workflow === "assign" ? <AssignmentSteps currentStep={assignmentSummary.cidr ? (props.form.service_id || props.form.full_name || props.form.internal_application_name || props.form.requested_by ? 3 : 2) : 1} /> : null}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3">
            {workflow === "assign" ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-semibold">1. Select IP Range</p>
                  <p className="text-xs text-muted-foreground">Select an available subnet or enter a start IP and end IP that form one valid CIDR block.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Selection method</span>
                    <Select value={props.poolDraft.selectionMode} values={["subnet", "range"]} labels={{ subnet: "Select available subnet", range: "Enter start and end IP" }} onChange={(selectionMode) => updatePoolDraft({ selectionMode: selectionMode as PoolAssignmentDraft["selectionMode"] })} />
                  </label>
                  {props.poolDraft.selectionMode === "subnet" ? (
                    <>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Subnet search</span>
                        <Input value={props.poolDraft.poolSearch} onChange={(event) => updatePoolDraft({ poolSearch: event.target.value })} placeholder="Search available subnet by CIDR, name, UUID, owner" />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Start IP</span>
                        <Input value={props.poolDraft.startIp} onChange={(event) => updatePoolDraft({ startIp: event.target.value })} placeholder="Start IP" />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Prefix</span>
                        <Input value={props.poolDraft.prefix} onChange={(event) => updatePoolDraft({ prefix: event.target.value })} placeholder="Subnet prefix, e.g. 24" />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Start IP</span>
                        <Input value={props.poolDraft.startIp} onChange={(event) => updatePoolDraft({ startIp: event.target.value })} placeholder="Start IP" />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">End IP</span>
                        <Input value={props.poolDraft.endIp} onChange={(event) => updatePoolDraft({ endIp: event.target.value })} placeholder="End IP" />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium text-muted-foreground">Computed CIDR</span>
                        <Input value={assignmentSummary.cidr} readOnly placeholder="Computed CIDR" />
                      </label>
                    </>
                  )}
                </div>
                {props.poolDraft.selectionMode === "subnet" ? (
                  <DynamicResourceList resources={parentPoolMatches} selectedId={props.poolDraft.parentPoolId} onSelect={(resource) => updatePoolDraft({ parentPoolId: resource.id, poolSearch: resource.cidr, startIp: resource.startIp, endIp: resource.endIp, prefix: String(resource.prefix) })} />
                ) : null}
                {visibleAssignmentError(assignmentSummary.error) ? <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">{assignmentSummary.error}</p> : null}
              </div>
            ) : (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_260px] md:items-end">
                <div className="text-sm">
                  <p className="font-semibold">Original block: {partialAssignment?.cidr ?? "Select an assignment below"}</p>
                  <p className="mt-1 text-muted-foreground">The requested CIDR can shrink within the original block or expand around it when the added addresses are free in the same managed pool. CST will receive UpdateLIRData, DeleteLIRData, then SendLIRData for each revised block.</p>
                </div>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">To-be assignment CIDR</span>
                  <Input value={partialCidr} onChange={(event) => setPartialCidr(event.target.value)} placeholder={partialAssignment?.cidr ?? "e.g. 172.20.40.0/24"} />
                </label>
              </div>
            )}
            {assignmentDetailsPanel}
          </div>
          {workflow === "assign" ? (
            <AssignmentReviewCard summary={assignmentSummary} form={props.form} onAssign={props.onAssign} />
          ) : (
            <PartialReassignmentReviewCard
              summary={partialSummary}
              form={props.form}
              originalAssignment={partialAssignment}
              onRun={() => partialAssignment && props.onPartialReassign(partialAssignment, partialCidr.trim())}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderAssignmentTable = () => (
    <Card>
      <CardHeader>
        <CardTitle>{assignmentTableTitle}</CardTitle>
        <CardDescription>{assignmentTableDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Search assignments</span>
            <Input value={props.assignmentSearch} onChange={(event) => props.onAssignmentSearch(event.target.value)} placeholder="Search CIDR, owner, service ID, status, contact" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{filteredAssignments.length} of {props.assignmentTotal}</Badge>
            <Select value={String(props.assignmentPageSize)} values={["50", "100", "200", "500"]} labels={{ "50": "50 / page", "100": "100 / page", "200": "200 / page", "500": "500 / page" }} onChange={(value) => props.onAssignmentPageSize(Number(value))} />
            {props.assignmentSearch ? <Button type="button" variant="outline" onClick={() => props.onAssignmentSearch("")}>Clear</Button> : null}
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CIDR</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>BSS Sync</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.assignmentsLoading ? (
                <TableRow><TableCell colSpan={8}>Loading assignments...</TableCell></TableRow>
              ) : filteredAssignments.length ? filteredAssignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell className="font-semibold">
                    <button type="button" className="text-left text-sky-300 underline-offset-2 hover:underline" onClick={() => openAssignmentSummary(assignment)} title="Open resource summary">
                      {assignment.cidr}
                    </button>
                  </TableCell>
                  <TableCell>{resourceForAssignment(assignment)?.owner || "-"}</TableCell>
                  <TableCell>{assignedToLabelForAssignment(assignment)}</TableCell>
                  <TableCell>{assignmentDisplayName(assignment)}</TableCell>
                  <TableCell><Badge variant={assignment.status === "Blocked" ? "danger" : assignment.status === "Reserved" ? "warning" : "success"}>{assignment.status}</Badge></TableCell>
                  <TableCell>{assignment.service_instance_id || assignment.id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{assignment.siebel_last_sync_at ? formatDateTime(assignment.siebel_last_sync_at) : assignment.siebel_last_checked_at ? `Checked ${formatDateTime(assignment.siebel_last_checked_at)}` : "Not synced"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {workflow === "partial" ? (
                        <Button size="sm" variant={partialAssignmentId === assignment.id ? "default" : "secondary"} onClick={() => selectPartialAssignment(assignment)}>{partialAssignmentId === assignment.id ? "Selected" : "Use for Partial"}</Button>
                      ) : (
                        <>
                          {assignment.assignment_target_type === "business_customer" && assignment.service_id ? (
                            <Button size="sm" variant="secondary" onClick={() => props.onRefreshSiebelAssignment(assignment)}>Refresh BSS</Button>
                          ) : null}
                          <Button size="sm" variant="outline" onClick={() => props.onStatus(assignment, assignment.status === "Blocked" ? "Active" : "Blocked")}>{assignment.status === "Blocked" ? "Resume" : "Suspend"}</Button>
                          <Button size="sm" variant="secondary" onClick={() => selectPartialAssignment(assignment)}>Partial Reassign</Button>
                          <Button size="sm" variant="destructive" onClick={() => props.onRelease(assignment)}>Unassign</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">{props.assignmentTotal ? "No assignments match the search." : "No assignments found."}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">Page {props.assignmentPage} of {props.assignmentTotalPages} | {props.assignmentTotal} total assignments</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => props.onAssignmentPage(Math.max(props.assignmentPage - 1, 1))} disabled={props.assignmentPage <= 1 || props.assignmentsLoading}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => props.onAssignmentPage(Math.min(props.assignmentPage + 1, props.assignmentTotalPages))} disabled={props.assignmentPage >= props.assignmentTotalPages || props.assignmentsLoading}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="grid gap-5">
      <PageTitle title="Assignment Management" description="Choose Assign, Unassign, Partial Reassign, or search registry resources in-place." />
      <div className="grid gap-3 lg:grid-cols-4">
        {workflowTiles.map((tile) => {
          const Icon = tile.icon;
          const active = tile.active;
          return (
            <button
              key={tile.id}
              type="button"
              onClick={tile.action}
              className={cn(
                "rounded-md border bg-card p-4 text-left transition hover:border-primary/70 hover:bg-muted/20",
                active && "border-primary bg-primary/10 shadow-sm"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn("rounded-md border p-2", active ? "border-primary/50 bg-primary/15 text-primary" : "bg-muted/20 text-muted-foreground")}>
                  <Icon className="h-5 w-5" />
                </span>
                <Badge variant={active ? "default" : "muted"}>{tile.metric}</Badge>
              </div>
              <p className="mt-4 text-base font-semibold">{tile.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{tile.description}</p>
            </button>
          );
        })}
      </div>
      {workflow === "assign" ? renderAssignmentForm() : null}
      {workflow === "unassign" ? renderAssignmentTable() : null}
      {workflow === "partial" ? (
        <>
          {partialAssignment ? renderAssignmentForm() : null}
          {renderAssignmentTable()}
        </>
      ) : null}
      {workflow === "search" ? (
        <GlobalSearchPanel
          resources={props.resources}
          query={props.searchQuery}
          filters={props.searchFilters}
          isRefreshing={props.searchRefreshing}
          lastUpdated={props.searchLastUpdated}
          onQuery={props.onSearchQuery}
          onFilters={props.onSearchFilters}
          onRefresh={props.onSearchRefresh}
          onOpen={props.onOpen}
          scope="assignment-global-search"
        />
      ) : null}
    </div>
  );
}
function DynamicResourceList({ resources, selectedId, onSelect }: { resources: ManagedResource[]; selectedId: string; onSelect: (resource: ManagedResource) => void }) {
  const displayResources = presentationResources(resources);
  if (!displayResources.length) {
    return <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">No matching resources.</p>;
  }
  return (
    <div className="grid max-h-72 gap-2 overflow-auto pr-1">
      {displayResources.map((resource, resourceIndex) => (
        <button
          key={resourceKey(resource, resourceIndex, "dynamic-resource")}
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-left hover:border-primary/70",
            selectedId === resource.id && "border-primary bg-primary/10"
          )}
          onClick={() => onSelect(resource)}
          type="button"
        >
          <span>
            <span className="block font-semibold">{resource.cidr}</span>
            <span className="text-sm text-muted-foreground">{resource.uuid} / {resource.classification} / {resource.administrativeStatus}</span>
          </span>
          <ResourceTypeBadge resource={resource} />
        </button>
      ))}
    </div>
  );
}

function AssignmentSteps({ currentStep }: { currentStep: number }) {
  const steps = ["Select IP Range", "Enter Details", "Review & Submit"];
  return (
    <div className="grid gap-2 rounded-md border bg-muted/10 p-3 md:grid-cols-3">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = currentStep >= number;
        return (
          <div key={step} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {number}
            </span>
            <span className={cn("text-sm font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

type AssignmentDraftSummary = {
  cidr: string;
  range: Range | null;
  sourceSubnet: ManagedResource | null;
  error: string;
};

type PartialReassignmentSummary = {
  originalCidr: string;
  requestedCidr: string;
  originalRange: Range | null;
  requestedRange: Range | null;
  sourceSubnet: ManagedResource | null;
  mode: string;
  assignedFragments: Range[];
  unassignedFragments: Range[];
  additionalAssignedFragments: Range[];
  error: string;
};

function AssignmentReviewCard({
  summary,
  form,
  onAssign
}: {
  summary: AssignmentDraftSummary;
  form: AssignmentPayload;
  onAssign: () => void;
}) {
  const usable = summary.range ? (summary.range.prefix >= 31 ? summary.range.size : Math.max(0, summary.range.size - 2)) : 0;
  const remaining = summary.sourceSubnet && summary.range ? Math.max(0, summary.sourceSubnet.totalIps - summary.range.size) : 0;
  const owner = assignmentOwnerLabel(form);
  const service = form.service_id || form.service_description || form.internal_application_name || "-";
  const ready = Boolean(summary.cidr && !summary.error);
  return (
    <aside className="grid content-start gap-4 rounded-md border bg-muted/20 p-4">
      <div>
        <p className="text-lg font-semibold">Assignment Summary</p>
        <p className="text-sm text-muted-foreground">Review the computed allocation before submit.</p>
      </div>
      <div className="grid gap-1 border-b pb-4">
        <span className="text-xs font-medium uppercase text-muted-foreground">Subnet</span>
        <span className="text-2xl font-semibold">{summary.cidr || "Select IP range"}</span>
        <span className="text-sm text-muted-foreground">{summary.sourceSubnet?.classification ?? "PUBLIC"}</span>
      </div>
      <DetailRows rows={[
        ["Source Subnet", summary.sourceSubnet?.cidr ?? "-"],
        ["Assignment Range", summary.range ? `${numberToIp(summary.range.start)} - ${numberToIp(summary.range.end)}` : "-"],
        ["Usable Range", summary.range ? `${summary.range.firstUsable} - ${summary.range.lastUsable}` : "-"],
        ["Usable IPs", summary.range ? formatHosts(usable) : "-"],
        ["Remaining Available", summary.range ? formatHosts(remaining) : "-"],
        ["CIDR Block Size", summary.range ? formatHosts(summary.range.size) : "-"],
        ["Customer", owner || "-"],
        ["Service", service],
        ["Operational Status", form.status === "Blocked" ? "Blocked" : "Active"],
        ["Assignment Date", form.assignment_date || "-"]
      ]} />
      {visibleAssignmentError(summary.error) ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">{summary.error}</p>
      ) : (
        <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
          After assignment, this CIDR will no longer be available for other use.
        </p>
      )}
      <Button onClick={onAssign} disabled={!ready}>
        Create Assignment
      </Button>
    </aside>
  );
}

function PartialReassignmentReviewCard({
  summary,
  form,
  originalAssignment,
  onRun
}: {
  summary: PartialReassignmentSummary;
  form: AssignmentPayload;
  originalAssignment: Assignment | null;
  onRun: () => void;
}) {
  const owner = assignmentOwnerLabel(form);
  const service = form.service_id || form.service_description || form.internal_application_name || "-";
  const usable = summary.requestedRange ? (summary.requestedRange.prefix >= 31 ? summary.requestedRange.size : Math.max(0, summary.requestedRange.size - 2)) : 0;
  const ready = Boolean(originalAssignment && summary.requestedCidr && !summary.error && summary.requestedCidr !== summary.originalCidr);
  const resultRows = [
    ...summary.assignedFragments.map((fragment) => ({ type: "Assigned", fragment })),
    ...summary.unassignedFragments.map((fragment) => ({ type: "Unassigned", fragment }))
  ];
  return (
    <aside className="grid content-start gap-4 rounded-md border bg-muted/20 p-4">
      <div>
        <p className="text-lg font-semibold">Assignment Summary</p>
        <p className="text-sm text-muted-foreground">Review the partial reassignment before submit.</p>
      </div>
      <div className="grid gap-1 border-b pb-4">
        <span className="text-xs font-medium uppercase text-muted-foreground">To-be Subnet</span>
        <span className="text-2xl font-semibold">{summary.requestedCidr || "Select original block"}</span>
        <span className="text-sm text-muted-foreground">{summary.sourceSubnet?.classification ?? "PUBLIC"}</span>
      </div>
      <DetailRows rows={[
        ["Original Block", summary.originalCidr || "-"],
        ["Operation", summary.mode || "-"],
        ["Source Subnet", summary.sourceSubnet?.cidr ?? summary.originalCidr ?? "-"],
        ["Assignment Range", summary.requestedRange ? `${numberToIp(summary.requestedRange.start)} - ${numberToIp(summary.requestedRange.end)}` : "-"],
        ["Usable Range", summary.requestedRange ? `${summary.requestedRange.firstUsable} - ${summary.requestedRange.lastUsable}` : "-"],
        ["Usable IPs", summary.requestedRange ? formatHosts(usable) : "-"],
        ["CIDR Block Size", summary.requestedRange ? formatHosts(summary.requestedRange.size) : "-"],
        ["Customer", owner || "-"],
        ["Organization ID", form.organization_id || form.customer_id || "-"],
        ["Service", service],
        ["Contact", form.full_name || form.contact_name || "-"],
        ["Mobile", form.mobile_number || form.contact_number || "-"],
        ["Email", form.email || form.contact_email || "-"],
        ["Operational Status", form.status === "Blocked" ? "Blocked" : "Active"],
        ["Assignment Date", form.assignment_date || "-"]
      ]} />
      <div className="grid gap-2 rounded-md border bg-background/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Resulting CIDRs</p>
          <Badge variant="muted">{resultRows.length} block{resultRows.length === 1 ? "" : "s"}</Badge>
        </div>
        <div className="max-h-[220px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resultRows.length ? resultRows.map(({ type, fragment }) => (
                <TableRow key={`${type}-${fragment.cidr}`}>
                  <TableCell><Badge variant={type === "Assigned" ? "success" : "muted"}>{type}</Badge></TableCell>
                  <TableCell className="font-semibold">{fragment.cidr}</TableCell>
                  <TableCell>{numberToIp(fragment.start)} - {numberToIp(fragment.end)}</TableCell>
                  <TableCell>{formatHosts(fragment.size)}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-5 text-center text-sm text-muted-foreground">Change the to-be CIDR to preview resulting blocks.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {summary.additionalAssignedFragments.length ? (
          <p className="text-xs text-muted-foreground">Additional assigned portion: {summary.additionalAssignedFragments.map((fragment) => fragment.cidr).join(", ")}</p>
        ) : null}
      </div>
      {visibleAssignmentError(summary.error) ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">{summary.error}</p>
      ) : (
        <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
          Local reassignment completes only after all mandatory CST calls succeed. Failed fragments remain retryable under the same operation.
        </p>
      )}
      <Button type="button" disabled={!ready} onClick={onRun}>Run Partial Reassignment</Button>
    </aside>
  );
}

function DetailRows({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <div className="grid gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-b-0">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="max-w-[180px] break-words text-right text-sm font-semibold">{value || "N/A"}</span>
        </div>
      ))}
    </div>
  );
}

type AssignmentFieldDefinition = {
  key: keyof AssignmentPayload;
  label: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  options?: Array<{ value: string; label: string }>;
};

function AssignmentFieldGroup({
  title,
  fields,
  form,
  onChange
}: {
  title: string;
  fields: AssignmentFieldDefinition[];
  form: AssignmentPayload;
  onChange: <Key extends keyof AssignmentPayload>(key: Key, value: AssignmentPayload[Key]) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-muted/10 p-3 md:grid-cols-4">
      <div className="md:col-span-4">
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {fields.map((field) => (
        <label key={String(field.key)} className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {field.label}{field.required ? " *" : ""}
          </span>
          {field.options ? (
            <Select
              value={String(form[field.key] ?? "")}
              values={field.options.map((option) => option.value)}
              labels={Object.fromEntries(field.options.map((option) => [option.value, option.label]))}
              onChange={(value) => onChange(field.key, value as AssignmentPayload[typeof field.key])}
            />
          ) : (
            <Input
              value={String(form[field.key] ?? "")}
              onChange={(event) => onChange(field.key, event.target.value as AssignmentPayload[typeof field.key])}
              placeholder={field.placeholder}
              disabled={field.disabled}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function CapacityManagement({ resources }: { resources: ManagedResource[] }) {
  return (
    <div className="grid gap-5">
      <PageTitle title="Capacity Management" description="Capacity planning and exhaustion forecasting are temporarily disabled." />
      <Card className="border-amber-500/50 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-200">
            <CalendarClock className="h-5 w-5" />
            Under Construction
          </CardTitle>
          <CardDescription>
            Forecasting is disabled until real historical consumption data and approved planning rules are added.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-amber-100">
          <p>No prediction or exhaustion date is currently calculated.</p>
          <p>Available resources remain visible in Resource Registry, Search, and operation pages.</p>
          <p>Registered resources currently loaded: {resources.length}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SubnetOperations(props: {
  pools: Pool[];
  resources: ManagedResource[];
  splitForm: { poolId: string; search: string; prefix: string; direction: PartitionDirection };
  mergeForm: { leftPoolId: string; rightPoolId: string; leftSearch: string; rightSearch: string };
  onSplitForm: (value: { poolId: string; search: string; prefix: string; direction: PartitionDirection }) => void;
  onMergeForm: (value: { leftPoolId: string; rightPoolId: string; leftSearch: string; rightSearch: string }) => void;
  onSplit: () => void;
  onMerge: () => void;
}) {
  const searchablePools = presentationResources(props.resources).filter((resource) => resource.type === "Subnet" && !isRipeAllocatedPoolResource(resource));
  const splitMatches = filterResources(searchablePools, props.splitForm.search).slice(0, 8);
  const leftMatches = filterResources(searchablePools, props.mergeForm.leftSearch).slice(0, 6);
  const rightMatches = filterResources(searchablePools, props.mergeForm.rightSearch).slice(0, 6);
  return (
    <div className="grid gap-5">
      <PageTitle title="Subnet Operations" description="Split and merge registry resources with adjacency, parent, status, and CIDR validation." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Split Resource</CardTitle>
            <CardDescription>Example: 5.42.224.0/24 into two /25 resources.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input value={props.splitForm.search} onChange={(event) => props.onSplitForm({ ...props.splitForm, search: event.target.value })} placeholder="Search subnet, UUID, parent allocation, description" />
            <DynamicResourceList resources={splitMatches} selectedId={props.splitForm.poolId} onSelect={(resource) => props.onSplitForm({ ...props.splitForm, poolId: resource.id, search: resource.cidr })} />
            <Input value={props.splitForm.prefix} onChange={(event) => props.onSplitForm({ ...props.splitForm, prefix: event.target.value })} placeholder="Target prefix" />
            <Select value={props.splitForm.direction} values={["start", "end"]} labels={{ start: "Start of resource", end: "End of resource" }} onChange={(direction) => props.onSplitForm({ ...props.splitForm, direction: direction as PartitionDirection })} />
            <Button onClick={props.onSplit}>
              <GitBranch className="h-4 w-4" />
              Split Resource
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Merge Resources</CardTitle>
            <CardDescription>Validation requires adjacent resources with same parent and same status.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input value={props.mergeForm.leftSearch} onChange={(event) => props.onMergeForm({ ...props.mergeForm, leftSearch: event.target.value })} placeholder="Search first subnet" />
            <DynamicResourceList resources={leftMatches} selectedId={props.mergeForm.leftPoolId} onSelect={(resource) => props.onMergeForm({ ...props.mergeForm, leftPoolId: resource.id, leftSearch: resource.cidr })} />
            <Input value={props.mergeForm.rightSearch} onChange={(event) => props.onMergeForm({ ...props.mergeForm, rightSearch: event.target.value })} placeholder="Search second subnet" />
            <DynamicResourceList resources={rightMatches} selectedId={props.mergeForm.rightPoolId} onSelect={(resource) => props.onMergeForm({ ...props.mergeForm, rightPoolId: resource.id, rightSearch: resource.cidr })} />
            <Button onClick={props.onMerge}>
              <GitMerge className="h-4 w-4" />
              Merge Resources
            </Button>
          </CardContent>
        </Card>
      </div>
      <ResourceTable resources={presentationResources(props.resources).filter((resource) => resource.administrativeStatus === "AVAILABLE")} empty="No available resources for structural operations." />
    </div>
  );
}

function IntegrityManagement({ conflicts, resources, onOpen, onAcceptAssignment, onRejectAssignment, onAutoResolveExactDuplicates }: { conflicts: Conflict[]; resources: ManagedResource[]; onOpen: (resource: ManagedResource) => void; onAcceptAssignment: (assignmentId: string) => void; onRejectAssignment: (assignmentId: string) => void; onAutoResolveExactDuplicates: () => void }) {
  const derivedIssues = detectIntegrityIssues(resources);
  const [selectedConflictKey, setSelectedConflictKey] = useState("");
  const conflictItems = conflicts.map((conflict, index) => ({ conflict, key: conflictKey(conflict, index), sides: conflictSides(conflict, resources) }));
  const selectedConflict = conflictItems.find((item) => item.key === selectedConflictKey) ?? conflictItems[0] ?? null;
  return (
    <div className="grid gap-5">
      <PageTitle title="Integrity & Conflict Management" description="Operational module for overlaps, duplicates, invalid CIDR structures, orphan resources, and registry inconsistencies." />
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Auto Resolve Pending Discrepancies</CardTitle>
              <CardDescription>Accepts the first assignment only when the IP subnet and customer name are exactly the same; duplicate rows are rejected locally.</CardDescription>
            </div>
            <Button onClick={onAutoResolveExactDuplicates} disabled={!conflicts.length}>
              <CheckCircle2 className="h-4 w-4" />
              Auto Resolve Exact Duplicates
            </Button>
          </div>
        </CardHeader>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Critical" value={String(conflicts.filter((item) => item.severity === "critical").length)} detail="Must be resolved" />
        <Metric label="Major" value={String(conflicts.filter((item) => item.severity === "warning").length + derivedIssues.filter((item) => item.severity === "Major").length)} detail="Operational risk" />
        <Metric label="Minor" value={String(conflicts.filter((item) => item.severity === "info").length + derivedIssues.filter((item) => item.severity === "Minor").length)} detail="Review recommended" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Integrity Findings</CardTitle>
          <CardDescription>Live API conflicts plus registry-derived validation checks.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
          <div className="grid max-h-[620px] content-start gap-2 overflow-auto pr-1">
            {conflictItems.map(({ conflict, key, sides }) => (
              <button
                key={key}
                className={cn(
                  "rounded-md border bg-muted/20 p-3 text-left transition hover:border-primary/70",
                  selectedConflict?.key === key && "border-primary bg-primary/10"
                )}
                type="button"
                onClick={() => setSelectedConflictKey(key)}
              >
                <Badge variant={conflict.severity === "critical" ? "danger" : conflict.severity === "warning" ? "warning" : "default"}>{conflict.severity}</Badge>
                <p className="mt-2 font-semibold">{conflict.title}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{conflict.detail}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {sides.left?.cidr ?? "Source N/A"} conflicts with {sides.right?.cidr ?? "Target N/A"}
                </p>
              </button>
            ))}
            {derivedIssues.map((issue) => (
              <div key={issue.title} className="rounded-md border bg-muted/20 p-3">
                <Badge variant={issue.severity === "Major" ? "warning" : "default"}>{issue.severity}</Badge>
                <p className="mt-2 font-semibold">{issue.title}</p>
                <p className="text-sm text-muted-foreground">{issue.detail}</p>
              </div>
            ))}
            {!conflicts.length && !derivedIssues.length ? <p className="text-sm text-muted-foreground">No integrity issues detected.</p> : null}
          </div>
          <ConflictReviewPanel item={selectedConflict} onOpen={onOpen} onAcceptAssignment={onAcceptAssignment} onRejectAssignment={onRejectAssignment} />
        </CardContent>
      </Card>
    </div>
  );
}

function ConflictReviewPanel({ item, onOpen, onAcceptAssignment, onRejectAssignment }: { item: { conflict: Conflict; key: string; sides: ReturnType<typeof conflictSides> } | null; onOpen: (resource: ManagedResource) => void; onAcceptAssignment: (assignmentId: string) => void; onRejectAssignment: (assignmentId: string) => void }) {
  if (!item) {
    return (
      <div className="rounded-md border bg-muted/10 p-4">
        <p className="font-semibold">Conflict Review</p>
        <p className="mt-2 text-sm text-muted-foreground">Select an integrity finding to review source and target subnets.</p>
      </div>
    );
  }
  return (
    <div className="grid content-start gap-4 rounded-md border bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Conflict Review</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.conflict.title}</p>
        </div>
        <Badge variant={item.conflict.severity === "critical" ? "danger" : item.conflict.severity === "warning" ? "warning" : "default"}>{item.conflict.severity}</Badge>
      </div>
      <p className="rounded-md border bg-background/40 p-3 text-sm text-muted-foreground">{item.conflict.detail}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <ConflictSide label="Source Subnet" side={item.sides.left} onOpen={onOpen} />
        <ConflictSide label="Target Subnet" side={item.sides.right} onOpen={onOpen} />
      </div>
      {item.conflict.title === "Customer assignments overlap" && item.conflict.assignment_ids?.filter(Boolean).length ? (
        <div className="rounded-md border bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Migration Resolution</p>
              <p className="mt-1 text-sm text-muted-foreground">Reject the incorrect candidate, then accept/re-check the one to keep.</p>
            </div>
            {item.conflict.resolution_status ? <Badge variant="warning">{item.conflict.resolution_status.replace(/_/g, " ")}</Badge> : null}
          </div>
          <div className="mt-3 grid gap-2">
            {item.conflict.assignment_ids.filter(Boolean).map((assignmentId, index) => (
              <div key={assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{item.conflict.ranges[index] ?? `Assignment ${index + 1}`}</p>
                  <p className="break-all text-xs text-muted-foreground">Assignment ID: {assignmentId}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" type="button" onClick={() => onAcceptAssignment(assignmentId)}>Accept / Re-check</Button>
                  <Button size="sm" variant="destructive" type="button" onClick={() => onRejectAssignment(assignmentId)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {item.conflict.ranges.length > 2 ? (
        <div className="rounded-md border bg-background/40 p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Additional Ranges</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.conflict.ranges.slice(2).map((range) => <Badge key={range} variant="default">{range}</Badge>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ConflictSideInfo = {
  cidr: string;
  resource: ManagedResource | null;
};

function conflictResourceOrganization(resource: ManagedResource) {
  const sourceCustomer = resource.source && "customer_name" in resource.source ? resource.source.customer_name : "";
  return resource.organizationName || sourceCustomer || resource.fullName || resource.netname || "N/A";
}

function ConflictSide({ label, side, onOpen }: { label: string; side: ConflictSideInfo | null; onOpen: (resource: ManagedResource) => void }) {
  if (!side) {
    return (
      <div className="rounded-md border bg-background/40 p-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">Not applicable</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-sky-300">{side.cidr}</p>
      {side.resource ? (
        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
          <span>UUID: {side.resource.uuid}</span>
          <span>Status: {side.resource.administrativeStatus}</span>
          <span>Organization: {conflictResourceOrganization(side.resource)}</span>
          <span>Range: {side.resource.startIp} - {side.resource.endIp}</span>
          <Button className="mt-2 w-fit" size="sm" variant="outline" type="button" onClick={() => onOpen(side.resource!)}>
            Review Resource
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No matching registry resource found for this CIDR.</p>
      )}
    </div>
  );
}

function conflictKey(conflict: Conflict, index: number) {
  return `${conflict.severity}-${conflict.title}-${conflict.detail}-${conflict.ranges.join("|")}-${index}`;
}

function conflictSides(conflict: Conflict, resources: ManagedResource[]) {
  const [left, right] = conflict.ranges;
  return {
    left: left ? conflictSideInfo(left, resources) : null,
    right: right ? conflictSideInfo(right, resources) : null
  };
}

function conflictSideInfo(cidr: string, resources: ManagedResource[]): ConflictSideInfo {
  const range = safeRange(cidr);
  const resource = resources.find((item) => item.cidr === cidr) ??
    (range ? resources.find((item) => item.startNumber === range.start && item.endNumber === range.end) : undefined) ??
    null;
  return { cidr, resource };
}

function BulkOperations(props: {
  poolCsv: string;
  assignmentCsv: string;
  poolFileName: string;
  assignmentFileName: string;
  poolAllocated: boolean;
  assignmentAllowConflicts: boolean;
  batches: BulkBatch[];
  isRefreshing: boolean;
  onPoolCsv: (value: string) => void;
  onAssignmentCsv: (value: string) => void;
  onPoolFileName: (value: string) => void;
  onAssignmentFileName: (value: string) => void;
  onPoolAllocated: (value: boolean) => void;
  onAssignmentAllowConflicts: (value: boolean) => void;
  onRefresh: () => void;
  onImportPools: () => void;
  onImportAssignments: () => void;
}) {
  function loadCsv(file: File | undefined, onLoad: (value: string) => void, onFileName: (value: string) => void, normalize?: (value: string) => string) {
    if (!file) {
      return;
    }
    onFileName(file.name);
    void file.text().then((text) => {
      try {
        onLoad(normalize ? normalize(text) : text);
      } catch (error) {
        window.alert(errorMessage(error));
      }
    });
  }

  const hasRunningBatch = props.batches.some((batch) => batch.status === "RUNNING");

  return (
    <div className="grid gap-5">
      <PageTitle title="Bulk Operations" description="Bulk import, update, assignment, release, and reservation workflows." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bulk Import: Subnets</CardTitle>
            <CardDescription>Select a CSV file from your machine.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              className="block w-full rounded-md border bg-muted/40 px-3 py-2 text-sm"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => loadCsv(event.target.files?.[0], props.onPoolCsv, props.onPoolFileName, normalizePoolImportCsv)}
            />
            <p className="text-sm text-muted-foreground">
              {props.poolCsv ? `${props.poolCsv.split(/\r?\n/).filter(Boolean).length - 1} data rows loaded${props.poolFileName ? ` from ${props.poolFileName}` : ""}` : "No file loaded"}
            </p>
            <ToggleSwitch label="Allocated pool" description="When enabled, imported subnets are treated as allocated/root pools for Navigator and reports." checked={props.poolAllocated} onChange={props.onPoolAllocated} />
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold">Subnet import template</p>
                  <p className="text-xs text-muted-foreground">Use CIDR, or StartIP/EndIP/Total ranges. The maintainer column defaults to ITC-NOC-MNT when blank.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { props.onPoolCsv(BULK_SUBNET_TEMPLATE); props.onPoolFileName("bulk-subnet-template.csv"); }}>
                    Load Template
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadBlob(`bulk-subnet-template-${today()}.csv`, "text/csv;charset=utf-8", BULK_SUBNET_TEMPLATE)}>
                    <FileDown className="h-4 w-4" />
                    Download Template
                  </Button>
                </div>
              </div>
            </div>
            <Button className="w-fit" onClick={props.onImportPools} disabled={!props.poolCsv.trim()}>
              <Upload className="h-4 w-4" />
              Start Resource Batch
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bulk Import: Assignments / Reservations</CardTitle>
            <CardDescription>Select a CSV file from your machine.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              className="block w-full rounded-md border bg-muted/40 px-3 py-2 text-sm"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => loadCsv(event.target.files?.[0], props.onAssignmentCsv, props.onAssignmentFileName, normalizeAssignmentImportCsv)}
            />
            <p className="text-sm text-muted-foreground">
              {props.assignmentCsv ? `${props.assignmentCsv.split(/\r?\n/).filter(Boolean).length - 1} data rows loaded${props.assignmentFileName ? ` from ${props.assignmentFileName}` : ""}` : "No file loaded"}
            </p>
            <ToggleSwitch
              label="Conflict / Overlap Handling: Reject Conflicts / Allow Conflicts"
              description={props.assignmentAllowConflicts ? "Allow Conflicts: overlapping records are imported, flagged in results, and kept blocked from CST until resolved." : "Reject Conflicts: overlapping records are blocked and listed in the error report with the existing resource."}
              checked={props.assignmentAllowConflicts}
              onChange={props.onAssignmentAllowConflicts}
            />
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold">CST assignment data template</p>
                  <p className="text-xs text-muted-foreground">Includes Business and Internal rows. Internal rows only need the assignment basics and serviceDescription; customer/contact/address fields are optional.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { props.onAssignmentCsv(CST_BULK_ASSIGNMENT_TEMPLATE); props.onAssignmentFileName("cst-lir-assignment-template.csv"); }}>
                    Load CST Template
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadBlob(`cst-lir-assignment-template-${today()}.csv`, "text/csv;charset=utf-8", CST_BULK_ASSIGNMENT_TEMPLATE)}>
                    <FileDown className="h-4 w-4" />
                    Download Template
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                <p><span className="font-semibold text-foreground">Business mandatory:</span> assignmentType, CIDR/range, status, assignmentDate, customerId, serviceId, organization, customerTypeId, regionId, contact name, mobile, idNumber, email. Optional local fields: customerType (CORP/RESI/COMP/NA), subnetType (LAN1-LAN8/PTP1-PTP3/NA).</p>
                <p><span className="font-semibold text-foreground">Internal mandatory:</span> assignmentType, CIDR/range, status, assignmentDate, serviceDescription. Customer, organization, contact, location, serviceId, owner, purpose, and email fields are optional.</p>
              </div>
            </div>
            <Button className="w-fit" onClick={props.onImportAssignments} disabled={!props.assignmentCsv.trim()}>
              <Upload className="h-4 w-4" />
              Start Assignment Batch
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Bulk Transaction History</CardTitle>
              <CardDescription>Admin audit for every loaded batch, including running status, successes, failures, totals, and result export.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.isRefreshing}>
              <RefreshCcw className={cn("h-4 w-4", props.isRefreshing || hasRunningBatch ? "animate-spin" : "")} />
              {hasRunningBatch ? "Processing" : props.isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[520px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Failures</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-semibold">{batch.id}</TableCell>
                    <TableCell>{bulkOperationLabel(batch.operation_type)}</TableCell>
                    <TableCell><Badge variant={badgeForBulkStatus(batch.status)}>{batch.status}</Badge></TableCell>
                    <TableCell>{batch.total_rows}</TableCell>
                    <TableCell>{batch.success_count}</TableCell>
                    <TableCell>{batch.failure_count}</TableCell>
                    <TableCell>{formatDateTime(batch.started_at)}</TableCell>
                    <TableCell>{formatDuration(batch.duration_ms)}</TableCell>
                    <TableCell>{batch.file_name || "CSV payload"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => showBulkBatchDetails(batch)}>Details</Button>
                        <Button size="sm" variant="outline" onClick={() => exportBulkBatch(batch)} disabled={!batch.result_json}>
                          <FileDown className="h-4 w-4" />
                          Export
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!props.batches.length ? <p className="mt-3 text-sm text-muted-foreground">No bulk transactions have been started yet.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bulk Capabilities</CardTitle>
          <CardDescription>Target workflows for the registry platform.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-4">
          {["Bulk Update", "Bulk Assignment", "Bulk Release", "Bulk Reservation"].map((item) => <Badge key={item} variant="default">{item}</Badge>)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>CSV Template Documentation</CardTitle>
          <CardDescription>Use one supported header set per file. Format errors, invalid IP ranges, overlaps, and Total mismatches are rejected during validation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <TemplateBlock
            title="Subnet Import: CIDR Format"
            lines={[
              "cidr,name,region",
              "5.42.224.0/19,Salam public allocation,Riyadh",
              "10.10.0.0/16,Private internal subnet,Riyadh"
            ]}
          />
          <TemplateBlock
            title="Subnet Import: Start-End Format"
            lines={[
              "StartIP,EndIP,Total",
              "192.168.1.0,192.168.1.255,256",
              "10.0.0.0,10.0.0.255,256",
              "172.16.0.0,172.16.3.255,1024",
              "100.64.0.0,100.64.15.255,4096",
              "5.42.224.0,5.42.255.255,8192"
            ]}
          />
          <TemplateBlock
            title="Assignment / Reservation Import: CIDR Format"
            lines={[
              "cidr,size,status,assignmentDate,customerName,serviceId,serviceDescription",
              "5.42.224.0/24,256,3,2026-06-07,Example Enterprise,SVC-10001,Enterprise L3 service",
              "5.42.225.0/24,256,2,2026-06-07,Internal Registry,,CGNAT Subnet"
            ]}
          />
          <TemplateBlock
            title="Assignment / Reservation Import: Start-End Format"
            lines={[
              "startIp,endIp,size,status,assignmentDate,customerName,serviceId,serviceDescription",
              "192.168.1.10,192.168.1.12,3,3,2026-06-07,Example Enterprise,SVC-20001,Enterprise L3 service",
              "10.0.0.0,10.0.0.255,256,2,2026-06-07,Internal Registry,,DNS Infrastructure"
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
        {lines.join("\n")}
      </pre>
    </div>
  );
}

function bulkOperationLabel(value: string) {
  if (value === "POOL_IMPORT") {
    return "Subnets";
  }
  if (value === "ASSIGNMENT_IMPORT") {
    return "Assignments / Reservations";
  }
  return value;
}

function badgeForBulkStatus(status: string) {
  if (status === "COMPLETED") {
    return "success" as const;
  }
  if (status === "RUNNING") {
    return "warning" as const;
  }
  if (status === "FAILED" || status === "COMPLETED_WITH_ERRORS") {
    return "danger" as const;
  }
  return "default" as const;
}

function formatDateTime(value: string) {
  if (!value) {
    return "In progress";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(value: number) {
  if (!value) {
    return "In progress";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function ripePushNoticeDetail(data: RipePushResponse) {
  const lines = [`${data.message}${data.status_code ? ` (HTTP ${data.status_code})` : ""}`];
  if (data.response_body) {
    lines.push("", "RIPE response:", data.response_body);
  }
  lines.push("", "RIPE request:", JSON.stringify(data.request_object, null, 2));
  return lines.join("\n");
}

function parseBulkResult(batch: BulkBatch): BulkResult | null {
  if (!batch.result_json) {
    return null;
  }
  try {
    return JSON.parse(batch.result_json) as BulkResult;
  } catch {
    return null;
  }
}

function showBulkBatchDetails(batch: BulkBatch) {
  const result = parseBulkResult(batch);
  const errors = result?.errors?.slice(0, 10) ?? [];
  window.alert([
    `Batch: ${batch.id}`,
    `Type: ${bulkOperationLabel(batch.operation_type)}`,
    `Status: ${batch.status}`,
    `Total rows: ${batch.total_rows}`,
    `Success: ${batch.success_count}`,
    `Failures: ${batch.failure_count}`,
    `Started: ${formatDateTime(batch.started_at)}`,
    `Completed: ${formatDateTime(batch.completed_at)}`,
    `Duration: ${formatDuration(batch.duration_ms)}`,
    errors.length ? `\nErrors:\n${errors.join("\n")}` : batch.error_summary ? `\nErrors:\n${batch.error_summary}` : ""
  ].filter(Boolean).join("\n"));
}

function exportBulkBatch(batch: BulkBatch) {
  const result = parseBulkResult(batch);
  if (!result) {
    window.alert("No completed result is available for this batch yet.");
    return;
  }
  const rows = result.output_rows ?? [];
  const headers = [
    "BatchID",
    "OperationType",
    "InputRowNumber",
    "ProcessingStatus",
    "ProcessingMessage",
    "GeneratedResourceUuid",
    "GeneratedVersionUuid",
    "GeneratedCidr",
    "GeneratedSize",
    "Status",
    "AssignmentDate",
    "CustomerName",
    "AssignmentType",
    "CstSyncReady",
    "CstValidationStatus",
    "CstValidationErrors",
    "CstValidationWarnings"
  ];
  const csvRows = rows.map((row) => [
    batch.id,
    batch.operation_type,
    row.inputRowNumber,
    row.processingStatus,
    row.processingMessage,
    row.generatedResourceUuid,
    row.generatedVersionUuid,
    row.generatedCidr,
    row.generatedSize,
    row.status,
    row.assignmentDate,
    row.customerName,
    row.assignmentType ?? "",
    row.cstSyncReady ? "true" : "false",
    row.cstValidationStatus ?? "",
    row.cstValidationErrors ?? "",
    row.cstValidationWarnings ?? ""
  ]);
  downloadBlob(`bulk-${batch.id}.csv`, "text/csv;charset=utf-8", buildSimpleCsv(headers, csvRows));
}

function ReportMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

type GlobalSearchPanelProps = {
  resources: ManagedResource[];
  query: string;
  filters: SearchFilterCriterion[];
  isRefreshing: boolean;
  lastUpdated: number;
  onQuery: (value: string) => void;
  onFilters: (value: SearchFilterCriterion[]) => void;
  onRefresh: () => void;
  onOpen: (resource: ManagedResource) => void;
  scope?: string;
};

function GlobalSearch(props: GlobalSearchPanelProps) {
  return (
    <div className="grid gap-5">
      <PageTitle title="Global Search" description="Search by IP address, CIDR, Resource ID, Transaction ID, customer, service, owner, status, RIPE/CST sync status, netname, and selected filter criteria." />
      <GlobalSearchPanel {...props} scope="global-search" />
    </div>
  );
}

function GlobalSearchPanel({
  resources,
  query,
  filters,
  isRefreshing,
  lastUpdated,
  onQuery,
  onFilters,
  onRefresh,
  onOpen,
  scope = "global-search"
}: GlobalSearchPanelProps) {
  const [draftFilter, setDraftFilter] = useState<{ field: SearchFilterField; value: string }>({ field: "administrativeStatus", value: "" });
  const results = filterResources(resources, query, filters).sort((left, right) => left.startNumber - right.startNumber || left.prefix - right.prefix || resourceTypeLabel(left).localeCompare(resourceTypeLabel(right)));
  const selectedField = SEARCH_FILTER_FIELDS.find((field) => field.value === draftFilter.field) ?? SEARCH_FILTER_FIELDS[0];
  const draftOptions = filterOptionsForField(draftFilter.field, resources);
  const hasCriteria = query.trim() || filters.length > 0;
  const addFilter = () => {
    const value = draftFilter.value.trim();
    if (!value) {
      return;
    }
    onFilters([...filters, { id: createSearchFilterId(), field: draftFilter.field, value }]);
    setDraftFilter((current) => ({ ...current, value: "" }));
  };
  const removeFilter = (filterId: string) => onFilters(filters.filter((filter) => filter.id !== filterId));

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-3 pt-5">
          <div className="flex flex-col gap-2 md:flex-row">
            <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search registry resources" />
            <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCcw className={cn("h-4 w-4", isRefreshing ? "animate-spin" : "")} />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button variant="outline" onClick={() => exportGlobalSearchResults(results)}>
              <FileDown className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {lastUpdated ? `Last refreshed ${new Date(lastUpdated).toLocaleTimeString()}` : "Results have not refreshed yet"}
          </p>
          <div className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Filter Field</span>
              <Select
                value={draftFilter.field}
                values={SEARCH_FILTER_FIELDS.map((field) => field.value)}
                labels={Object.fromEntries(SEARCH_FILTER_FIELDS.map((field) => [field.value, field.label]))}
                onChange={(field) => setDraftFilter({ field: field as SearchFilterField, value: "" })}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Filter Value</span>
              {selectedField.mode === "select" ? (
                <Select value={draftFilter.value} values={draftOptions} onChange={(value) => setDraftFilter((current) => ({ ...current, value }))} />
              ) : (
                <Input value={draftFilter.value} onChange={(event) => setDraftFilter((current) => ({ ...current, value: event.target.value }))} placeholder={`Filter by ${selectedField.label}`} />
              )}
            </label>
            <Button className="self-end" variant="secondary" onClick={addFilter} disabled={!draftFilter.value.trim()}>
              Add Filter
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => (
                <span key={filter.id} className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{labelForSearchField(filter.field)}</span>
                  <span>{filter.value}</span>
                  <button className="text-foreground hover:text-destructive" type="button" onClick={() => removeFilter(filter.id)} aria-label={`Remove ${labelForSearchField(filter.field)} filter`}>
                    x
                  </button>
                </span>
              ))}
              {!filters.length ? <span className="text-xs text-muted-foreground">No filter criteria added</span> : null}
            </div>
            <Button size="sm" variant="ghost" disabled={!hasCriteria} onClick={() => { onQuery(""); onFilters([]); }}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Search Results</CardTitle>
          <CardDescription>{results.length} matching resources. Select any result to open the Resource Summary page.</CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalSearchResultsTable resources={results} onOpen={onOpen} scope={scope} />
        </CardContent>
      </Card>
    </div>
  );
}

function GlobalSearchResultsTable({
  resources,
  onOpen,
  scope,
  actions,
  empty = "No matching resources."
}: {
  resources: ManagedResource[];
  onOpen: (resource: ManagedResource) => void;
  scope: string;
  actions?: (resource: ManagedResource) => React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="max-h-[560px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>CIDR</TableHead>
            <TableHead>Range</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Customer / Resource</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sync</TableHead>
            <TableHead>Service / Transaction</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Updated</TableHead>
            {actions ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource, resourceIndex) => {
            const customer = resourceDisplayName(resource);
            const service = assignedResourceServiceLabel(resource) || resource.serviceId || resource.serviceDescription || "-";
            const location = [resource.regionId ? `Region ${resource.regionId}` : "", resource.cityId ? `City ${resource.cityId}` : ""].filter(Boolean).join(" / ") || resource.country || resource.maintainer || "-";
            const rowActions = actions?.(resource);
            return (
              <TableRow key={resourceKey(resource, resourceIndex, scope)}>
                <TableCell className="min-w-[180px]">
                  <button type="button" className="text-left font-semibold text-sky-300 underline-offset-2 hover:underline" onClick={() => onOpen(resource)} title="Open Resource Summary">
                    {resource.cidr}
                  </button>
                  <p className="break-all text-xs text-muted-foreground">{resource.uuid}</p>
                </TableCell>
                <TableCell className="min-w-[190px] text-xs text-muted-foreground">{resource.startIp} - {resource.endIp}</TableCell>
                <TableCell>
                  <ResourceTypeBadge resource={resource} />
                  <p className="mt-1 text-xs text-muted-foreground">{resource.classification}</p>
                </TableCell>
                <TableCell className="min-w-[120px] font-medium">{resource.owner || "-"}</TableCell>
                <TableCell className="min-w-[120px]">{assignedToLabelForResource(resource)}</TableCell>
                <TableCell className="min-w-[200px]">
                  <p className="font-medium">{customer}</p>
                  <p className="text-xs text-muted-foreground">{resource.netname || resource.description || "-"}</p>
                </TableCell>
                <TableCell>
                  <Badge variant={badgeForResource(resource)}>{resource.administrativeStatus}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{resource.operationType || resource.status}</p>
                </TableCell>
                <TableCell className="min-w-[150px]">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={resource.ripeSyncStatus === "FAILED" ? "danger" : resource.ripeSyncStatus === "PENDING" || resource.ripeSyncStatus === "SUBMITTED" ? "warning" : resource.ripeSyncStatus === "SUCCESS" || resource.ripeSyncStatus === "SYNCHRONIZED" ? "success" : "muted"}>RIPE {resource.ripeSyncStatus || "-"}</Badge>
                    <Badge variant={resource.cstSyncStatus === "FAILED" ? "danger" : resource.cstSyncStatus === "PENDING" || resource.cstSyncStatus === "RUNNING" ? "warning" : resource.cstSyncStatus === "SUCCESS" || resource.cstSyncStatus === "SYNCHRONIZED" ? "success" : "muted"}>CST {resource.cstSyncStatus || "-"}</Badge>
                  </div>
                </TableCell>
                <TableCell className="min-w-[190px]">
                  <p>{service}</p>
                  <p className="break-all text-xs text-muted-foreground">{resource.transactionId || "-"}</p>
                </TableCell>
                <TableCell className="min-w-[120px] text-xs text-muted-foreground">{location}</TableCell>
                <TableCell className="min-w-[120px] text-xs text-muted-foreground">{resource.lastUpdated || "-"}</TableCell>
                {actions ? <TableCell>{rowActions}</TableCell> : null}
              </TableRow>
            );
          })}
          {!resources.length ? (
            <TableRow>
              <TableCell colSpan={actions ? 12 : 11} className="py-8 text-center text-sm text-muted-foreground">{empty}</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

function Reporting({
  resources,
  auditEvents,
  conflicts,
  ripeReportForm,
  ripeReportResult,
  ripeReportStatus,
  onRipeReportForm,
  onRunRipeReport,
  onClearRipeReport
}: {
  resources: ManagedResource[];
  auditEvents: AuditEvent[];
  conflicts: Conflict[];
  ripeReportForm: { dateFrom: string; dateTo: string; reportType: string };
  ripeReportResult: RipeReportResponse | null;
  ripeReportStatus: "idle" | "running" | "complete";
  onRipeReportForm: (value: { dateFrom: string; dateTo: string; reportType: string }) => void;
  onRunRipeReport: () => void;
  onClearRipeReport: () => void;
}) {
  const [activeReport, setActiveReport] = useState<"pool-summary" | "local-allocated-pool-utilization" | "active-assignments" | "cst-lir" | "resource-utilization" | "ripe-allocation" | null>(null);
  const [poolSummaryFilters, setPoolSummaryFilters] = useState<Record<string, string>>({});
  const [activeAssignmentFilters, setActiveAssignmentFilters] = useState<Record<string, string>>({});
  const [allIpFilters, setAllIpFilters] = useState<Record<string, string>>({});
  const [poolSummaryVisibleRows, setPoolSummaryVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [localAllocatedPoolVisibleRows, setLocalAllocatedPoolVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [activeAssignmentVisibleRows, setActiveAssignmentVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [registryVisibleRows, setRegistryVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [utilizationVisibleRows, setUtilizationVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [ripeVisibleRows, setRipeVisibleRows] = useState(REPORT_BATCH_SIZE);
  const poolSummaryRows = poolSummaryReportRows(resources);
  const localAllocatedPoolRows = localAllocatedPoolUtilizationRows(resources);
  const filteredPoolSummaryRows = filterReportRows(poolSummaryRows, poolSummaryFilters, POOL_SUMMARY_COLUMNS);
  const reportingResources = presentationResources(resources);
  const activeAssignmentRows = activeAssignmentReportRows(resources);
  const filteredActiveAssignmentRows = filterReportRows(activeAssignmentRows, activeAssignmentFilters, ACTIVE_ASSIGNMENT_COLUMNS);
  const utilizationRows = resourceUtilizationRows(reportingResources);
  const filteredAllIpRows = filterReportRows(utilizationRows, allIpFilters, ALL_IP_REPORT_COLUMNS);
  const cstSyncedAllIpRows = filteredAllIpRows.filter(isCstSyncedReportRow);
  const allIpTotalCount = sumReportCellNumbers(filteredAllIpRows, "total_ips");
  const cstSyncedIpCount = sumReportCellNumbers(cstSyncedAllIpRows, "total_ips");
  const registryRows = registryExportRows(reportingResources);
  const visiblePoolSummaryRows = filteredPoolSummaryRows.slice(0, poolSummaryVisibleRows);
  const visibleLocalAllocatedPoolRows = localAllocatedPoolRows.slice(0, localAllocatedPoolVisibleRows);
  const visibleActiveAssignmentRows = filteredActiveAssignmentRows.slice(0, activeAssignmentVisibleRows);
  const visibleRegistryRows = registryRows.slice(0, registryVisibleRows);
  const visibleUtilizationRows = filteredAllIpRows.slice(0, utilizationVisibleRows);
  const ripeRows = ripeReportResult?.rows ?? [];
  const ripeColumns = ripeRows.length ? ripeAssignmentColumns(ripeRows) : [];
  const visibleRipeRows = ripeRows.slice(0, ripeVisibleRows);
  useEffect(() => {
    setPoolSummaryVisibleRows(REPORT_BATCH_SIZE);
    setLocalAllocatedPoolVisibleRows(REPORT_BATCH_SIZE);
  }, [poolSummaryFilters, resources.length]);
  useEffect(() => {
    setActiveAssignmentVisibleRows(REPORT_BATCH_SIZE);
  }, [activeAssignmentFilters, resources.length]);
  useEffect(() => {
    setRegistryVisibleRows(REPORT_BATCH_SIZE);
    setUtilizationVisibleRows(REPORT_BATCH_SIZE);
  }, [allIpFilters, resources.length]);
  useEffect(() => {
    setRipeVisibleRows(REPORT_BATCH_SIZE);
  }, [ripeRows.length]);
  const loadMorePoolSummaryRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, poolSummaryVisibleRows, filteredPoolSummaryRows.length)) {
      setPoolSummaryVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, filteredPoolSummaryRows.length));
    }
  };
  const loadMoreLocalAllocatedPoolRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, localAllocatedPoolVisibleRows, localAllocatedPoolRows.length)) {
      setLocalAllocatedPoolVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, localAllocatedPoolRows.length));
    }
  };
  const loadMoreActiveAssignmentRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, activeAssignmentVisibleRows, filteredActiveAssignmentRows.length)) {
      setActiveAssignmentVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, filteredActiveAssignmentRows.length));
    }
  };
  const loadMoreRegistryRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, registryVisibleRows, registryRows.length)) {
      setRegistryVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, registryRows.length));
    }
  };
  const loadMoreUtilizationRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, utilizationVisibleRows, filteredAllIpRows.length)) {
      setUtilizationVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, filteredAllIpRows.length));
    }
  };
  const loadMoreRipeRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, ripeVisibleRows, ripeRows.length)) {
      setRipeVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, ripeRows.length));
    }
  };
  const openRipeReport = () => {
    onRipeReportForm({ ...ripeReportForm, reportType: "RIPE Assignment Report" });
    onClearRipeReport();
    setRipeVisibleRows(REPORT_BATCH_SIZE);
    setActiveReport("ripe-allocation");
  };
  const reportRows = [
    { id: "pool-summary", activeId: "pool-summary" as const, name: "Subnet Summary Report", scope: `${filteredPoolSummaryRows.length} of ${poolSummaryRows.length} registered subnets`, status: "Available" },
    { id: "local-allocated-pool-utilization", activeId: "local-allocated-pool-utilization" as const, name: "Local Allocated Pool Utilization Report", scope: `${localAllocatedPoolRows.length} allocated pools`, status: "Available" },
    { id: "active-assignments", activeId: "active-assignments" as const, name: "All Active Assignments Report", scope: `${filteredActiveAssignmentRows.length} of ${activeAssignmentRows.length} active assignments`, status: "Available" },
    { id: "resource-utilization", activeId: "resource-utilization" as const, name: "All IPs Report", scope: `${filteredAllIpRows.length} of ${utilizationRows.length} assigned and unassigned IP rows`, status: "Available" },
    { id: "cst-lir", activeId: "cst-lir" as const, name: "CST/LIR Registry Report", scope: `${registryRows.length} CIDRs`, status: "Available" },
    { id: "ripe-assignment", activeId: "ripe-allocation" as const, name: "RIPE Assignment Report", scope: "Maintainer ITC-NOC-MNT inetnum assignments", status: "Available" },
    { id: "reservations", name: "Reservation Report", scope: `${resources.filter((item) => item.administrativeStatus === "RESERVED").length} reservations`, status: "Planned" },
    { id: "fragmentation", name: "Fragmentation Report", scope: `${resources.filter((item) => item.administrativeStatus === "AVAILABLE").length} available subnets`, status: "Planned" },
    { id: "integrity", name: "Integrity Violation Report", scope: `${conflicts.length} issues`, status: "Planned" },
    { id: "audit", name: "Audit Report", scope: `${auditEvents.length} events`, status: "Planned" }
  ];
  return (
    <div className="grid gap-5">
      <PageTitle title="Reporting" description="Operational reports for resources, assignments, reservations, fragmentation, integrity, and audit. Forecasting is excluded from Phase 1." />
      {!activeReport ? (
        <Card>
        <CardHeader>
          <CardTitle>Report Navigator</CardTitle>
          <CardDescription>Select a report name to open its tabular sheet.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRows.map((report) => (
                <TableRow key={report.id} className={activeReport === report.activeId ? "bg-primary/10" : ""}>
                  <TableCell className="font-semibold">
                    {report.activeId ? (
                      <button
                        className="text-left text-primary underline-offset-4 hover:underline"
                        type="button"
                        onClick={() => report.id === "ripe-assignment" ? openRipeReport() : setActiveReport(report.activeId)}
                      >
                        {report.name}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{report.name}</span>
                    )}
                  </TableCell>
                  <TableCell>{report.scope}</TableCell>
                  <TableCell><Badge variant={report.status === "Available" ? "success" : "warning"}>{report.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      ) : null}
      {activeReport === "ripe-allocation" ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>RIPE Assignment Report</CardTitle>
                <CardDescription>Queries all RIPE inetnum objects maintained by the configured maintainer using inverse-attribute=mnt-by, then exports only assignment records.</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Date From</span>
                <Input type="date" value={ripeReportForm.dateFrom} onChange={(event) => onRipeReportForm({ ...ripeReportForm, dateFrom: event.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Date To</span>
                <Input type="date" value={ripeReportForm.dateTo} onChange={(event) => onRipeReportForm({ ...ripeReportForm, dateTo: event.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onRunRipeReport} disabled={ripeReportStatus === "running"}>
                {ripeReportStatus === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                {ripeReportStatus === "running" ? "Running RIPE Assignment Report" : "Run RIPE Assignment Report"}
              </Button>
              <Button variant="outline" onClick={() => ripeReportResult ? exportRipeAssignmentRows(ripeReportResult.rows, ripeReportResult.report_type) : undefined} disabled={!ripeReportResult?.rows.length}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
            {ripeReportResult ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="font-semibold">{ripeReportResult.report_type}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Maintainer: {ripeReportResult.maintainer || "Not configured"}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{ripeReportResult.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Showing {Math.min(ripeVisibleRows, ripeRows.length)} of {ripeRows.length} rows in the preview. Export CSV includes all rows.</p>
                </div>
                {ripeReportResult.rows.length ? (
                  <div className="max-h-[420px] overflow-auto rounded-md border bg-background/40" onScroll={loadMoreRipeRows}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {ripeColumns.map((column) => (
                            <TableHead key={column}>{column}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRipeRows.map((row, rowIndex) => (
                          <TableRow key={`${row.inetnum}-${row.netname}-${rowIndex}`}>
                            {ripeColumns.map((column) => (
                              <TableCell key={column} className={column === "inetnum" || column === "cidr" ? "font-semibold" : ""}>{String(row[column] ?? "")}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {activeReport === "pool-summary" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Subnet Summary Report</CardTitle>
              <CardDescription>Registered subnet utilization summary with total, usable, in-use, reserved, free, usage, largest free CIDR, and status.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportPoolSummaryRows(filteredPoolSummaryRows, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportPoolSummaryRows(filteredPoolSummaryRows, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
              <Button variant="ghost" onClick={() => setPoolSummaryFilters({})} disabled={!Object.values(poolSummaryFilters).some(Boolean)}>
                Clear Search
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMorePoolSummaryRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subnet Name</TableHead>
                  <TableHead>Allocation</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Usable</TableHead>
                  <TableHead>In Use</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Free</TableHead>
                  <TableHead>Usage %</TableHead>
                  <TableHead>Largest Free CIDR</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
                <TableRow>
                  {POOL_SUMMARY_COLUMNS.map((column) => (
                    <TableHead key={column.key}>
                      <Input
                        className="h-8 min-w-[110px] bg-background text-xs"
                        value={poolSummaryFilters[column.key] ?? ""}
                        onChange={(event) => setPoolSummaryFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                        placeholder={`Search ${column.header}`}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePoolSummaryRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "pool-summary")}>
                    <TableCell className="font-semibold">{row.pool_name}</TableCell>
                    <TableCell>{row.allocation}</TableCell>
                    <TableCell>{formatHosts(Number(row.total))}</TableCell>
                    <TableCell>{formatHosts(Number(row.usable))}</TableCell>
                    <TableCell>{formatHosts(Number(row.in_use))}</TableCell>
                    <TableCell>{formatHosts(Number(row.reserved))}</TableCell>
                    <TableCell>{formatHosts(Number(row.free))}</TableCell>
                    <TableCell>{row.usage_percent}%</TableCell>
                    <TableCell>{row.largest_free_cidr}</TableCell>
                    <TableCell><Badge variant={badgeForPoolSummaryStatus(row.status)}>{row.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!filteredPoolSummaryRows.length ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">{poolSummaryRows.length ? "No registered subnets match the current search fields." : "No registered subnets available to summarize."}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {Math.min(poolSummaryVisibleRows, filteredPoolSummaryRows.length)} of {filteredPoolSummaryRows.length} rows. Scroll down to load the next {REPORT_BATCH_SIZE}. Export includes all matching rows.
          </p>
        </CardContent>
      </Card>
      ) : null}
      {activeReport === "local-allocated-pool-utilization" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Local Allocated Pool Utilization Report</CardTitle>
              <CardDescription>Allocated pools shown in Subnet Navigator, with total, usable, in-use, reserved, free, utilization, RIPE/CST status, and source registry details.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportLocalAllocatedPoolUtilizationRows(localAllocatedPoolRows, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportLocalAllocatedPoolUtilizationRows(localAllocatedPoolRows, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMoreLocalAllocatedPoolRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pool</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Usable</TableHead>
                  <TableHead>In Use</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Free</TableHead>
                  <TableHead>Usage %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>RIPE</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleLocalAllocatedPoolRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "local-allocated-pool-utilization")}>
                    <TableCell>
                      <p className="font-semibold">{row.allocation}</p>
                      <p className="text-xs text-muted-foreground">{row.pool_name}</p>
                    </TableCell>
                    <TableCell>{formatHosts(Number(row.total))}</TableCell>
                    <TableCell>{formatHosts(Number(row.usable))}</TableCell>
                    <TableCell>{formatHosts(Number(row.in_use))}</TableCell>
                    <TableCell>{formatHosts(Number(row.reserved))}</TableCell>
                    <TableCell>{formatHosts(Number(row.free))}</TableCell>
                    <TableCell>{row.usage_percent}%</TableCell>
                    <TableCell><Badge variant={badgeForStatus(row.status)}>{row.status}</Badge></TableCell>
                    <TableCell><Badge variant={row.ripe_sync_status === "FAILED" ? "danger" : row.ripe_sync_status === "PENDING" ? "warning" : "default"}>{row.ripe_sync_status}</Badge></TableCell>
                    <TableCell>{row.last_updated}</TableCell>
                  </TableRow>
                ))}
                {!localAllocatedPoolRows.length ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">No local allocated pools available to export.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {Math.min(localAllocatedPoolVisibleRows, localAllocatedPoolRows.length)} of {localAllocatedPoolRows.length} allocated pools. Export includes all rows and all report columns.
          </p>
        </CardContent>
      </Card>
      ) : null}
      {activeReport === "active-assignments" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>All Active Assignments Report</CardTitle>
              <CardDescription>Current assigned resources with customer, service, contact, location, RIPE, and CST status columns. Use the header filters to query active assignments.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportActiveAssignmentRows(filteredActiveAssignmentRows, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportActiveAssignmentRows(filteredActiveAssignmentRows, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
              <Button variant="ghost" onClick={() => setActiveAssignmentFilters({})} disabled={!Object.values(activeAssignmentFilters).some(Boolean)}>
                Clear Search
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMoreActiveAssignmentRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  {ACTIVE_ASSIGNMENT_COLUMNS.map((column) => (
                    <TableHead key={column.key}>{column.header}</TableHead>
                  ))}
                </TableRow>
                <TableRow>
                  {ACTIVE_ASSIGNMENT_COLUMNS.map((column) => (
                    <TableHead key={column.key}>
                      <Input
                        className="h-8 min-w-[120px] bg-background text-xs"
                        value={activeAssignmentFilters[column.key] ?? ""}
                        onChange={(event) => setActiveAssignmentFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                        placeholder={`Search ${column.header}`}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleActiveAssignmentRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "active-assignments")}>
                    {ACTIVE_ASSIGNMENT_COLUMNS.map((column) => (
                      <TableCell key={column.key} className={column.key === "cidr" ? "font-semibold" : ""}>{String(row[column.key] ?? "")}</TableCell>
                    ))}
                  </TableRow>
                ))}
                {!filteredActiveAssignmentRows.length ? (
                  <TableRow>
                    <TableCell colSpan={ACTIVE_ASSIGNMENT_COLUMNS.length} className="py-6 text-center text-muted-foreground">{activeAssignmentRows.length ? "No active assignments match the current filters." : "No active assignments available."}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {Math.min(activeAssignmentVisibleRows, filteredActiveAssignmentRows.length)} of {filteredActiveAssignmentRows.length} matching active assignments. Scroll down to load the next {REPORT_BATCH_SIZE}. Export includes all matching rows.
          </p>
        </CardContent>
      </Card>
      ) : null}
      {activeReport === "cst-lir" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>CST/LIR Registry Export</CardTitle>
              <CardDescription>PR-16 regulatory export with core CIDR, assignmentStatusId, dynamic assignment, action flag, CST sync, and RIPE sync attributes.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportRegistryRows(registryRows, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportRegistryRows(registryRows, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMoreRegistryRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>IP Subnet</TableHead>
                  <TableHead>Assignment Status</TableHead>
                  <TableHead>Service ID</TableHead>
                  <TableHead>Organization / Name</TableHead>
                  <TableHead>CST</TableHead>
                  <TableHead>RIPE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRegistryRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "cst-lir-registry")}>
                    <TableCell>{row.transactionId}</TableCell>
                    <TableCell className="font-semibold">{row.ipSubnet}</TableCell>
                    <TableCell>{row.assignmentStatusId}</TableCell>
                    <TableCell>{row.serviceId}</TableCell>
                    <TableCell>{row.organizationName || row.fullName}</TableCell>
                    <TableCell><Badge variant={row.cstSyncStatus === "FAILED" ? "danger" : row.cstSyncStatus === "PENDING" ? "warning" : "default"}>{row.cstSyncStatus}</Badge></TableCell>
                    <TableCell><Badge variant={row.ripeSyncStatus === "FAILED" ? "danger" : row.ripeSyncStatus === "PENDING" ? "warning" : "default"}>{row.ripeSyncStatus}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {Math.min(registryVisibleRows, registryRows.length)} of {registryRows.length} rows. Scroll down to load the next {REPORT_BATCH_SIZE}. Export includes all PR-16 registry columns.
          </p>
        </CardContent>
      </Card>
      ) : null}
      {activeReport === "resource-utilization" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>All IPs Report</CardTitle>
              <CardDescription>Assigned and unassigned IP resources in one assignment-style report, including customer/service details when assigned and availability/utilization details when unassigned.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportAllIpRows(filteredAllIpRows, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportAllIpRows(filteredAllIpRows, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
              <Button variant="ghost" onClick={() => setAllIpFilters({})} disabled={!Object.values(allIpFilters).some(Boolean)}>
                Clear Search
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <ReportMetric label="All Subnets" value={formatReportNumber(filteredAllIpRows.length)} detail={`${formatReportNumber(allIpTotalCount)} IPs in filtered rows`} />
            <ReportMetric label="Unassigned" value={formatReportNumber(filteredAllIpRows.filter((item) => item.administrative_status === "AVAILABLE").length)} detail="Available/free subnets" />
            <ReportMetric label="Assigned" value={formatReportNumber(filteredAllIpRows.filter((item) => item.administrative_status === "ASSIGNED").length)} detail="Active assignment subnets" />
            <ReportMetric label="Reserved" value={formatReportNumber(filteredAllIpRows.filter((item) => item.administrative_status === "RESERVED").length)} detail="Held capacity subnets" />
            <ReportMetric label="CST Synced Subnets" value={formatReportNumber(cstSyncedAllIpRows.length)} detail="Rows with CST SUCCESS/SYNCHRONIZED" />
            <ReportMetric label="CST Synced IPs" value={formatReportNumber(cstSyncedIpCount)} detail="Total IPs already synced with CST" />
          </div>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMoreUtilizationRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  {ALL_IP_REPORT_COLUMNS.map((column) => (
                    <TableHead key={column.key}>{column.header}</TableHead>
                  ))}
                </TableRow>
                <TableRow>
                  {ALL_IP_REPORT_COLUMNS.map((column) => (
                    <TableHead key={column.key}>
                      <Input
                        className="h-8 min-w-[120px] bg-background text-xs"
                        value={allIpFilters[column.key] ?? ""}
                        onChange={(event) => setAllIpFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                        placeholder={`Search ${column.header}`}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUtilizationRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "all-ips")}>
                    {ALL_IP_REPORT_COLUMNS.map((column) => (
                      <TableCell key={column.key} className={column.key === "cidr" ? "font-semibold" : ""}>{String(row[column.key] ?? "")}</TableCell>
                    ))}
                  </TableRow>
                ))}
                {!filteredAllIpRows.length ? (
                  <TableRow>
                    <TableCell colSpan={ALL_IP_REPORT_COLUMNS.length} className="py-6 text-center text-muted-foreground">{utilizationRows.length ? "No IP rows match the current filters." : "No IP records available to export."}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {Math.min(utilizationVisibleRows, filteredAllIpRows.length)} of {filteredAllIpRows.length} matching rows. Scroll down to load the next {REPORT_BATCH_SIZE}. Export includes all matching assigned and unassigned rows.
          </p>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

function shouldLoadNextReportBatch(event: UIEvent<HTMLDivElement>, visibleRows: number, totalRows: number) {
  if (visibleRows >= totalRows) {
    return false;
  }
  const target = event.currentTarget;
  return target.scrollHeight - target.scrollTop - target.clientHeight < 180;
}


const CST_RESOURCE_SCOPE_OPTIONS: CstResourceScope[] = ["all", "assigned", "unassigned"];
const CST_RESOURCE_SCOPE_LABELS: Record<CstResourceScope, string> = {
  assigned: "Assignments only",
  all: "All LIR data",
  unassigned: "Unassigned only"
};

function cstScopeLabel(scope: CstResourceScope) {
  return CST_RESOURCE_SCOPE_LABELS[scope] ?? CST_RESOURCE_SCOPE_LABELS.all;
}

function ToggleSwitch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn("flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition", checked ? "border-primary/50 bg-primary/10" : "bg-muted/20 hover:bg-muted/35")}
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full border transition", checked ? "border-primary bg-primary" : "border-border bg-muted")}> 
        <span className={cn("absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background shadow transition", checked ? "left-6" : "left-1")} />
      </span>
    </button>
  );
}

function CstResourceScopeSelector({ value, onChange }: { value: CstResourceScope; onChange: (scope: CstResourceScope) => void }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">CST report scope</span>
      <div className="flex flex-wrap gap-1 rounded-md border bg-muted/20 p-1">
        {CST_RESOURCE_SCOPE_OPTIONS.map((scope) => (
          <button
            key={scope}
            type="button"
            className={cn("rounded px-3 py-1.5 text-xs font-semibold transition", value === scope ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            onClick={() => onChange(scope)}
          >
            {cstScopeLabel(scope)}
          </button>
        ))}
      </div>
    </div>
  );
}
type CstLirApiSettingsProps = {
  cstConfig: CstConfig | null;
  cstConfigForm: CstConfigPayload;
  cstResourceScope: CstResourceScope;
  onCstConfigForm: (value: CstConfigPayload) => void;
  onCstResourceScope: (scope: CstResourceScope) => void;
  onSaveCstConfig: () => void;
  onTestCstConnection: () => void;
};

function CstLirApiSettings(props: CstLirApiSettingsProps) {
  const configLoaded = Boolean(props.cstConfig);
  const setSwitch = (key: keyof CstConfigPayload, checked: boolean) => props.onCstConfigForm({ ...props.cstConfigForm, [key]: checked });
  return (
    <Card>
      <CardHeader>
        <CardTitle>CST LIR API Settings</CardTitle>
        <CardDescription>Configure OAuth token retrieval, gateway headers, and LIRDataService functional endpoint paths.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
      <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Configure OAuth token retrieval and functional API endpoint mapping. Token is cached and refreshed before expiry. SSL certificate verification is bypassed for all CST API calls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={props.cstConfig?.auth_password_configured ? "success" : "warning"}>{props.cstConfig?.auth_password_configured ? "Password stored" : "Password missing"}</Badge>
            <Badge variant={props.cstConfig?.api_access_key_configured ? "success" : "warning"}>{props.cstConfig?.api_access_key_configured ? "Gateway API key stored" : "Gateway API key missing"}</Badge>
            <Badge variant={props.cstConfig?.user_key_configured ? "success" : "warning"}>{props.cstConfig?.user_key_configured ? "LIR apiKey header stored" : "LIR apiKey header missing"}</Badge>
            <Badge variant={props.cstConfig?.token_cached ? "success" : "default"}>{props.cstConfig?.token_cached ? `Token cached until ${props.cstConfig.token_expires_at.slice(0, 19)}` : "No cached token"}</Badge>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">CST LIR operation switches</p>
              <p className="text-xs text-muted-foreground">Control whether CST jobs call the real API immediately, queue locally, or block selected operation types. Default scope includes assigned and unassigned LIR resources.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={props.cstConfigForm.enabled === false ? "warning" : "success"}>{props.cstConfigForm.enabled === false ? "CST disabled" : "CST enabled"}</Badge>
              <Badge variant={props.cstConfigForm.auto_execute === false ? "warning" : "success"}>{props.cstConfigForm.auto_execute === false ? "Queue only" : "Auto execute"}</Badge>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <ToggleSwitch label="Global CST sync" description="Allow CST jobs to call the gateway." checked={props.cstConfigForm.enabled !== false} onChange={(checked) => setSwitch("enabled", checked)} />
            <ToggleSwitch label="Auto execute" description="Call CST when jobs are created." checked={props.cstConfigForm.auto_execute !== false} onChange={(checked) => setSwitch("auto_execute", checked)} />
            <ToggleSwitch label="SendLIR" description="Create or report LIR records." checked={props.cstConfigForm.send_enabled !== false} onChange={(checked) => setSwitch("send_enabled", checked)} />
            <ToggleSwitch label="UpdateLIR" description="Update existing LIR records." checked={props.cstConfigForm.update_enabled !== false} onChange={(checked) => setSwitch("update_enabled", checked)} />
            <ToggleSwitch label="DeleteLIR" description="Delete CST records when required." checked={props.cstConfigForm.delete_enabled !== false} onChange={(checked) => setSwitch("delete_enabled", checked)} />
            <ToggleSwitch label="GetLIR" description="Read paged LIR data from CST." checked={props.cstConfigForm.get_enabled !== false} onChange={(checked) => setSwitch("get_enabled", checked)} />
          </div>
          <div className="grid gap-2">
            <CstResourceScopeSelector value={props.cstResourceScope} onChange={props.onCstResourceScope} />
            <p className="text-xs text-muted-foreground">Change this scope, then click Save Operation Switches to keep it as the default for CST migration review and pending push.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">When auto execute is disabled, new CST jobs stay PENDING and do not call CST until you retry them manually from the CST Sync Monitor.</p>
            <Button size="sm" variant="secondary" onClick={props.onSaveCstConfig}>
              <Shield className="h-4 w-4" />
              Save Operation Switches
            </Button>
          </div>
                </div>
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          <div>
            <p className="font-semibold">CST push rate limit</p>
            <p className="text-xs text-muted-foreground">Controls how many pending CST jobs can be submitted per run and how fast real CST API calls are paced.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Max jobs per push</span>
              <Input min={1} type="number" value={String(props.cstConfigForm.batch_size_limit ?? 500)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, batch_size_limit: Math.max(Number(event.target.value) || 500, 1) })} placeholder="500" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">SendLIR records per API call</span>
              <Input min={1} type="number" value={String(props.cstConfigForm.send_payload_batch_size ?? 1)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, send_payload_batch_size: Math.max(Number(event.target.value) || 1, 1) })} placeholder="400" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Max CST calls per hour</span>
              <Input min={1} type="number" value={String(props.cstConfigForm.hourly_request_limit ?? 1000)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, hourly_request_limit: Math.max(Number(event.target.value) || 1000, 1) })} placeholder="1000" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Example: set SendLIR records per API call to 400 to send 400 LIR records inside one SendLIRData payload. Jobs skipped by validation or disabled CST settings are not delayed.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Integration mode</span>
            <Input value="Real API" readOnly />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Host</span>
            <Input value={props.cstConfigForm.host ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, host: event.target.value, base_url: cstBaseUrlFromHostPort(event.target.value, props.cstConfigForm.port) })} placeholder="cst-oa-unified-gw-stg-fop.apps.apldev-sit-opshift.itc.local" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Port</span>
            <Input value={String(props.cstConfigForm.port ?? 443)} onChange={(event) => { const port = Number(event.target.value) || 443; props.onCstConfigForm({ ...props.cstConfigForm, port, base_url: cstBaseUrlFromHostPort(props.cstConfigForm.host, port) }); }} placeholder="443" />
          </label>
          <label className="grid gap-1 md:col-span-4">
            <span className="text-xs font-medium text-muted-foreground">Base URL</span>
            <Input value={cstBaseUrlFromHostPort(props.cstConfigForm.host, props.cstConfigForm.port)} readOnly placeholder="https://cst-host.example:443" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Authorization username</span>
            <Input value={props.cstConfigForm.auth_username ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, auth_username: event.target.value })} placeholder="CST auth username" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Authorization password</span>
            <Input name="cst-auth-password" autoComplete="new-password" value={props.cstConfigForm.auth_password ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, auth_password: event.target.value })} placeholder={props.cstConfig?.auth_password_configured ? "Password configured" : "CST auth password"} type="password" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Gateway API key</span>
            <Input name="cst-api-key" autoComplete="new-password" value={props.cstConfigForm.api_access_key ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, api_access_key: event.target.value })} placeholder={props.cstConfig?.api_access_key_configured ? "Gateway API key configured" : "x-Gateway-APIKey value"} type="password" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">LIR apiKey header</span>
            <Input name="cst-user-key" autoComplete="new-password" value={props.cstConfigForm.user_key ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, user_key: event.target.value })} placeholder={props.cstConfig?.user_key_configured ? "apiKey header configured" : "apiKey header value"} type="password" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Accept language</span>
            <Select value={props.cstConfigForm.accept_language ?? "EN"} values={["EN", "AR"]} onChange={(accept_language) => props.onCstConfigForm({ ...props.cstConfigForm, accept_language })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">SSL verification</span>
            <Select value="Disabled" values={["Disabled"]} onChange={() => props.onCstConfigForm({ ...props.cstConfigForm, verify_ssl: false })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Token refresh buffer</span>
            <Input value={String(props.cstConfigForm.token_refresh_buffer_seconds ?? 300)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, token_refresh_buffer_seconds: Number(event.target.value) || 300 })} placeholder="300" />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Token path</span>
            <Input value={props.cstConfigForm.token_path ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, token_path: event.target.value })} placeholder="/api/rest/v1.0/OAuthToken" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Send LIR data path</span>
            <Input value={props.cstConfigForm.send_path ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, send_path: event.target.value })} placeholder="/api/rest/v1.0/LIRDataService/SendLIRData" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Update LIR data path</span>
            <Input value={props.cstConfigForm.update_path ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, update_path: event.target.value })} placeholder="/api/rest/v1.0/LIRDataService/UpdateLIRData" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Delete LIR data path</span>
            <Input value={props.cstConfigForm.delete_path ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, delete_path: event.target.value })} placeholder="/api/rest/v1.0/LIRDataService/DeleteLIRData" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Get LIR data path</span>
            <Input value={props.cstConfigForm.get_path ?? ""} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, get_path: event.target.value })} placeholder="/api/rest/v1.0/LIRDataService/GetLIRData" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Connect timeout</span>
              <Input value={String(props.cstConfigForm.connection_timeout ?? 10)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, connection_timeout: Number(event.target.value) || 10 })} placeholder="Seconds" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Read timeout</span>
              <Input value={String(props.cstConfigForm.read_timeout ?? 30)} onChange={(event) => props.onCstConfigForm({ ...props.cstConfigForm, read_timeout: Number(event.target.value) || 30 })} placeholder="Seconds" />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={props.onSaveCstConfig} disabled={!configLoaded}>
            <Shield className="h-4 w-4" />
            Save CST LIR API Settings
          </Button>
          <Button variant="outline" onClick={props.onTestCstConnection} disabled={!configLoaded}>
            <CheckCircle2 className="h-4 w-4" />
            Test connection
          </Button>
          <span className="text-xs text-muted-foreground">Functional calls inject the cached Bearer token automatically. Leave secret fields blank to keep existing stored values.</span>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}

type CstMigrationReviewFilters = {
  search: string;
  assignment_status: string;
  transaction_type: string;
  validation_status: string;
  created_from: string;
  created_to: string;
};

function CstMigrationReviewDialog(props: {
  open: boolean;
  review: CstMigrationReviewResponse | null;
  loading: boolean;
  page: number;
  filters: CstMigrationReviewFilters;
  selectedIds: string[];
  excludedIds: string[];
  result: CstMigrationReviewCreateResult | null;
  resourceScope: CstResourceScope;
  onOpenChange: (open: boolean) => void;
  onPage: (page: number) => void;
  onFilters: (filters: CstMigrationReviewFilters) => void;
  onSelectedIds: (ids: string[]) => void;
  onExcludedIds: (ids: string[]) => void;
  onCreate: (includedIds: string[], excludedIds: string[]) => void;
}) {
  const review = props.review;
  const selectedSet = new Set(props.selectedIds);
  const excludedSet = new Set(props.excludedIds);
  const matchingIds = review?.all_matching_review_ids ?? [];
  const matchingSet = new Set(matchingIds);
  const includedIds = props.selectedIds.filter((id) => matchingSet.has(id) && !excludedSet.has(id));
  const visibleIds = review?.items.map((item) => item.review_id) ?? [];
  const validCount = review?.counts.valid ?? 0;
  const invalidCount = review?.counts.invalid ?? 0;
  const selectedCount = includedIds.length;
  const totalPages = review ? Math.max(Math.ceil(review.total / review.page_size), 1) : 1;
  const setFilter = (key: keyof CstMigrationReviewFilters, value: string) => props.onFilters({ ...props.filters, [key]: value });
  const mergeSelected = (ids: string[]) => props.onSelectedIds(Array.from(new Set([...props.selectedIds, ...ids])).filter((id) => !excludedSet.has(id)));
  const selectFirstMatching = (limit: number) => props.onSelectedIds(matchingIds.filter((id) => !excludedSet.has(id)).slice(0, limit));
  const removeSelected = (ids: string[]) => props.onSelectedIds(props.selectedIds.filter((id) => !ids.includes(id)));
  const excludeSelected = () => {
    props.onExcludedIds(Array.from(new Set([...props.excludedIds, ...props.selectedIds])));
    props.onSelectedIds([]);
  };
  const includeSelected = () => {
    props.onExcludedIds(props.excludedIds.filter((id) => !selectedSet.has(id)));
    props.onSelectedIds([]);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Review Pending CST Transactions</DialogTitle>
          <DialogDescription>Review, filter, exclude, and confirm assigned and unassigned CST LIR records before creating a migration job. Scope: {cstScopeLabel(props.resourceScope)}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-6">
            <label className="grid gap-1 md:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Search</span>
              <Input value={props.filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="CIDR, IP, customer, service, transaction" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Assignment status</span>
              <Select value={props.filters.assignment_status} values={["all", "1", "2", "3", "4"]} labels={{ all: "All", "1": "Unassigned", "2": "Internal", "3": "Business", "4": "Individual" }} onChange={(value) => setFilter("assignment_status", value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Transaction type</span>
              <Select value={props.filters.transaction_type} values={["all", "SEND", "UPDATE", "DELETE"]} labels={{ all: "All" }} onChange={(value) => setFilter("transaction_type", value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Validation</span>
              <Select value={props.filters.validation_status} values={["all", "VALID", "INVALID"]} labels={{ all: "All" }} onChange={(value) => setFilter("validation_status", value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Created from</span>
              <Input type="date" value={props.filters.created_from} onChange={(event) => setFilter("created_from", event.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Created to</span>
              <Input type="date" value={props.filters.created_to} onChange={(event) => setFilter("created_to", event.target.value)} />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            <ReportMetric label="Included" value={String(includedIds.length)} detail="Selected to submit" />
            <ReportMetric label="Excluded" value={String(props.excludedIds.length)} detail="Kept pending for later" />
            <ReportMetric label="Selected" value={String(selectedCount)} detail="Current selection" />
            <ReportMetric label="Valid" value={String(validCount)} detail="Server validation passed" />
            <ReportMetric label="Invalid" value={String(invalidCount)} detail="Defaults applied on create" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => mergeSelected(visibleIds)} disabled={!visibleIds.length}>Select All on Page</Button>
            <Button size="sm" variant="outline" onClick={() => selectFirstMatching(200)} disabled={!matchingIds.length}>Select First 200</Button>
            <Button size="sm" variant="outline" onClick={() => props.onSelectedIds(matchingIds.filter((id) => !excludedSet.has(id)))} disabled={!matchingIds.length}>Select All Matching Results</Button>
            <Button size="sm" variant="secondary" onClick={excludeSelected} disabled={!selectedCount}>Exclude Selected</Button>
            <Button size="sm" variant="secondary" onClick={includeSelected} disabled={!selectedCount}>Include Selected</Button>
            <Button size="sm" variant="outline" onClick={() => props.onSelectedIds([])} disabled={!selectedCount}>Clear Selection</Button>
          </div>
          <div className="max-h-[48vh] overflow-auto rounded-md border bg-background/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.loading ? (
                  <TableRow><TableCell colSpan={9}>Loading pending CST transactions...</TableCell></TableRow>
                ) : review?.items.length ? review.items.map((item) => {
                  const isSelected = selectedSet.has(item.review_id);
                  const isExcluded = excludedSet.has(item.review_id);
                  return (
                    <TableRow key={item.review_id} className={isExcluded ? "opacity-55" : ""}>
                      <TableCell>
                        <input type="checkbox" checked={isSelected} onChange={(event) => event.target.checked ? mergeSelected([item.review_id]) : removeSelected([item.review_id])} aria-label={`Select ${item.cidr}`} />
                      </TableCell>
                      <TableCell><Badge variant={isExcluded ? "warning" : isSelected ? "success" : "default"}>{isExcluded ? "Excluded" : isSelected ? "Selected" : "Pending"}</Badge></TableCell>
                      <TableCell>{item.operation}</TableCell>
                      <TableCell>{item.cidr}</TableCell>
                      <TableCell>{item.start_ip} - {item.end_ip}</TableCell>
                      <TableCell>{item.customer_name || item.customer_id || "-"}</TableCell>
                      <TableCell>{item.service_id || "-"}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={item.transaction_id}>{item.transaction_id}</TableCell>
                      <TableCell><Badge variant={item.validation_status === "VALID" ? "success" : "danger"}>{item.validation_status}</Badge>{item.reason ? <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">{item.reason}</p> : null}</TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow><TableCell colSpan={9}>No matching CST transactions found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => props.onPage(Math.max(props.page - 1, 1))} disabled={props.page <= 1}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {props.page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => props.onPage(Math.min(props.page + 1, totalPages))} disabled={props.page >= totalPages}>Next</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => props.onCreate(includedIds, props.excludedIds)} disabled={!includedIds.length}>Create Migration Job ({includedIds.length})</Button>
            </div>
          </div>
          {props.result ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-semibold">Last job summary</p>
              <p className="text-muted-foreground">Job ID: {props.result.batch_id || "-"} | Included: {props.result.included_transactions} | Rejected: {props.result.rejected_count} | Created by: {props.result.created_by}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function CstIntegrationMonitor(props: CstMonitorProps) {
  const [pendingPushLimit, setPendingPushLimit] = useState("0");
  const [selectedBatchId, setSelectedBatchId] = useState(props.cstBatches[0]?.id ?? "");
  const [batchSearch, setBatchSearch] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState("all");
  const [batchJobStatusFilter, setBatchJobStatusFilter] = useState("FAILED");
  const pendingCount = props.cstSummary?.pending_jobs ?? 0;
  const pendingPushCount = Math.max(Number(pendingPushLimit) || 0, 0);
  const pendingPushLabel = pendingPushCount > 0 ? `Push ${pendingPushCount} Pending` : "Push All Pending";
  const selectedBatch = props.cstBatches.find((batch) => batch.id === selectedBatchId) ?? null;
  useEffect(() => {
    if (!selectedBatchId && props.cstBatches.length) {
      setSelectedBatchId(props.cstBatches[0].id);
    }
  }, [props.cstBatches, selectedBatchId]);
  const filteredBatches = useMemo(() => {
    const needle = batchSearch.trim().toLowerCase();
    return props.cstBatches.filter((batch) => {
      const statusMatch = batchStatusFilter === "all" || batch.status === batchStatusFilter;
      const searchMatch = !needle || batch.id.toLowerCase().includes(needle) || batch.workflow_type.toLowerCase().includes(needle);
      return statusMatch && searchMatch;
    });
  }, [batchSearch, batchStatusFilter, props.cstBatches]);
  const batchJobsQuery = useQuery({
    queryKey: ["cst-batch-jobs", selectedBatchId, batchJobStatusFilter],
    queryFn: () => getCstBatchJobs(selectedBatchId, batchJobStatusFilter),
    enabled: Boolean(selectedBatchId),
    staleTime: 5000,
    refetchOnWindowFocus: false
  });
  const selectedBatchJobs = batchJobsQuery.data ?? [];
  const retryableStatuses = new Set(["FAILED", "BLOCKED", "PENDING"]);
  const openBatch = (batch: CstSyncBatch) => {
    setSelectedBatchId(batch.id);
    setBatchJobStatusFilter(batch.failed_jobs > 0 ? "FAILED" : batch.blocked_jobs > 0 ? "BLOCKED" : batch.completed_jobs < batch.total_jobs ? "PENDING" : "all");
  };
  const retryJobFromBatch = (job: CstSyncJob) => {
    props.onRetryCstJob(job);
    window.setTimeout(() => void batchJobsQuery.refetch(), 1200);
  };
  const retrySelectedBatch = (batch: CstSyncBatch) => {
    props.onRetryCstBatch(batch);
    window.setTimeout(() => void batchJobsQuery.refetch(), 1500);
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>CST Sync Monitor</CardTitle>
            <CardDescription>Monitor transaction jobs, daily schedules, retry failures, and open any CST batch for job-level details.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={props.onRefreshCst} disabled={props.cstBusy}>
              {props.cstBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
            <div className="min-w-[260px]">
              <CstResourceScopeSelector value={props.cstResourceScope} onChange={props.onCstResourceScope} />
            </div>
            <Button variant="secondary" onClick={props.onBootstrapCst}>
              <Upload className="h-4 w-4" />
              Create Migration Job
            </Button>
            <Button variant="outline" onClick={props.onReconcileCst}>
              <Search className="h-4 w-4" />
              GetLIR Pull
            </Button>
            <label className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">Submit</span>
              <Input className="h-8 w-24" min={0} max={pendingCount || undefined} type="number" value={pendingPushLimit} onChange={(event) => setPendingPushLimit(event.target.value)} placeholder="All" />
              <span className="text-xs text-muted-foreground">of {pendingCount}</span>
            </label>
            <Button variant="secondary" onClick={() => props.onPushPendingCstJobs(pendingPushCount)} disabled={pendingCount === 0}>
              <Upload className="h-4 w-4" />
              {pendingPushLabel}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-4">
          <ReportMetric label="Transactions" value={String(props.cstSummary?.total_transactions ?? 0)} detail="Globally unique CST IDs" />
          <ReportMetric label="Jobs" value={String(props.cstSummary?.total_jobs ?? 0)} detail={`${props.cstSummary?.success_jobs ?? 0} success / ${props.cstSummary?.pending_jobs ?? 0} pending`} />
          <ReportMetric label="Failed" value={String(props.cstSummary?.failed_jobs ?? 0)} detail="Failed local jobs" />
          <ReportMetric label="Last Batch" value={props.cstSummary?.last_batch_at ? props.cstSummary.last_batch_at.slice(0, 10) : "-"} detail="Latest CST transaction batch" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={props.cstConfig?.enabled ? "success" : "warning"}>{props.cstConfig?.enabled ? "CST enabled" : "CST disabled"}</Badge>
          <Badge variant={props.cstConfig?.scheduled_sync_enabled ? "success" : "default"}>{props.cstConfig?.scheduled_sync_enabled ? `Daily ${props.cstConfig?.schedule_time ?? "00:30"} ${props.cstConfig?.schedule_timezone ?? "Asia/Riyadh"}` : "Schedule off"}</Badge>
          <Badge variant={props.cstConfig?.auto_execute ? "success" : "warning"}>{props.cstConfig?.auto_execute ? "Auto execution" : "Queue only"}</Badge>
          <Badge variant="success">Real API only</Badge>
          <Badge variant="default">Service provider {props.cstConfig?.service_provider_id ?? "5"}</Badge>
          <Button size="sm" variant="outline" onClick={() => props.onToggleCstEnabled(!props.cstConfig?.enabled)}>
            {props.cstConfig?.enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => props.onToggleCstSchedule(!props.cstConfig?.scheduled_sync_enabled)}>
            {props.cstConfig?.scheduled_sync_enabled ? "Disable Schedule" : "Enable Schedule"}
          </Button>
          <Button size="sm" variant="outline" onClick={props.onRunCstDayMinusOne}>
            Run Day-1 Now
          </Button>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">Daily CST Schedule</p>
              <p className="text-xs text-muted-foreground">Runs once per day at {props.cstConfig?.schedule_time ?? "00:30"} {props.cstConfig?.schedule_timezone ?? "Asia/Riyadh"} for the previous local day. Last run: {props.cstConfig?.last_scheduled_run_at || "not yet"}</p>
            </div>
            <Badge variant={props.cstConfig?.scheduled_sync_enabled ? "success" : "warning"}>{props.cstConfig?.scheduled_sync_enabled ? "Scheduled" : "Paused"}</Badge>
          </div>
          <div className="mt-3 max-h-[180px] overflow-auto rounded-md border bg-background/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.cstSchedulerRuns.slice(0, 8).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.target_date}</TableCell>
                    <TableCell><Badge variant={run.status === "SUCCESS" ? "success" : run.status === "FAILED" ? "danger" : "warning"}>{run.status}</Badge></TableCell>
                    <TableCell>{run.total_jobs}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{run.message || run.scheduled_for}</TableCell>
                  </TableRow>
                ))}
                {!props.cstSchedulerRuns.length ? <TableRow><TableCell colSpan={4} className="py-4 text-center text-muted-foreground">No scheduled CST runs yet.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid gap-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Recent Batches</h3>
                <p className="text-xs text-muted-foreground">Loaded up to {props.cstBatches.length} batches. Click a batch ID to review its jobs.</p>
              </div>
              <div className="flex gap-2">
                <Input className="h-9 w-56" value={batchSearch} onChange={(event) => setBatchSearch(event.target.value)} placeholder="Search batch/workflow" />
                <Select value={batchStatusFilter} values={["all", "FAILED", "PENDING", "RUNNING", "SUCCESS", "NOT_REQUIRED"]} onChange={setBatchStatusFilter} />
              </div>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Jobs</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBatches.map((batch) => (
                    <TableRow key={batch.id} className={batch.id === selectedBatchId ? "bg-primary/5" : undefined}>
                      <TableCell>
                        <button type="button" className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline" onClick={() => openBatch(batch)}>
                          {batch.id}
                        </button>
                        <p className="text-xs text-muted-foreground">{formatDateTime(batch.created_at)}</p>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate" title={batch.workflow_type}>{batch.workflow_type}</TableCell>
                      <TableCell><Badge variant={batch.status === "SUCCESS" ? "success" : batch.status === "FAILED" || batch.status === "BLOCKED" ? "danger" : "warning"}>{batch.status}</Badge></TableCell>
                      <TableCell>{batch.completed_jobs}/{batch.total_jobs}<span className="ml-1 text-xs text-muted-foreground">failed {batch.failed_jobs}</span></TableCell>
                      <TableCell>{batch.failed_jobs > 0 || batch.blocked_jobs > 0 || batch.completed_jobs < batch.total_jobs ? <Button size="sm" variant="outline" onClick={() => retrySelectedBatch(batch)}>Retry Batch</Button> : null}</TableCell>
                    </TableRow>
                  ))}
                  {!filteredBatches.length ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No CST batches match the filter.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Batch Details</h3>
                <p className="font-mono text-xs text-muted-foreground">{selectedBatchId || "Select a batch"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={batchJobStatusFilter} values={["FAILED", "PENDING", "BLOCKED", "RUNNING", "SUCCESS", "NOT_REQUIRED", "all"]} onChange={setBatchJobStatusFilter} />
                <Button size="sm" variant="outline" onClick={() => void batchJobsQuery.refetch()} disabled={!selectedBatchId || batchJobsQuery.isFetching}>
                  {batchJobsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Refresh Jobs
                </Button>
                {selectedBatch && (selectedBatch.failed_jobs > 0 || selectedBatch.blocked_jobs > 0 || selectedBatch.completed_jobs < selectedBatch.total_jobs) ? <Button size="sm" variant="outline" onClick={() => retrySelectedBatch(selectedBatch)}>Retry Batch</Button> : null}
              </div>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CIDR</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedBatchJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <p className="font-semibold">{job.cidr}</p>
                        <p className="font-mono text-xs text-muted-foreground">{job.transaction_id}</p>
                        <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
                      </TableCell>
                      <TableCell>{job.operation}</TableCell>
                      <TableCell><Badge variant={job.status === "SUCCESS" ? "success" : job.status === "FAILED" || job.status === "BLOCKED" ? "danger" : job.status === "PENDING" ? "warning" : "default"}>{job.status}</Badge></TableCell>
                      <TableCell className="max-w-[360px] text-xs text-muted-foreground">{job.last_error || "-"}</TableCell>
                      <TableCell>{retryableStatuses.has(job.status) ? <Button size="sm" variant="outline" onClick={() => retryJobFromBatch(job)}>Retry</Button> : null}</TableCell>
                    </TableRow>
                  ))}
                  {selectedBatchId && batchJobsQuery.isFetching ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Loading batch jobs...</TableCell></TableRow> : null}
                  {selectedBatchId && !batchJobsQuery.isFetching && !selectedBatchJobs.length ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No jobs match this batch/status filter.</TableCell></TableRow> : null}
                  {!selectedBatchId ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Select a batch to view failed jobs and retry individual transactions.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Recent Jobs</h3>
          <div className="max-h-[300px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.cstJobs.slice(0, 60).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <p className="font-semibold">{job.cidr}</p>
                      <p className="font-mono text-xs text-muted-foreground">{job.transaction_id}</p>
                      <p className="font-mono text-xs text-muted-foreground">{formatDateTime(job.created_at)}</p>
                    </TableCell>
                    <TableCell>{job.operation}</TableCell>
                    <TableCell><Badge variant={job.status === "SUCCESS" ? "success" : job.status === "FAILED" || job.status === "BLOCKED" ? "danger" : job.status === "PENDING" ? "warning" : "default"}>{job.status}</Badge></TableCell>
                    <TableCell className="max-w-[360px] text-xs text-muted-foreground">{job.last_error || "-"}</TableCell>
                    <TableCell><button type="button" className="font-mono text-xs text-primary underline-offset-2 hover:underline" onClick={() => setSelectedBatchId(job.batch_id)}>{job.batch_id}</button></TableCell>
                    <TableCell>{retryableStatuses.has(job.status) ? <Button size="sm" variant="outline" onClick={() => props.onRetryCstJob(job)}>Retry</Button> : null}</TableCell>
                  </TableRow>
                ))}
                {!props.cstJobs.length ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No CST jobs yet.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Transaction Ledger</h3>
          <div className="max-h-[300px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Batch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.cstTransactions.slice(0, 80).map((item) => (
                  <TableRow key={item.transaction_id}>
                    <TableCell className="font-mono text-xs">{item.transaction_id}</TableCell>
                    <TableCell className="font-semibold">{item.cidr}</TableCell>
                    <TableCell><Badge variant={item.last_status === "SUCCESS" ? "success" : item.last_status === "FAILED" || item.last_status === "BLOCKED" ? "danger" : "warning"}>{item.last_status}</Badge></TableCell>
                    <TableCell>{formatDateTime(item.first_used_at)}</TableCell>
                    <TableCell><button type="button" className="font-mono text-xs text-primary underline-offset-2 hover:underline" onClick={() => setSelectedBatchId(item.batch_id)}>{item.batch_id}</button></TableCell>
                  </TableRow>
                ))}
                {!props.cstTransactions.length ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No CST transaction IDs have been generated.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DatabaseConnectionSettings(props: {
  status: DatabaseConnectionStatus | null;
  form: DatabaseConnectionPayload;
  onForm: (value: DatabaseConnectionPayload) => void;
  onTest: () => void;
}) {
  const status = props.status;
  const generatedUrl = `postgresql://${encodeURIComponent(props.form.username)}:${props.form.password ? "********" : "<password>"}@${props.form.host}:${props.form.port}/${encodeURIComponent(props.form.database)}?sslmode=${props.form.ssl_mode}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Connection</CardTitle>
        <CardDescription>Review the active application database and test PostgreSQL details before switching the API server.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-4">
          <ReportMetric label="Current Engine" value={status?.current_engine ?? "Unknown"} detail={status?.database_url_configured ? "DATABASE_URL configured" : "DATABASE_URL not configured"} />
          <ReportMetric label="PostgreSQL Driver" value={status?.postgres_driver_available ? "Available" : "Missing"} detail="Python psycopg package" />
          <ReportMetric label="Runtime Switch" value={status?.postgres_runtime_supported ? "Enabled" : "Not active"} detail="Backend DATABASE_URL support" />
          <ReportMetric label="SQLite DB" value={status?.sqlite_path ? "Configured" : "-"} detail={status?.sqlite_path ?? "No path returned"} />
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">PostgreSQL readiness</p>
              <p className="text-sm text-muted-foreground">{status?.message ?? "Database status is loading."}</p>
              {status?.database_url_redacted ? <p className="mt-1 font-mono text-xs text-muted-foreground">{status.database_url_redacted}</p> : null}
            </div>
            <Badge variant={status?.postgres_runtime_supported ? "success" : "warning"}>{status?.postgres_runtime_supported ? "Switch supported" : "Restart/env required"}</Badge>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">PostgreSQL host</span>
            <Input value={props.form.host} onChange={(event) => props.onForm({ ...props.form, host: event.target.value })} placeholder="localhost or DB server IP" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Port</span>
            <Input value={String(props.form.port)} onChange={(event) => props.onForm({ ...props.form, port: Number(event.target.value) || 5432 })} placeholder="5432" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Database</span>
            <Input value={props.form.database} onChange={(event) => props.onForm({ ...props.form, database: event.target.value })} placeholder="lir" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Username</span>
            <Input value={props.form.username} onChange={(event) => props.onForm({ ...props.form, username: event.target.value })} placeholder="lir_app" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <Input name="postgres-db-password" autoComplete="new-password" type="password" value={props.form.password ?? ""} onChange={(event) => props.onForm({ ...props.form, password: event.target.value })} placeholder="PostgreSQL password" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">SSL mode</span>
            <Select value={props.form.ssl_mode} values={["prefer", "disable", "require", "verify-ca", "verify-full"]} onChange={(ssl_mode) => props.onForm({ ...props.form, ssl_mode })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Timeout</span>
            <Input value={String(props.form.connect_timeout)} onChange={(event) => props.onForm({ ...props.form, connect_timeout: Number(event.target.value) || 10 })} placeholder="Seconds" />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">DATABASE_URL preview</span>
            <Input readOnly value={generatedUrl} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={props.onTest}>
            <CheckCircle2 className="h-4 w-4" />
            Test PostgreSQL connection
          </Button>
          <span className="text-xs text-muted-foreground">This test does not save the password. To switch the app, set DATABASE_URL on the API service and restart after PostgreSQL runtime support is active.</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Administration(props: {
  stats: RegistryStats;
  users: User[];
  auditEvents: AuditEvent[];
  currentRole: User["role"];
  newUser: { username: string; password: string; role: User["role"] };
  passwordReset: { userId: string; password: string };
  ripeConfig: RipeConfig | null;
  ripeConfigForm: RipeConfigPayload;
  siebelConfig: SiebelConfig | null;
  siebelConfigForm: SiebelConfigPayload;
  databaseConnectionStatus: DatabaseConnectionStatus | null;
  databaseConnectionForm: DatabaseConnectionPayload;
  cstConfig: CstConfig | null;
  cstConfigForm: CstConfigPayload;
  cstResourceScope: CstResourceScope;
  ripePoolCsv: string;
  ripeAllocatedPools: RipeAllocatedPool[];
  onNewUser: (value: { username: string; password: string; role: User["role"] }) => void;
  onPasswordReset: (value: { userId: string; password: string }) => void;
  onRipeConfigForm: (value: RipeConfigPayload) => void;
  onSiebelConfigForm: (value: SiebelConfigPayload) => void;
  onDatabaseConnectionForm: (value: DatabaseConnectionPayload) => void;
  onCstConfigForm: (value: CstConfigPayload) => void;
  onCstResourceScope: (scope: CstResourceScope) => void;
  onRipePoolCsv: (value: string) => void;
  onAddUser: () => void;
  onSetPassword: () => void;
  onToggleUser: (user: User) => void;
  onSaveRipeConfig: () => void;
  onSaveSiebelConfig: () => void;
  onTestSiebelConnection: () => void;
  onTestDatabaseConnection: () => void;
  onSaveCstConfig: () => void;
  onTestCstConnection: () => void;
  onRunSiebelDeltaSync: () => void;
  onImportRipePools: () => void;
}) {
  const roles = ["admin", "operator", "viewer"];
  const canManageUsers = props.currentRole === "admin";
  const policyRows = ["Allocation Rules", "Reservation Rules", "Retention Rules"];
  const recentTransactions = props.auditEvents.slice(0, 6);
  return (
    <div className="grid gap-5">
      <PageTitle title="Administration" description="Users, roles, and registry policies for LIR operations." />
      <Card>
        <CardHeader>
          <CardTitle>Registry Health</CardTitle>
          <CardDescription>Capacity and exception signals for administrator review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <HealthRow label="Utilization" value={`${props.stats.utilization}%`} status={`${formatHosts(props.stats.availableCapacity)} available`} />
          <HealthRow label="Largest Free Block" value={props.stats.largestFreeBlock?.cidr ?? "None"} status={props.stats.largestFreeBlock ? formatHosts(props.stats.largestFreeBlock.totalIps) : "No capacity"} />
          <HealthRow label="Fragmentation" value={`${props.stats.fragmentation}%`} status="Free block fragmentation" />
          <HealthRow label="Pending Ops" value={String(props.stats.pendingOperations)} status="Registry actions" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Latest registry transaction history captured by the audit trail.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {recentTransactions.map((event) => (
            <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="font-semibold">{event.action}</p>
                <p className="text-sm text-muted-foreground">{event.entity_type} / {event.entity_id}</p>
              </div>
              <span className="text-xs text-muted-foreground">{formatDateTime(event.timestamp)}</span>
            </div>
          ))}
          {!recentTransactions.length ? <p className="text-sm text-muted-foreground">No audit events captured yet.</p> : null}
        </CardContent>
      </Card>
      {canManageUsers ? <Card>
        <CardHeader>
          <CardTitle>Users & Roles</CardTitle>
          <CardDescription>Administrator, LIR Manager, IP Administrator, Auditor, and Read Only User roles.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Input name="new-application-username" autoComplete="off" value={props.newUser.username} onChange={(event) => props.onNewUser({ ...props.newUser, username: event.target.value })} placeholder="Application username" />
            <Input name="new-application-password" autoComplete="new-password" value={props.newUser.password} onChange={(event) => props.onNewUser({ ...props.newUser, password: event.target.value })} placeholder="Initial application password" type="password" />
            <Select value={props.newUser.role} values={roles} onChange={(role) => props.onNewUser({ ...props.newUser, role: role as User["role"] })} />
            <Button onClick={props.onAddUser}>
              <Users className="h-4 w-4" />
              Add User
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={props.passwordReset.userId} values={props.users.map((user) => user.id)} labels={Object.fromEntries(props.users.map((user) => [user.id, user.username]))} onChange={(userId) => props.onPasswordReset({ ...props.passwordReset, userId })} />
            <Input name="reset-application-password" autoComplete="new-password" value={props.passwordReset.password} onChange={(event) => props.onPasswordReset({ ...props.passwordReset, password: event.target.value })} placeholder="New application password" type="password" />
            <Button variant="secondary" onClick={props.onSetPassword}>
              <KeyRound className="h-4 w-4" />
              Set Password
            </Button>
          </div>
          <div className="grid gap-2">
            {props.users.map((user) => (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="font-semibold">{user.username}</p>
                  <p className="text-sm text-muted-foreground">{user.role} / created {user.created_at.slice(0, 10)}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant={user.status === "Active" ? "success" : "muted"}>{user.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => props.onToggleUser(user)}>{user.status === "Active" ? "Disable" : "Enable"}</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card> : null}
      <DatabaseConnectionSettings
        status={props.databaseConnectionStatus}
        form={props.databaseConnectionForm}
        onForm={props.onDatabaseConnectionForm}
        onTest={props.onTestDatabaseConnection}
      />
      <Card>
        <CardHeader>
          <CardTitle>RIPE Integration</CardTitle>
          <CardDescription>Connection settings and reference allocations for RIPE Database reporting.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Input value={props.ripeConfigForm.base_url} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, base_url: event.target.value })} placeholder="RIPE REST API Base URL" />
            <Select value={props.ripeConfigForm.auth_type} values={["Basic Authentication"]} onChange={(auth_type) => props.onRipeConfigForm({ ...props.ripeConfigForm, auth_type })} />
            <Input value={props.ripeConfigForm.default_maintainer} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, default_maintainer: event.target.value })} placeholder="Default maintainer" />
            <Input name="ripe-api-username" autoComplete="off" value={props.ripeConfigForm.username} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, username: event.target.value })} placeholder="RIPE API username" />
            <Input name="ripe-api-password" autoComplete="new-password" value={props.ripeConfigForm.password ?? ""} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, password: event.target.value })} placeholder={props.ripeConfig?.password_configured ? "RIPE API password configured" : "RIPE API password"} type="password" />
            <div className="grid grid-cols-2 gap-3">
              <Input value={String(props.ripeConfigForm.connection_timeout)} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, connection_timeout: Number(event.target.value) || 10 })} placeholder="Connection timeout" />
              <Input value={String(props.ripeConfigForm.read_timeout)} onChange={(event) => props.onRipeConfigForm({ ...props.ripeConfigForm, read_timeout: Number(event.target.value) || 30 })} placeholder="Read timeout" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={props.onSaveRipeConfig}>
              <Shield className="h-4 w-4" />
              Save RIPE Settings
            </Button>
            <Badge variant={props.ripeConfig?.password_configured ? "success" : "warning"}>{props.ripeConfig?.password_configured ? "Password stored" : "Password missing"}</Badge>
            <span className="text-sm text-muted-foreground">Updated {props.ripeConfig?.updated_at ? props.ripeConfig.updated_at.slice(0, 19) : "not yet"}</span>
          </div>
          <div className="grid gap-3">
            <Textarea value={props.ripePoolCsv} onChange={(event) => props.onRipePoolCsv(event.target.value)} placeholder="pool_name,cidr,allocation_type,source,created_date" />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={props.onImportRipePools}>
                <Upload className="h-4 w-4" />
                Import RIPE Allocated Pools
              </Button>
              <Badge variant="default">{props.ripeAllocatedPools.length} RIPE allocated pools</Badge>
            </div>
          </div>
          <div className="max-h-[260px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pool</TableHead>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.ripeAllocatedPools.map((pool) => (
                  <TableRow key={pool.id}>
                    <TableCell className="font-semibold">{pool.pool_name}</TableCell>
                    <TableCell>{pool.cidr}</TableCell>
                    <TableCell>{pool.start_ip} - {pool.end_ip}</TableCell>
                    <TableCell>{pool.source}</TableCell>
                  </TableRow>
                ))}
                {!props.ripeAllocatedPools.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No RIPE allocated pools imported.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Siebel Integration</CardTitle>
          <CardDescription>Oracle connection and query used to populate business customer assignment details by service ID.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Input value={props.siebelConfigForm.username} onChange={(event) => props.onSiebelConfigForm({ ...props.siebelConfigForm, username: event.target.value })} placeholder="Siebel DB username" />
            <Input name="siebel-db-password" autoComplete="new-password" value={props.siebelConfigForm.password ?? ""} onChange={(event) => props.onSiebelConfigForm({ ...props.siebelConfigForm, password: event.target.value })} placeholder={props.siebelConfig?.password_configured ? "Siebel password configured" : "Siebel DB password"} type="password" />
            <Input value={props.siebelConfigForm.dsn} onChange={(event) => props.onSiebelConfigForm({ ...props.siebelConfigForm, dsn: event.target.value })} placeholder="172.31.23.101:1525/SIDB" />
            <Input value={String(props.siebelConfigForm.connection_timeout)} onChange={(event) => props.onSiebelConfigForm({ ...props.siebelConfigForm, connection_timeout: Number(event.target.value) || 10 })} placeholder="Connection timeout seconds" />
          </div>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Siebel business customer query</span>
              <Button type="button" variant="outline" size="sm" onClick={() => props.onSiebelConfigForm({ ...props.siebelConfigForm, query_sql: DEFAULT_SIEBEL_QUERY })}>Use Salam service query</Button>
            </div>
            <Textarea value={props.siebelConfigForm.query_sql} onChange={(event) => props.onSiebelConfigForm({ ...props.siebelConfigForm, query_sql: event.target.value })} placeholder="SELECT ... WHERE sa.serial_num LIKE :service_id" />
          </div>
          <p className="text-xs text-muted-foreground">The query must include the Oracle bind variable :service_id; the app sends it as a LIKE pattern using the entered service ID. Delta sync re-queries active business assignments by service ID, updates changed BSS customer/contact fields, records each changed field in the BSS sync audit, and queues CST UPDATE jobs for public resources. Customer ID is not used as the matching key.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={props.onSaveSiebelConfig}>
              <Database className="h-4 w-4" />
              Save Siebel Settings
            </Button>
            <Button variant="outline" onClick={props.onTestSiebelConnection}>
              <CheckCircle2 className="h-4 w-4" />
              Test connection
            </Button>
            <Button variant="secondary" onClick={props.onRunSiebelDeltaSync}>
              <RefreshCcw className="h-4 w-4" />
              Run BSS Delta Sync
            </Button>
            <Badge variant={props.siebelConfig?.password_configured ? "success" : "warning"}>{props.siebelConfig?.password_configured ? "Password stored" : "Password missing"}</Badge>
            <span className="text-sm text-muted-foreground">Updated {props.siebelConfig?.updated_at ? props.siebelConfig.updated_at.slice(0, 19) : "not yet"}</span>
          </div>
        </CardContent>
      </Card>
      <CstLirApiSettings
        cstConfig={props.cstConfig}
        cstConfigForm={props.cstConfigForm}
        cstResourceScope={props.cstResourceScope}
        onCstConfigForm={props.onCstConfigForm}
        onCstResourceScope={props.onCstResourceScope}
        onSaveCstConfig={props.onSaveCstConfig}
        onTestCstConnection={props.onTestCstConnection}
      />
      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
          <CardDescription>Registry governance policy areas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3">
          {policyRows.map((policy) => <Badge key={policy} variant="default">{policy}</Badge>)}
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceTable({ resources, empty, onRelease }: { resources: ManagedResource[]; empty: string; onRelease?: (resource: ManagedResource) => void }) {
  const displayResources = presentationResources(resources);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resource List</CardTitle>
        <CardDescription>{displayResources.length} registry resources</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[520px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capacity</TableHead>
                {onRelease ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayResources.map((resource, resourceIndex) => (
                <TableRow key={resourceKey(resource, resourceIndex, "resource-table")}>
                  <TableCell>
                    <p className="font-semibold">{resource.cidr}</p>
                    <p className="text-xs text-muted-foreground">{resource.uuid}</p>
                  </TableCell>
                  <TableCell><ResourceTypeBadge resource={resource} /></TableCell>
                  <TableCell>{resource.owner}</TableCell>
                  <TableCell><Badge variant={badgeForResource(resource)}>{resource.status}</Badge></TableCell>
                  <TableCell>{formatHosts(resource.totalIps)}</TableCell>
                  {onRelease ? (
                    <TableCell>
                      <Button size="sm" variant="destructive" onClick={() => onRelease(resource)}>
                        Release
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!displayResources.length ? <p className="mt-3 text-sm text-muted-foreground">{empty}</p> : null}
      </CardContent>
    </Card>
  );
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function BreadcrumbNavigation({ view, resource, onNavigate }: { view: ViewKey; resource: ManagedResource | null; onNavigate: (view: ViewKey) => void }) {
  const items = breadcrumbsForView(view, resource);
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1">
            {item.view && !last ? (
              <button className="font-medium text-sky-300 hover:text-sky-200 hover:underline" type="button" onClick={() => onNavigate(item.view!)}>
                {item.label}
              </button>
            ) : (
              <span className={last ? "font-semibold text-foreground" : "text-muted-foreground"}>{item.label}</span>
            )}
            {!last ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
          </span>
        );
      })}
    </nav>
  );
}

function breadcrumbsForView(view: ViewKey, resource: ManagedResource | null): Array<{ label: string; view?: ViewKey }> {
  if (view === "executive") {
    return [{ label: "Home" }];
  }
  if (view === "summary") {
    return [
      { label: "Home", view: "executive" },
      { label: "Resource Registry", view: "registry" },
      { label: "Resource Summary" },
      ...(resource ? [{ label: resource.cidr }] : [])
    ];
  }
  return [
    { label: "Home", view: "executive" },
    { label: navigation.find((item) => item.id === view)?.label ?? "Current Page" }
  ];
}

function viewFromPath(pathname: string): ViewKey {
  const route = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return routeAliases[route] ?? "executive";
}

function routeForView(view: ViewKey, selectedResourceId: string) {
  const base = viewRoutes[view] ?? viewRoutes.executive;
  if (view === "summary" && selectedResourceId) {
    return `${base}?resourceId=${encodeURIComponent(selectedResourceId)}`;
  }
  return base;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ title, rows }: { title: string; rows: Array<[string, string | number]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="break-words text-sm font-semibold">{value || "N/A"}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Select({ value, values, labels, onChange }: { value: string; values: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <select className="h-10 w-full rounded-md border bg-muted/40 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select</option>
      {values.map((item) => <option key={item} value={item}>{labels?.[item] ?? item}</option>)}
    </select>
  );
}

function ResourceStatusDot({ resource }: { resource: ManagedResource }) {
  const color = resource.administrativeStatus === "AVAILABLE" ? "bg-emerald-400" : resource.administrativeStatus === "ASSIGNED" ? "bg-sky-400" : resource.administrativeStatus === "RESERVED" ? "bg-amber-400" : resource.ripeSyncStatus === "FAILED" ? "bg-red-400" : resource.administrativeStatus === "RETIRED" || resource.administrativeStatus === "HISTORICAL" ? "bg-zinc-400" : "bg-teal-400";
  return <span className={cn("h-2.5 w-2.5 rounded-full", color)} />;
}

function resourceKey(resource: ManagedResource, index: number, scope: string) {
  return [
    scope,
    resource.id,
    resource.uuid,
    resource.parentId,
    resource.cidr,
    resource.startNumber,
    resource.endNumber,
    resource.operationType,
    index
  ].join("|");
}

function tagValue(tags: string | undefined, key: string) {
  const normalizedKey = key.trim().toLowerCase();
  for (const part of String(tags || "").split(";")) {
    const [tagKey, ...tagValueParts] = part.split("=");
    if (tagKey?.trim().toLowerCase() === normalizedKey) {
      return tagValueParts.join("=").trim();
    }
  }
  return "";
}

function isAllocatedPool(pool: Pool) {
  const sourceSystem = String(pool.source_system || "").trim();
  return sourceSystem === "RIPE IP Pools Discovery" || sourceSystem === "Local Allocated Pool Bulk Import" || tagValue(pool.tags, "pool_type").toLowerCase() === "allocated pool";
}

function isRipeDiscoveryPool(pool: Pool) {
  return isAllocatedPool(pool);
}

function isRipeAllocatedPoolResource(resource: ManagedResource) {
  return resource.allocatedPool || ["RIPE IP Pools Discovery", "Local Allocated Pool Bulk Import"].includes(String(resource.sourceRegistry || "").trim());
}
function resourceTypeLabel(resource: ManagedResource) {
  return isRipeAllocatedPoolResource(resource) ? "Allocated Pool" : resource.type;
}

function isAssignedSearchResource(resource: ManagedResource) {
  return resource.administrativeStatus === "ASSIGNED";
}

function assignedResourceCustomerLabel(resource: ManagedResource) {
  if (!isAssignedSearchResource(resource)) {
    return "";
  }
  return resource.organizationName || resource.fullName || resource.netname || resource.owner || "";
}

function assignedResourceServiceLabel(resource: ManagedResource) {
  if (!isAssignedSearchResource(resource)) {
    return "";
  }
  return resource.serviceId || resource.serviceDescription || resource.description || resource.accessTechnology || "";
}

function AllocatedPoolBadge() {
  return <span className="inline-flex items-center rounded-md border border-cyan-400/70 bg-cyan-400/15 px-2 py-1 text-xs font-semibold text-cyan-300">Allocated Pool</span>;
}

function ResourceTypeBadge({ resource }: { resource: ManagedResource }) {
  return isRipeAllocatedPoolResource(resource) ? <AllocatedPoolBadge /> : <Badge variant="default">{resource.type}</Badge>;
}

function resourceActions(resource: ManagedResource, children: ManagedResource[]) {
  const lifecycleBlockingChildren = children.filter(
    (child) => child.operationType !== "CALCULATED_FREE_SPACE" && !["RETIRED", "HISTORICAL"].includes(child.administrativeStatus)
  );
  const deletionBlockingChildren = children.filter((child) => child.administrativeStatus === "ASSIGNED" || child.administrativeStatus === "RESERVED");
  const persistedAssignment = Boolean(resource.source && "customer_name" in resource.source);
  const persistedPool = Boolean(resource.source && !("customer_name" in resource.source));
  const virtualAvailableSubnet = !resource.source && resource.type === "Subnet" && resource.administrativeStatus === "AVAILABLE";
  const canPersistRetire = Boolean(resource.source) || virtualAvailableSubnet;
  const canReserve = resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet";
  const canAssign = (resource.administrativeStatus === "AVAILABLE" || resource.administrativeStatus === "RESERVED") && resource.type === "Subnet";
  const canRelease = (resource.administrativeStatus === "RESERVED" || resource.administrativeStatus === "ASSIGNED") && persistedAssignment;
  const retireBlockers = [
    allowedTransitions[resource.administrativeStatus].includes("RETIRED") ? "" : `Cannot retire from ${resource.administrativeStatus}`,
    lifecycleBlockingChildren.length ? "Retire child resources first" : "",
    canPersistRetire ? "" : "Calculated resources cannot be retired directly"
  ].filter(Boolean);
  const canRetire = retireBlockers.length === 0;
  const deleteBlockers = [
    resource.administrativeStatus === "RETIRED" ? "" : "Only RETIRED resources can be deleted",
    deletionBlockingChildren.length ? "Release assigned/reserved child CIDRs first" : "",
    persistedAssignment || persistedPool ? "" : "Calculated resources cannot be deleted"
  ].filter(Boolean);

  return {
    canReserve,
    reserveReason: canReserve ? "Reserve this AVAILABLE subnet" : "Only AVAILABLE subnet resources can be reserved",
    canAssign,
    assignReason: canAssign ? "Assign this subnet" : "Only AVAILABLE or RESERVED subnet resources can be assigned",
    canRelease,
    releaseReason: canRelease ? "Release back to AVAILABLE" : "Only persisted RESERVED or ASSIGNED resources can be released",
    canRetire,
    retireReason: canRetire ? "Retire this resource" : retireBlockers.join(". "),
    canDeleteRetired: deleteBlockers.length === 0,
    deleteReason: deleteBlockers.length === 0 ? "Delete this retired resource" : deleteBlockers.join(". ")
  };
}

function assignmentPreviewCidr(form: AssignmentPayload, poolDraft: PoolAssignmentDraft, resources: ManagedResource[]) {
  try {
    return assignmentSelectionCidr(form, poolDraft, resources) || "selected subnet";
  } catch {
    return "selected subnet";
  }
}

function assignmentOwnerLabel(form: AssignmentPayload) {
  return (
    form.organization_name ||
    form.customer_name ||
    form.full_name ||
    form.internal_application_name ||
    form.internal_business_unit ||
    assignmentTargetLabels[form.assignment_target_type] ||
    ""
  );
}

function assignmentDefaultsForOwner(owner: string, form: AssignmentPayload): Partial<AssignmentPayload> {
  const target = ownerToAssignmentTarget[owner] ?? "internal";
  return {
    ...assignmentDefaultsForTarget(target, form),
    owner,
    assignment_target_type: target
  };
}

function assignmentDefaultsForTarget(target: AssignmentPayload["assignment_target_type"], form: AssignmentPayload): Partial<AssignmentPayload> {
  const businessLike = target === "business_customer";
  const individual = target === "individual";
  const internal = target === "internal";
  const businessDefaults = businessLike ? pendingBssBusinessDefaults : {};
  return {
    ...businessDefaults,
    assignment_target_type: target,
    assignment_status_id: assignmentStatusByTarget[target],
    status: (form.status === "Blocked" ? "Blocked" : "Active") as AssignmentStatus,
    customer_type: businessLike ? form.customer_type || "CORP" : "NA",
    subnet_type: form.subnet_type || "NA",
    customer_segment: businessLike ? form.customer_segment || "Enterprise" : individual ? form.customer_segment || "Residential" : form.customer_segment,
    customer_type_id: businessLike ? form.customer_type_id || pendingBssBusinessDefaults.customer_type_id || "2" : form.customer_type_id,
    service_specification_name: businessLike || individual ? form.service_specification_name || "L3 Connectivity Service" : form.service_specification_name || "IP Resource Service",
    service_specification_type: businessLike || individual ? form.service_specification_type || "CustomerFacingServiceSpecification" : form.service_specification_type || "ResourceFacingServiceSpecification",
    service_type: businessLike || individual ? form.service_type || "CustomerFacingService" : form.service_type || "ResourceFacingService",
    service_category: businessLike || individual ? form.service_category || "L3 Service" : form.service_category || "IP Address Resource",
    l3_service: form.l3_service || (businessLike ? pendingBssBusinessDefaults.l3_service || "MPLS L3VPN" : individual ? "Internet Access" : "IPv4 Number Resource"),
    service_id: businessLike ? form.service_id || pendingBssBusinessDefaults.service_id || "" : form.service_id,
    service_instance_id: businessLike ? form.service_instance_id || pendingBssBusinessDefaults.service_instance_id || "" : form.service_instance_id,
    service_description: form.service_description || (businessLike ? pendingBssBusinessDefaults.service_description || "Business customer IP assignment" : individual ? "Individual customer IP assignment" : "Internal IP assignment"),
    owner: internal ? form.owner || "Salam LIR" : form.owner || "Business Customer",
    service_provider_id: form.service_provider_id || "5",
    service_provider_name: form.service_provider_name || "Salam",
    action_flag: form.action_flag || "N",
    cst_sync_status: form.cst_sync_status || "PENDING",
    ripe_sync_status: form.ripe_sync_status || "PENDING"
  };
}

function normalizeAssignmentPayload(form: AssignmentPayload) {
  const target = form.assignment_target_type;
  const ownerName = assignmentOwnerLabel(form) || form.owner || assignmentTargetLabels[target];
  return {
    ...form,
    assignment_status_id: assignmentStatusByTarget[target] ?? form.assignment_status_id,
    status: (form.status === "Blocked" ? "Blocked" : "Active") as AssignmentStatus,
    customer_name: ownerName,
    organization_name: form.organization_name || (target === "business_customer" ? ownerName : ""),
    full_name: target === "individual" ? "" : form.full_name || form.contact_name,
    mobile_number: target === "individual" ? "" : form.mobile_number,
    id_number: target === "individual" ? "" : form.id_number,
    email: target === "individual" ? "" : form.email,
    service_id: form.service_id || form.service_instance_id,
    access_technology: form.access_technology || accessTechnologyLabels[form.access_technology_id] || "",
    customer_type: target === "business_customer" ? form.customer_type || "CORP" : "NA",
    subnet_type: form.subnet_type || "NA",
    service_description: form.service_description || form.service || form.assignment_purpose,
    assignment_name: form.assignment_name || `${ownerName} ${form.cidr}`,
    assignment_description: form.assignment_description || form.service_description || form.notes
  };
}

function buildAssignmentPayload(form: AssignmentPayload, poolDraft: PoolAssignmentDraft, resources: ManagedResource[]) {
  const normalizedForm = normalizeAssignmentPayload(form);
  if (!form.assignment_date) {
    throw new Error("Assignment date is required.");
  }
  if (!normalizedForm.customer_name && !normalizedForm.internal_application_name) {
    throw new Error("Resource owner name or internal application name is required.");
  }
  if ((normalizedForm.assignment_target_type === "internal" || normalizedForm.assignment_status_id === 2) && !normalizedForm.service_description.trim()) {
    throw new Error("serviceDescription is mandatory when assignmentStatusId = 2 (Internal).");
  }
  const cidr = assignmentSelectionCidr(normalizedForm, poolDraft, resources);
  if (!cidr.trim()) {
    throw new Error("CIDR is required.");
  }
  return { ...normalizedForm, cidr, assignment_name: normalizedForm.assignment_name || `${normalizedForm.customer_name} ${cidr}` };
}

function assignmentResultDetail(status: "Success" | "Failed", assignment: Assignment) {
  return [
    `Assignment Status: ${status}`,
    `CIDR: ${assignment.cidr}`,
    `Range: ${assignment.start} - ${assignment.end}`,
    `Usable Range: ${assignment.first_usable} - ${assignment.last_usable}`,
    `Total IPs: ${formatHosts(assignment.size)}`,
    `Assignment Lifecycle: ${assignment.status}`,
    `Owner: ${assignment.customer_name || assignment.internal_application_name || assignment.owner || "N/A"}`,
    `Service: ${assignment.service || assignment.l3_service || assignment.service_instance_id || "N/A"}`
  ].join("\n");
}

function assignmentFailureDetail(payload: AssignmentPayload, error: unknown) {
  const lines = [
    "Assignment Status: Failed",
    `CIDR: ${payload.cidr || "N/A"}`,
    `Reason: ${errorMessage(error)}`
  ];
  try {
    const range = toRange(payload.cidr);
    lines.splice(2, 0, `Range: ${range.firstUsable} - ${range.lastUsable}`, `Total IPs: ${formatHosts(range.size)}`);
  } catch {
    lines.splice(2, 0, "Range: N/A", "Total IPs: N/A");
  }
  return lines.join("\n");
}

function safeRange(cidr: string) {
  try {
    return toRange(cidr);
  } catch {
    return null;
  }
}

function safePoolAssignmentCidr(poolDraft: PoolAssignmentDraft, pool: ManagedResource) {
  try {
    return cidrFromPoolDraft(poolDraft, pool);
  } catch {
    return "";
  }
}

function rangesOverlap(left: Range, right: Range) {
  return left.start <= right.end && right.start <= left.end;
}

function subtractRange(container: Range, removed: Range): Range[] {
  if (!rangesOverlap(container, removed)) {
    return [container];
  }
  const fragments: Range[] = [];
  const overlapStart = Math.max(container.start, removed.start);
  const overlapEnd = Math.min(container.end, removed.end);
  if (container.start < overlapStart) {
    fragments.push(...rangeToCidrs(container.start, overlapStart - 1));
  }
  if (overlapEnd < container.end) {
    fragments.push(...rangeToCidrs(overlapEnd + 1, container.end));
  }
  return fragments.sort((left, right) => left.start - right.start || left.prefix - right.prefix);
}

function subtractRanges(container: Range, removedRanges: Range[]) {
  return removedRanges.reduce<Range[]>((fragments, removed) => fragments.flatMap((fragment) => subtractRange(fragment, removed)), [container]);
}

function partialReassignmentDraftSummary(assignment: Assignment | null, requestedCidr: string, resources: ManagedResource[]): PartialReassignmentSummary {
  const empty: PartialReassignmentSummary = {
    originalCidr: assignment?.cidr ?? "",
    requestedCidr: requestedCidr.trim(),
    originalRange: null,
    requestedRange: null,
    sourceSubnet: null,
    mode: "",
    assignedFragments: [],
    unassignedFragments: [],
    additionalAssignedFragments: [],
    error: assignment ? "" : "Select an original assignment."
  };
  if (!assignment) {
    return empty;
  }
  const requestedText = requestedCidr.trim();
  if (!requestedText) {
    return { ...empty, error: "Enter the to-be assignment CIDR." };
  }
  try {
    const originalRange = parseCidr(assignment.cidr);
    const requestedRange = parseCidr(requestedText);
    const sourceSubnet = presentationResources(resources)
      .filter((resource) => resource.type === "Subnet" && contains(toRange(resource.cidr), requestedRange))
      .sort((left, right) => right.prefix - left.prefix)[0] ?? null;
    const base = { ...empty, originalRange, requestedRange, requestedCidr: requestedRange.cidr, sourceSubnet };
    if (requestedText !== requestedRange.cidr) {
      return { ...base, error: `${requestedText} is not CIDR-aligned. Choose ${requestedRange.cidr} or a valid boundary.` };
    }
    if (requestedRange.cidr === originalRange.cidr) {
      return {
        ...base,
        mode: "No change",
        assignedFragments: [requestedRange],
        error: "Change the to-be CIDR to shrink or expand the assignment."
      };
    }
    if (contains(originalRange, requestedRange)) {
      return {
        ...base,
        mode: "Shrink",
        assignedFragments: [requestedRange],
        unassignedFragments: subtractRange(originalRange, requestedRange)
      };
    }
    if (contains(requestedRange, originalRange)) {
      const additionalAssignedFragments = subtractRange(requestedRange, originalRange);
      const adjacent = additionalAssignedFragments.every((fragment) => fragment.end + 1 === originalRange.start || fragment.start === originalRange.end + 1);
      if (!adjacent) {
        return { ...base, mode: "Expansion", assignedFragments: [requestedRange], additionalAssignedFragments, error: "Expansion must be adjacent to the existing assignment." };
      }
      const availableSources = presentationResources(resources)
        .filter((resource) => resource.type === "Subnet" && resource.administrativeStatus === "AVAILABLE")
        .map((resource) => toRange(resource.cidr))
        .filter((range) => additionalAssignedFragments.some((fragment) => rangesOverlap(range, fragment)));
      const uncovered = additionalAssignedFragments.filter((fragment) => !availableSources.some((source) => contains(source, fragment)));
      const unassignedFragments = availableSources.flatMap((source) => subtractRanges(source, additionalAssignedFragments.filter((fragment) => rangesOverlap(source, fragment))));
      return {
        ...base,
        mode: "Expansion",
        assignedFragments: [requestedRange],
        additionalAssignedFragments,
        unassignedFragments,
        error: uncovered.length ? `Additional range is not fully available: ${uncovered.map((fragment) => fragment.cidr).join(", ")}` : ""
      };
    }
    return { ...base, error: `${requestedRange.cidr} must either shrink within or expand around original assignment ${assignment.cidr}.` };
  } catch (error) {
    return { ...empty, error: errorMessage(error) };
  }
}

function assignmentDraftSummary(form: AssignmentPayload, poolDraft: PoolAssignmentDraft, resources: ManagedResource[]): AssignmentDraftSummary {
  try {
    const cidr = assignmentSelectionCidr(form, poolDraft, resources);
    const range = cidr ? parseCidr(cidr) : null;
    const sourceSubnet = range
      ? presentationResources(resources)
          .filter((resource) => resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet")
          .find((resource) => contains(toRange(resource.cidr), range)) ?? null
      : null;
    return { cidr, range, sourceSubnet, error: "" };
  } catch (error) {
    return { cidr: "", range: null, sourceSubnet: null, error: errorMessage(error) };
  }
}

function visibleAssignmentError(error: string) {
  return error && !error.startsWith("Subnet prefix must be larger than /");
}

function assignmentSelectionCidr(form: AssignmentPayload, poolDraft: PoolAssignmentDraft, resources: ManagedResource[]) {
  if (poolDraft.selectionMode === "range") {
    return cidrFromRangeDraft(poolDraft, resources);
  }
  if (poolDraft.parentPoolId) {
    const pool = resources.find((resource) => resource.id === poolDraft.parentPoolId && resource.type === "Subnet" && resource.administrativeStatus === "AVAILABLE");
    if (!pool) {
      throw new Error("Select a valid available subnet.");
    }
    return cidrFromPoolDraft(poolDraft, pool);
  }
  return form.cidr.trim();
}

function cidrFromRangeDraft(poolDraft: PoolAssignmentDraft, resources: ManagedResource[]) {
  if (!poolDraft.startIp.trim() || !poolDraft.endIp.trim()) {
    throw new Error("Start IP and end IP are required.");
  }
  const start = ipToNumber(poolDraft.startIp.trim());
  const end = ipToNumber(poolDraft.endIp.trim());
  if (start > end) {
    throw new Error("Start IP must be before end IP.");
  }
  const blocks = rangeToCidrs(start, end);
  if (blocks.length !== 1 || blocks[0].start !== start || blocks[0].end !== end) {
    throw new Error("Start IP and end IP must form one CIDR block. Use a power-of-two aligned range.");
  }
  const containingSubnet = presentationResources(resources)
    .filter((resource) => resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet")
    .find((resource) => contains(toRange(resource.cidr), blocks[0]));
  if (!containingSubnet) {
    throw new Error("Selected range is not inside an available subnet.");
  }
  return blocks[0].cidr;
}

function cidrFromPoolDraft(poolDraft: PoolAssignmentDraft, pool: ManagedResource) {
  const prefix = Number.parseInt(poolDraft.prefix, 10);
  if (!Number.isInteger(prefix) || prefix < pool.prefix || prefix > 32) {
    throw new Error(`Subnet prefix must be /${pool.prefix} or larger and no larger than /32.`);
  }
  const start = ipToNumber(poolDraft.startIp);
  const candidate = parseCidr(`${numberToIp(start)}/${prefix}`);
  if (candidate.start !== start) {
    throw new Error(`${poolDraft.startIp}/${prefix} is not CIDR-aligned. Choose ${candidate.cidr} or a valid boundary.`);
  }
  if (!contains(toRange(pool.cidr), candidate)) {
    throw new Error(`${candidate.cidr} is outside source subnet ${pool.cidr}.`);
  }
  return candidate.cidr;
}

function sameRange(left: Range, right: Range) {
  return left.start === right.start && left.end === right.end;
}

function poolHierarchyEntries(pools: Pool[]) {
  return pools.map((pool) => ({ pool, range: toRange(pool) }));
}

function ipResourceOwnerFromMaintainer(maintainer: string | null | undefined) {
  const normalized = String(maintainer || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (normalized.includes("ORBIT")) {
    return "OrbitNet";
  }
  if (normalized.includes("SALAM") || normalized.includes("ITCNOC") || ["ITCNOCMNT", "ITCMNT"].includes(normalized)) {
    return "Salam";
  }
  return String(maintainer || "").trim() || "Salam";
}

function resourceMaintainerFromPool(pool: Pool | null | undefined) {
  return String(pool?.owner || "ITC-NOC-MNT").trim() || "ITC-NOC-MNT";
}

function nearestParentPoolIdForPool(pool: Pool, range: Range, entries: Array<{ pool: Pool; range: Range }>) {
  const candidates = entries.filter(({ pool: candidate, range: candidateRange }) => {
    if (candidate.id === pool.id || !contains(candidateRange, range)) {
      return false;
    }
    if (!sameRange(candidateRange, range)) {
      return true;
    }
    return isRipeDiscoveryPool(candidate) && !isRipeDiscoveryPool(pool);
  });
  candidates.sort((left, right) => {
    const prefixDelta = right.pool.prefix - left.pool.prefix;
    if (prefixDelta) {
      return prefixDelta;
    }
    return Number(isRipeDiscoveryPool(right.pool)) - Number(isRipeDiscoveryPool(left.pool));
  });
  return candidates[0]?.pool.id ?? "";
}

function nearestParentPoolIdForAssignment(range: Range, entries: Array<{ pool: Pool; range: Range }>) {
  const candidates = entries.filter(({ range: poolRange }) => contains(poolRange, range));
  candidates.sort((left, right) => {
    const prefixDelta = right.pool.prefix - left.pool.prefix;
    if (prefixDelta) {
      return prefixDelta;
    }
    return Number(isRipeDiscoveryPool(left.pool)) - Number(isRipeDiscoveryPool(right.pool));
  });
  return candidates[0]?.pool.id ?? "";
}
function buildRegistryResources(pools: Pool[], assignments: Assignment[], persistedResources: ResourceRecord[] = []) {
  const resources: ManagedResource[] = [];
  const poolEntries = poolHierarchyEntries(pools);
  const persistedByUuid = new Map(persistedResources.map((resource) => [resource.resource_uuid, resource]));
  const persistedBySource = new Map(persistedResources.map((resource) => [`${resource.source_entity_type}:${resource.source_entity_id}`, resource]));
  const persistedByCidr = new Map<string, ResourceRecord[]>();
  for (const resource of persistedResources) {
    const rows = persistedByCidr.get(resource.cidr) ?? [];
    rows.push(resource);
    persistedByCidr.set(resource.cidr, rows);
  }
  const persistedFor = (uuid: string, sourceType: string, sourceId: string, cidr: string) => (
    persistedByUuid.get(uuid)
    ?? persistedBySource.get(`${sourceType}:${sourceId}`)
    ?? persistedByCidr.get(cidr)?.find((resource) => resource.source_entity_type === sourceType)
    ?? persistedByCidr.get(cidr)?.find((resource) => resource.source_entity_type !== "pool")
    ?? persistedByCidr.get(cidr)?.[0]
    ?? null
  );
  const persistedCstStatus = (resource: ResourceRecord | null, fallback: CstSyncStatus) => resource?.cst_sync_status ? normalizeCstSyncStatus(resource.cst_sync_status) : fallback;
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const occupyingAssignments = assignments.filter((assignment) => !assignmentReleasedAfterRipeRemoval(assignment));
  const poolParentById = new Map(poolEntries.map(({ pool, range }) => [pool.id, nearestParentPoolIdForPool(pool, range, poolEntries)]));
  const assignmentParentById = new Map(occupyingAssignments.map((assignment) => [assignment.id, nearestParentPoolIdForAssignment(toRange(assignment), poolEntries)]));
  for (const pool of pools) {
    const poolRange = toRange(pool);
    const childAssignments = occupyingAssignments.filter((assignment) => contains(poolRange, toRange(assignment)));
    const directAssignments = childAssignments.filter((assignment) => assignmentParentById.get(assignment.id) === pool.id);
    const usedIps = childAssignments.filter((assignment) => assignment.status !== "Reserved").reduce((sum, assignment) => sum + assignment.size, 0);
    const reservedIps = childAssignments.filter((assignment) => assignment.status === "Reserved").reduce((sum, assignment) => sum + assignment.size, 0);
    const freeIps = Math.max(0, pool.size - usedIps - reservedIps);
    const poolStatus = poolAdministrativeStatus(pool);
    const poolClassification = classifyCidr(pool.cidr);
    const poolIsPublic = poolClassification === "PUBLIC";
    const poolResourceUuid = resourceUuid("pool", pool.id, pool.cidr);
    const persistedPoolResource = persistedFor(poolResourceUuid, "pool", pool.id, pool.cidr);
    const poolMaintainer = persistedPoolResource?.maintainer || resourceMaintainerFromPool(pool);
    const poolOwner = persistedPoolResource?.owner || ipResourceOwnerFromMaintainer(poolMaintainer);
    resources.push({
      id: pool.id,
      uuid: poolResourceUuid,
      parentId: poolParentById.get(pool.id) || "",
      cidr: pool.cidr,
      serviceProviderId: "5",
      serviceProviderName: "Salam",
      asn: pool.asn || "AS35753",
      assignmentStatusId: 1,
      serviceId: "",
      organizationName: "",
      organizationId: "",
      customerTypeId: "",
      customerType: "NA",
      subnetType: "NA",
      productClass: "",
      regionId: "",
      cityId: "",
      fullName: "",
      mobileNumber: "",
      idNumber: "",
      email: "",
      startIp: pool.start,
      endIp: pool.end,
      startNumber: poolRange.start,
      endNumber: poolRange.end,
      prefix: pool.prefix,
      totalIps: pool.size,
      usedIps,
      reservedIps,
      freeIps,
      utilization: pool.size ? round1(((usedIps + reservedIps) / pool.size) * 100) : 0,
      type: "Subnet",
      role: "Subnet",
      classification: poolClassification,
      owner: poolOwner,
      status: poolStatus,
      administrativeStatus: poolStatus,
      ripeSyncRequired: poolIsPublic,
      ripeSyncStatus: poolIsPublic ? "PENDING" : "EXCLUDED",
      cstSyncStatus: poolIsPublic ? persistedCstStatus(persistedPoolResource, "PENDING") : "NOT_REQUIRED",
      actionFlag: persistedPoolResource?.action_flag || "N",
      accessTechnologyId: "",
      accessTechnology: "",
      serviceDescription: "",
      transactionId: persistedPoolResource?.transaction_id || pool.external_id || pool.id,
      sourceRegistry: pool.source_system || "Local Registry",
      lastUpdated: persistedPoolResource?.updated_at || pool.last_audit_at || pool.created_at,
      netname: pool.name,
      description: pool.description || pool.name,
      country: "SA",
      maintainer: poolMaintainer,
      previousUuid: "",
      sourceUuid: "",
      successorUuid: "",
      operationType: "CREATE",
      source: pool,
      allocatedPool: isRipeDiscoveryPool(pool)
    });

    for (const assignment of directAssignments) {
      const assignmentRange = toRange(assignment);
      const reserved = assignment.status === "Reserved";
      const hideIndividualIdentity = assignmentIsIndividual(assignment);
      const assignmentClassification = classifyCidr(assignment.cidr);
      const assignmentIsPublic = assignmentClassification === "PUBLIC";
      const assignmentParentPool = poolById.get(assignmentParentById.get(assignment.id) || "") ?? null;
      const assignmentResourceUuid = resourceUuid("assignment", assignment.id, assignment.cidr);
      const persistedAssignmentResource = persistedFor(assignmentResourceUuid, "assignment", assignment.id, assignment.cidr);
      const assignmentMaintainer = persistedAssignmentResource?.maintainer || resourceMaintainerFromPool(assignmentParentPool);
      const ipResourceOwner = persistedAssignmentResource?.owner || ipResourceOwnerFromMaintainer(assignmentMaintainer);
      resources.push({
        id: assignment.id,
        uuid: assignmentResourceUuid,
        parentId: pool.id,
        cidr: assignment.cidr,
        serviceProviderId: assignment.service_provider_id || "5",
        serviceProviderName: assignment.service_provider_name || "Salam",
        asn: assignment.asn || "AS35753",
        assignmentStatusId: assignment.assignment_status_id || assignmentStatusIdFromAssignment(assignment),
        serviceId: assignment.service_id || assignment.service_instance_id,
        organizationName: assignment.organization_name || assignment.customer_name,
        organizationId: assignment.organization_id || assignment.customer_id,
        customerTypeId: assignment.customer_type_id,
        customerType: assignment.customer_type || "NA",
        subnetType: assignment.subnet_type || "NA",
        productClass: assignment.product_class || "",
        regionId: assignment.region_id,
        cityId: assignment.city_id,
        fullName: hideIndividualIdentity ? "" : assignment.full_name,
        mobileNumber: hideIndividualIdentity ? "" : assignment.mobile_number || assignment.contact_number,
        idNumber: hideIndividualIdentity ? "" : assignment.id_number,
        email: hideIndividualIdentity ? "" : assignment.email || assignment.contact_email,
        startIp: assignment.start,
        endIp: assignment.end,
        startNumber: assignmentRange.start,
        endNumber: assignmentRange.end,
        prefix: assignment.prefix,
        totalIps: assignment.size,
        usedIps: reserved ? 0 : assignment.size,
        reservedIps: reserved ? assignment.size : 0,
        freeIps: 0,
        utilization: reserved ? 0 : 100,
        type: "Subnet",
        role: "Subnet",
        classification: assignmentClassification,
        owner: ipResourceOwner,
        status: assignmentToAdministrativeStatus(assignment),
        administrativeStatus: assignmentToAdministrativeStatus(assignment),
        ripeSyncRequired: assignmentIsPublic,
        ripeSyncStatus: ripeStatusForAssignment(assignment, assignmentIsPublic),
        cstSyncStatus: assignmentIsPublic ? persistedCstStatus(persistedAssignmentResource, normalizeCstSyncStatus(assignment.cst_sync_status)) : "NOT_REQUIRED",
        actionFlag: persistedAssignmentResource?.action_flag || assignment.action_flag || "N",
        accessTechnologyId: assignment.access_technology_id,
        accessTechnology: assignment.access_technology || accessTechnologyLabels[assignment.access_technology_id] || "",
        serviceDescription: assignment.service_description || assignment.service || assignment.assignment_purpose,
        transactionId: persistedAssignmentResource?.transaction_id || assignment.service_instance_id || assignment.id,
        sourceRegistry: "Local Registry",
        lastUpdated: persistedAssignmentResource?.updated_at || assignment.created_at,
        netname: assignment.customer_name || assignment.internal_application_name || assignment.assignment_name,
        description: assignment.service || assignment.assignment_description || assignment.assignment_name,
        country: "SA",
        maintainer: assignmentMaintainer,
        previousUuid: "",
        sourceUuid: "",
        successorUuid: "",
        operationType: reserved ? "RESERVE" : assignment.status === "Retiring" ? "RETIRE" : "ASSIGN",
        source: assignment,
        allocatedPool: false
      });
    }

    if (poolStatus !== "RETIRED" && poolStatus !== "HISTORICAL") {
      for (const range of calculateContinuousFreeRanges(pool, occupyingAssignments)) {
        for (const block of rangeToCidrs(range.start, range.end)) {
          if (block.cidr === pool.cidr) {
            continue;
          }
          const freeUuid = resourceUuid("free", pool.id, block.cidr);
          const persistedFreeResource = persistedFor(freeUuid, "bulk_unassigned_fragment", `${poolResourceUuid}:${block.cidr}`, block.cidr);
          const blockClassification = classifyCidr(block.cidr);
          const blockIsPublic = blockClassification === "PUBLIC";
          resources.push({
            id: freeUuid,
            uuid: freeUuid,
            parentId: pool.id,
            cidr: block.cidr,
            serviceProviderId: "5",
            serviceProviderName: "Salam",
            asn: pool.asn || "AS35753",
            assignmentStatusId: 1,
            serviceId: "",
            organizationName: "",
            organizationId: "",
            customerTypeId: "",
            customerType: "NA",
            subnetType: "NA",
            productClass: "",
            regionId: "",
            cityId: "",
            fullName: "",
            mobileNumber: "",
            idNumber: "",
            email: "",
            startIp: block.firstUsable,
            endIp: block.lastUsable,
            startNumber: block.start,
            endNumber: block.end,
            prefix: block.prefix,
            totalIps: block.size,
            usedIps: 0,
            reservedIps: 0,
            freeIps: block.size,
            utilization: 0,
            type: "Subnet",
            role: "Subnet",
            classification: blockClassification,
            owner: poolOwner,
            status: "AVAILABLE",
            administrativeStatus: "AVAILABLE",
            ripeSyncRequired: false,
            ripeSyncStatus: "EXCLUDED",
            cstSyncStatus: blockIsPublic ? persistedCstStatus(persistedFreeResource, "PENDING") : "NOT_REQUIRED",
            actionFlag: persistedFreeResource?.action_flag || "S",
            accessTechnologyId: "",
            accessTechnology: "",
            serviceDescription: "",
            transactionId: persistedFreeResource?.transaction_id || `AVAILABLE-${pool.id}`,
            sourceRegistry: "Calculated",
            lastUpdated: persistedFreeResource?.updated_at || pool.created_at,
            netname: `${pool.name}-FREE`,
            description: "Calculated available free block",
            country: "SA",
            maintainer: poolMaintainer,
            previousUuid: "",
            sourceUuid: persistedFreeResource?.parent_resource_uuid || poolResourceUuid,
            successorUuid: "",
            operationType: "CALCULATED_FREE_SPACE",
            source: null,
            allocatedPool: false
          });
        }
      }
    }
  }
  return resources.sort((left, right) => left.startNumber - right.startNumber || left.prefix - right.prefix);
}

function isRegisteredSubnet(resource: ManagedResource) {
  return Boolean(resource.source && !("customer_name" in resource.source));
}

function buildRegistryStats(resources: ManagedResource[], conflicts: Conflict[]): RegistryStats {
  const pools = resources.filter(isRegisteredSubnet);
  const assignments = resources.filter((resource) => resource.administrativeStatus === "ASSIGNED");
  const reservations = resources.filter((resource) => resource.administrativeStatus === "RESERVED");
  const free = resources.filter((resource) => resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet");
  const total = pools.reduce((sum, item) => sum + item.totalIps, 0);
  const used = pools.reduce((sum, item) => sum + item.usedIps + item.reservedIps, 0);
  const freeTotal = free.reduce((sum, item) => sum + item.totalIps, 0);
  const fragmentedFree = free.slice(1).reduce((sum, item) => sum + item.totalIps, 0);
  return {
    totalResources: total,
    totalPools: pools.length,
    totalAssignments: assignments.length,
    totalReservations: reservations.length,
    utilization: total ? round1((used / total) * 100) : 0,
    availableCapacity: freeTotal,
    largestFreeBlock: free.reduce<ManagedResource | null>((current, resource) => (!current || resource.totalIps > current.totalIps ? resource : current), null),
    fragmentation: freeTotal ? round1((fragmentedFree / freeTotal) * 100) : 0,
    integrityIssues: conflicts.length + detectIntegrityIssues(resources).length,
    pendingOperations: resources.filter((resource) => resource.ripeSyncStatus === "PENDING" || resource.ripeSyncStatus === "DECOMMISSION_PENDING").length
  };
}

function filterResources(resources: ManagedResource[], query: string, filters: SearchFilterCriterion[] = []) {
  const normalized = query.trim().toLowerCase();
  return resources.filter((resource) => {
    const textMatch = !normalized || [
      resource.id,
      resource.uuid,
      resource.parentId,
      resource.cidr,
      resource.startIp,
      resource.endIp,
      resource.type,
      resource.classification,
      resource.owner,
      assignedToLabelForResource(resource),
      resource.administrativeStatus,
      resource.ripeSyncStatus,
      resource.cstSyncStatus,
      resource.transactionId,
      resource.netname,
      resource.description,
      resource.organizationName,
      resource.organizationId,
      resource.fullName,
      resource.serviceId,
      resource.serviceDescription,
      resource.productClass,
      resource.email
    ]
      .some((value) => String(value ?? "").toLowerCase().includes(normalized))
    return textMatch && filters.every((filter) => searchCriterionMatches(resource, filter));
  });
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function searchCriterionMatches(resource: ManagedResource, filter: SearchFilterCriterion) {
  const expected = filter.value.trim().toLowerCase();
  if (!expected) {
    return true;
  }
  const actual = String(resourceValueForSearchField(resource, filter.field) ?? "").toLowerCase();
  const field = SEARCH_FILTER_FIELDS.find((item) => item.value === filter.field);
  return field?.mode === "select" ? actual === expected : actual.includes(expected);
}

function resourceValueForSearchField(resource: ManagedResource, field: SearchFilterField) {
  if (field === "assignedTo") {
    return assignedToLabelForResource(resource);
  }
  return resource[field];
}

function labelForSearchField(field: SearchFilterField) {
  return SEARCH_FILTER_FIELDS.find((item) => item.value === field)?.label ?? field;
}

function filterOptionsForField(field: SearchFilterField, resources: ManagedResource[]) {
  if (field === "administrativeStatus") {
    return lifecycleStates;
  }
  if (field === "classification") {
    return ["PUBLIC", "PRIVATE"];
  }
  if (field === "cstSyncStatus") {
    return uniqueSorted([...CST_SYNC_STATUS_OPTIONS, ...resources.map((resource) => String(resource.cstSyncStatus ?? ""))]);
  }
  if (field === "assignedTo") {
    return uniqueSorted(resources.map((resource) => assignedToLabelForResource(resource)));
  }
  return uniqueSorted(resources.map((resource) => String(resourceValueForSearchField(resource, field) ?? "")));
}

function createSearchFilterId() {
  return `filter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type ExportCell = string | number | boolean;
type ResourceUtilizationRow = Record<string, ExportCell>;

const REGISTRY_EXPORT_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "transactionId", header: "transactionId" },
  { key: "serviceProviderId", header: "serviceProviderId" },
  { key: "ipSubnet", header: "ipSubnet" },
  { key: "owner", header: "owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "asn", header: "asn" },
  { key: "ipVersion", header: "ipVersion" },
  { key: "assignmentStatusId", header: "assignmentStatusId" },
  { key: "serviceId", header: "serviceId" },
  { key: "organizationName", header: "organizationName" },
  { key: "organizationId", header: "organizationId" },
  { key: "customerTypeId", header: "customerTypeId" },
  { key: "customerType", header: "customerType" },
  { key: "subnetType", header: "subnetType" },
  { key: "productClass", header: "productClass" },
  { key: "regionId", header: "regionId" },
  { key: "cityId", header: "cityId" },
  { key: "fullName", header: "fullName" },
  { key: "mobileNumber", header: "mobileNumber" },
  { key: "idNumber", header: "idNumber" },
  { key: "email", header: "email" },
  { key: "assignmentDate", header: "assignmentDate" },
  { key: "updateDate", header: "updateDate" },
  { key: "accessTechnologyId", header: "accessTechnologyId" },
  { key: "accessTechnology", header: "accessTechnology" },
  { key: "serviceDescription", header: "serviceDescription" },
  { key: "description", header: "description" },
  { key: "actionFlag", header: "actionFlag" },
  { key: "cstSyncStatus", header: "cstSyncStatus" },
  { key: "ripeSyncStatus", header: "ripeSyncStatus" }
];

const POOL_SUMMARY_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "pool_name", header: "Subnet Name" },
  { key: "allocation", header: "Allocation" },
  { key: "owner", header: "Owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "total", header: "Total" },
  { key: "usable", header: "Usable" },
  { key: "in_use", header: "In Use" },
  { key: "reserved", header: "Reserved" },
  { key: "free", header: "Free" },
  { key: "usage_percent", header: "Usage %" },
  { key: "largest_free_cidr", header: "Largest Free CIDR" },
  { key: "status", header: "Status" }
];


const LOCAL_ALLOCATED_POOL_UTILIZATION_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "pool_name", header: "Pool Name" },
  { key: "allocation", header: "Allocation" },
  { key: "resource_uuid", header: "Resource UUID" },
  { key: "classification", header: "Classification" },
  { key: "owner", header: "Owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "total", header: "Total IPs" },
  { key: "usable", header: "Usable IPs" },
  { key: "in_use", header: "In Use IPs" },
  { key: "reserved", header: "Reserved IPs" },
  { key: "free", header: "Free IPs" },
  { key: "usage_percent", header: "Usage %" },
  { key: "status", header: "Status" },
  { key: "ripe_sync_status", header: "RIPE Status" },
  { key: "cst_sync_status", header: "CST Status" },
  { key: "source_registry", header: "Source Registry" },
  { key: "transaction_id", header: "Transaction ID" },
  { key: "last_updated", header: "Last Updated" }
];
const ACTIVE_ASSIGNMENT_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "cidr", header: "CIDR" },
  { key: "start_ip", header: "Start IP" },
  { key: "end_ip", header: "End IP" },
  { key: "total_ips", header: "Total IPs" },
  { key: "assignment_status", header: "Assignment Status" },
  { key: "assignment_target_type", header: "Assignment Target Type" },
  { key: "owner", header: "Owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "customer_name", header: "Customer Name" },
  { key: "organization_name", header: "Organization Name" },
  { key: "customer_id", header: "Customer ID" },
  { key: "service_id", header: "Service ID" },
  { key: "service_instance_id", header: "Service Instance ID" },
  { key: "service_description", header: "Service Description" },
  { key: "customer_type", header: "Customer Type" },
  { key: "subnet_type", header: "Subnet Type" },
  { key: "product_class", header: "Product Class" },
  { key: "region_id", header: "Region ID" },
  { key: "city_id", header: "City ID" },
  { key: "contact_name", header: "Contact Name" },
  { key: "contact_number", header: "Contact Number" },
  { key: "contact_email", header: "Contact Email" },
  { key: "transaction_id", header: "Transaction ID" },
  { key: "cst_sync_status", header: "CST Sync Status" },
  { key: "ripe_sync_status", header: "RIPE Sync Status" },
  { key: "assignment_date", header: "Assignment Date" },
  { key: "last_updated", header: "Last Updated" }
];

const ALL_IP_REPORT_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "cidr", header: "CIDR" },
  { key: "start_ip", header: "Start IP" },
  { key: "end_ip", header: "End IP" },
  { key: "total_ips", header: "Total IPs" },
  { key: "used_ips", header: "Assigned IPs" },
  { key: "reserved_ips", header: "Reserved IPs" },
  { key: "free_ips", header: "Available IPs" },
  { key: "utilization_percent", header: "Utilization %" },
  { key: "assignment_status", header: "Assignment Status" },
  { key: "administrative_status", header: "Resource Status" },
  { key: "assignment_target_type", header: "Assignment Target Type" },
  { key: "source_record_type", header: "Source Type" },
  { key: "resource_type", header: "Resource Type" },
  { key: "resource_role", header: "Resource Role" },
  { key: "classification", header: "Classification" },
  { key: "parent_cidr", header: "Parent CIDR" },
  { key: "pool_name", header: "Parent Pool Name" },
  { key: "customer_name", header: "Customer Name" },
  { key: "organization_name", header: "Organization Name" },
  { key: "customer_id", header: "Customer ID" },
  { key: "organization_id", header: "Organization ID" },
  { key: "service_id", header: "Service ID" },
  { key: "service_instance_id", header: "Service Instance ID" },
  { key: "service_description", header: "Service Description" },
  { key: "customer_type", header: "Customer Type" },
  { key: "subnet_type", header: "Subnet Type" },
  { key: "product_class", header: "Product Class" },
  { key: "region_id", header: "Region ID" },
  { key: "city_id", header: "City ID" },
  { key: "city", header: "City" },
  { key: "region", header: "Region" },
  { key: "contact_name", header: "Contact Name" },
  { key: "contact_number", header: "Contact Number" },
  { key: "contact_email", header: "Contact Email" },
  { key: "transaction_id", header: "Transaction ID" },
  { key: "cst_sync_status", header: "CST Sync Status" },
  { key: "ripe_sync_status", header: "RIPE Sync Status" },
  { key: "source_registry", header: "Source Registry" },
  { key: "netname", header: "Netname" },
  { key: "description", header: "Description" },
  { key: "owner", header: "Owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "asn", header: "ASN" },
  { key: "site", header: "Site" },
  { key: "vrf_name", header: "VRF Name" },
  { key: "assignment_date", header: "Assignment Date" },
  { key: "last_updated", header: "Last Updated" },
  { key: "resource_uuid", header: "Resource UUID" }
];
const RESOURCE_UTILIZATION_COLUMNS: Array<{ key: string; header: string }> = [
  { key: "resource_id", header: "Resource ID" },
  { key: "resource_uuid", header: "Resource UUID" },
  { key: "parent_resource_id", header: "Parent Resource ID" },
  { key: "parent_cidr", header: "Parent CIDR" },
  { key: "cidr", header: "CIDR" },
  { key: "prefix_length", header: "Prefix Length" },
  { key: "start_ip", header: "Start IP" },
  { key: "end_ip", header: "End IP" },
  { key: "start_number", header: "Start Number" },
  { key: "end_number", header: "End Number" },
  { key: "total_ips", header: "Total IPs" },
  { key: "used_ips", header: "Used IPs" },
  { key: "reserved_ips", header: "Reserved IPs" },
  { key: "free_ips", header: "Free IPs" },
  { key: "utilization_percent", header: "Utilization %" },
  { key: "resource_type", header: "Resource Type" },
  { key: "resource_role", header: "Resource Role" },
  { key: "classification", header: "Classification" },
  { key: "administrative_status", header: "Administrative Status" },
  { key: "ripe_sync_required", header: "RIPE Sync Required" },
  { key: "ripe_sync_status", header: "RIPE Sync Status" },
  { key: "owner", header: "Owner" },
  { key: "assigned_to", header: "Assigned To" },
  { key: "netname", header: "Netname" },
  { key: "description", header: "Description" },
  { key: "country", header: "Country" },
  { key: "maintainer", header: "Maintainer" },
  { key: "transaction_id", header: "Transaction ID" },
  { key: "source_registry", header: "Source Registry" },
  { key: "last_updated", header: "Last Updated" },
  { key: "previous_uuid", header: "Previous UUID" },
  { key: "source_uuid", header: "Source UUID" },
  { key: "successor_uuid", header: "Successor UUID" },
  { key: "operation_type", header: "Operation Type" },
  { key: "source_record_type", header: "Source Record Type" },
  { key: "source_record_id", header: "Source Record ID" },
  { key: "pool_name", header: "Parent Subnet Name" },
  { key: "pool_region", header: "Parent Subnet Region" },
  { key: "pool_category", header: "Parent Subnet Category" },
  { key: "pool_lifecycle_state", header: "Parent Subnet Lifecycle State" },
  { key: "pool_operational_state", header: "Parent Subnet Operational State" },
  { key: "pool_usage_state", header: "Parent Subnet Usage State" },
  { key: "pool_vrf_name", header: "Parent Subnet VRF Name" },
  { key: "pool_site_name", header: "Parent Subnet Site Name" },
  { key: "assignment_target_type", header: "Assignment Target Type" },
  { key: "assignment_name", header: "Assignment Name" },
  { key: "assignment_status", header: "Assignment Status" },
  { key: "assignment_date", header: "Assignment Date" },
  { key: "assignment_purpose", header: "Assignment Purpose" },
  { key: "service_specification_id", header: "Service Specification ID" },
  { key: "service_specification_name", header: "Service Specification Name" },
  { key: "service_instance_id", header: "Service Instance ID" },
  { key: "service_instance_name", header: "Service Instance Name" },
  { key: "service_type", header: "Service Type" },
  { key: "service_category", header: "Service Category" },
  { key: "l3_service", header: "L3 Service" },
  { key: "service", header: "Service" },
  { key: "customer_id", header: "Customer ID" },
  { key: "customer_name", header: "Customer Name" },
  { key: "customer_type", header: "Customer Type" },
  { key: "subnet_type", header: "Subnet Type" },
  { key: "product_class", header: "Product Class" },
  { key: "customer_account_id", header: "Customer Account ID" },
  { key: "customer_segment", header: "Customer Segment" },
  { key: "commercial_reg_id", header: "Commercial Registration ID" },
  { key: "unified_number", header: "Unified Number" },
  { key: "contact_name", header: "Contact Name" },
  { key: "contact_number", header: "Contact Number" },
  { key: "contact_email", header: "Contact Email" },
  { key: "city", header: "City" },
  { key: "region", header: "Region" },
  { key: "internal_business_unit", header: "Internal Business Unit" },
  { key: "internal_application_id", header: "Internal Application ID" },
  { key: "internal_application_name", header: "Internal Application Name" },
  { key: "internal_environment", header: "Internal Environment" },
  { key: "internal_owner_team", header: "Internal Owner Team" },
  { key: "internal_cost_center", header: "Internal Cost Center" },
  { key: "site", header: "Site" },
  { key: "site_id", header: "Site ID" },
  { key: "location_name", header: "Location Name" },
  { key: "vrf_name", header: "VRF Name" },
  { key: "vlan_id", header: "VLAN ID" },
  { key: "asn", header: "ASN" },
  { key: "routing_domain", header: "Routing Domain" },
  { key: "security_zone", header: "Security Zone" },
  { key: "gateway_ip", header: "Gateway IP" },
  { key: "dns_profile", header: "DNS Profile" },
  { key: "dhcp_scope", header: "DHCP Scope" },
  { key: "nat_policy", header: "NAT Policy" },
  { key: "qos_profile", header: "QoS Profile" },
  { key: "notes", header: "Notes" }
];

function activeAssignmentReportRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  return resources
    .filter((resource) => resource.administrativeStatus === "ASSIGNED" && resource.type === "Subnet")
    .map((resource) => {
      const assignment = resource.source && "customer_name" in resource.source ? resource.source : null;
      return {
        cidr: resource.cidr,
        start_ip: resource.startIp,
        end_ip: resource.endIp,
        total_ips: resource.totalIps,
        assignment_status: assignment?.status || resource.administrativeStatus,
        assignment_target_type: assignment?.assignment_target_type || "",
        owner: resource.owner,
        assigned_to: assignedToLabelForResource(resource),
        customer_name: assignment?.customer_name || resource.organizationName || resource.fullName || resource.owner,
        organization_name: assignment?.organization_name || resource.organizationName,
        customer_id: assignment?.customer_id || "",
        service_id: assignment?.service_id || resource.serviceId,
        service_instance_id: assignment?.service_instance_id || "",
        service_description: assignment?.service_description || resource.serviceDescription,
        customer_type: assignment?.customer_type || resource.customerType,
        subnet_type: assignment?.subnet_type || resource.subnetType,
        product_class: assignment?.product_class || resource.productClass,
        region_id: assignment?.region_id || resource.regionId,
        city_id: assignment?.city_id || resource.cityId,
        contact_name: assignment?.contact_name || resource.fullName,
        contact_number: assignment?.contact_number || resource.mobileNumber,
        contact_email: assignment?.contact_email || resource.email,
        transaction_id: resource.transactionId,
        cst_sync_status: resource.cstSyncStatus,
        ripe_sync_status: resource.ripeSyncStatus,
        assignment_date: assignment?.assignment_date || "",
        last_updated: resource.lastUpdated
      };
    });
}

function exportActiveAssignmentRows(rows: ResourceUtilizationRow[], format: "csv" | "xlsx") {
  const values = rows.map((row) => ACTIVE_ASSIGNMENT_COLUMNS.map((column) => row[column.key] ?? ""));
  if (format === "csv") {
    downloadBlob(`active-assignments-${today()}.csv`, "text/csv;charset=utf-8", buildColumnCsv(ACTIVE_ASSIGNMENT_COLUMNS, rows));
    return;
  }
  downloadBlob(
    `active-assignments-${today()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("Active Assignments", ACTIVE_ASSIGNMENT_COLUMNS.map((column) => column.header), values)
  );
}

function registryExportRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  return resources.map((resource) => ({
    transactionId: resource.transactionId,
    serviceProviderId: resource.serviceProviderId,
    ipSubnet: resource.cidr,
    owner: resource.owner,
    assignedTo: assignedToLabelForResource(resource),
    asn: resource.asn,
    ipVersion: 1,
    assignmentStatusId: resource.assignmentStatusId,
    serviceId: resource.serviceId,
    organizationName: resource.organizationName,
    organizationId: resource.organizationId,
    customerTypeId: resource.customerTypeId,
    customerType: resource.customerType,
    subnetType: resource.subnetType,
    productClass: resource.productClass,
    regionId: resource.regionId,
    cityId: resource.cityId,
    fullName: resource.fullName,
    mobileNumber: resource.mobileNumber,
    idNumber: resource.idNumber,
    email: resource.email,
    assignmentDate: resource.assignmentStatusId === 1 ? "" : resource.lastUpdated,
    updateDate: resource.lastUpdated,
    accessTechnologyId: resource.accessTechnologyId,
    accessTechnology: resource.accessTechnology,
    serviceDescription: resource.serviceDescription,
    description: resource.description,
    actionFlag: resource.actionFlag,
    cstSyncStatus: resource.cstSyncStatus,
    ripeSyncStatus: resource.ripeSyncStatus
  }));
}

function exportRegistryRows(rows: ResourceUtilizationRow[], format: "csv" | "xlsx") {
  const values = rows.map((row) => REGISTRY_EXPORT_COLUMNS.map((column) => row[column.key] ?? ""));
  if (format === "csv") {
    downloadBlob(`cst-lir-registry-${today()}.csv`, "text/csv;charset=utf-8", buildColumnCsv(REGISTRY_EXPORT_COLUMNS, rows));
    return;
  }
  downloadBlob(
    `cst-lir-registry-${today()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("CST LIR Registry", REGISTRY_EXPORT_COLUMNS.map((column) => column.header), values)
  );
}

function poolSummaryReportRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  const pools = resources.filter(isRegisteredSubnet);
  return pools.map((pool) => {
    const children = resources.filter((resource) => resource.parentId === pool.id);
    const freeChildren = children.filter((resource) => resource.administrativeStatus === "AVAILABLE");
    const largestFree = freeChildren.reduce<ManagedResource | null>((current, resource) => (!current || resource.totalIps > current.totalIps ? resource : current), null);
    const inUse = children
      .filter((resource) => resource.administrativeStatus === "ASSIGNED")
      .reduce((sum, resource) => sum + resource.totalIps, 0);
    const reserved = children
      .filter((resource) => resource.administrativeStatus === "RESERVED")
      .reduce((sum, resource) => sum + resource.totalIps, 0);
    const free = freeChildren.reduce((sum, resource) => sum + resource.totalIps, 0);
    const usedAndReserved = inUse + reserved;
    const usable = usableAddressCount(pool);
    const usagePercent = usable ? round2((usedAndReserved / usable) * 100) : 0;

    return {
      pool_name: pool.netname,
      allocation: pool.cidr,
      owner: pool.owner,
      assigned_to: assignedToLabelForResource(pool),
      total: pool.totalIps,
      usable,
      in_use: inUse,
      reserved,
      free,
      usage_percent: usagePercent,
      largest_free_cidr: largestFree ? `/${largestFree.prefix}` : "",
      status: poolSummaryStatus(pool, usedAndReserved, free)
    };
  });
}


function localAllocatedPoolUtilizationRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  return registryAllocatedPools(resources).map((pool) => ({
    pool_name: pool.netname,
    allocation: pool.cidr,
    resource_uuid: pool.uuid,
    classification: pool.classification,
    owner: pool.owner,
      assigned_to: assignedToLabelForResource(pool),
    total: pool.totalIps,
    usable: usableAddressCount(pool),
    in_use: pool.usedIps,
    reserved: pool.reservedIps,
    free: pool.freeIps,
    usage_percent: pool.utilization,
    status: pool.administrativeStatus,
    ripe_sync_status: pool.ripeSyncStatus,
    cst_sync_status: pool.cstSyncStatus,
    source_registry: pool.sourceRegistry,
    transaction_id: pool.transactionId,
    last_updated: pool.lastUpdated
  }));
}

function exportLocalAllocatedPoolUtilizationRows(rows: ResourceUtilizationRow[], format: "csv" | "xlsx") {
  const values = rows.map((row) => LOCAL_ALLOCATED_POOL_UTILIZATION_COLUMNS.map((column) => row[column.key] ?? ""));
  if (format === "csv") {
    downloadBlob(`local-allocated-pool-utilization-${today()}.csv`, "text/csv;charset=utf-8", buildColumnCsv(LOCAL_ALLOCATED_POOL_UTILIZATION_COLUMNS, rows));
    return;
  }
  downloadBlob(
    `local-allocated-pool-utilization-${today()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("Local Allocated Pool Utilization", LOCAL_ALLOCATED_POOL_UTILIZATION_COLUMNS.map((column) => column.header), values)
  );
}
function exportPoolSummary(resources: ManagedResource[], format: "csv" | "xlsx") {
  exportPoolSummaryRows(poolSummaryReportRows(resources), format);
}

function exportPoolSummaryRows(rows: ResourceUtilizationRow[], format: "csv" | "xlsx") {
  const values = rows.map((row) => POOL_SUMMARY_COLUMNS.map((column) => row[column.key] ?? ""));
  if (format === "csv") {
    downloadBlob(`subnet-summary-${today()}.csv`, "text/csv;charset=utf-8", buildColumnCsv(POOL_SUMMARY_COLUMNS, rows));
    return;
  }
  downloadBlob(
    `subnet-summary-${today()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("Subnet Summary", POOL_SUMMARY_COLUMNS.map((column) => column.header), values)
  );
}

function filterReportRows(rows: ResourceUtilizationRow[], filters: Record<string, string>, columns: Array<{ key: string; header: string }>) {
  const activeFilters = columns
    .map((column) => ({ key: column.key, value: (filters[column.key] ?? "").trim().toLowerCase() }))
    .filter((filter) => filter.value);
  if (!activeFilters.length) {
    return rows;
  }
  return rows.filter((row) => activeFilters.every((filter) => String(row[filter.key] ?? "").toLowerCase().includes(filter.value)));
}

function reportRowKey(row: ResourceUtilizationRow, index: number, scope: string) {
  return [
    scope,
    row.resource_id,
    row.resource_uuid,
    row.transactionId,
    row.allocation,
    row.ipSubnet,
    row.cidr,
    row.start_ip,
    row.end_ip,
    index
  ].filter((value) => value !== undefined && value !== null && value !== "").join("|");
}

function resourceUtilizationRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return resources.map((resource) => {
    const parent = resource.parentId ? byId.get(resource.parentId) : null;
    const pool = resource.source && !("customer_name" in resource.source) ? resource.source : null;
    const assignment = resource.source && "customer_name" in resource.source ? resource.source : null;

    return {
      resource_id: resource.id,
      resource_uuid: resource.uuid,
      parent_resource_id: resource.parentId,
      parent_cidr: parent?.cidr ?? "",
      cidr: resource.cidr,
      prefix_length: resource.prefix,
      start_ip: resource.startIp,
      end_ip: resource.endIp,
      start_number: resource.startNumber,
      end_number: resource.endNumber,
      total_ips: resource.totalIps,
      used_ips: resource.usedIps,
      reserved_ips: resource.reservedIps,
      free_ips: resource.freeIps,
      utilization_percent: resource.utilization,
      resource_type: resource.type,
      resource_role: resource.role,
      classification: resource.classification,
      administrative_status: resource.administrativeStatus,
      ripe_sync_required: resource.ripeSyncRequired ? "Yes" : "No",
      ripe_sync_status: resource.ripeSyncStatus,
      owner: resource.owner,
      assigned_to: assignedToLabelForResource(resource),
      netname: resource.netname,
      description: resource.description,
      country: resource.country,
      maintainer: resource.maintainer,
      transaction_id: resource.transactionId,
      source_registry: resource.sourceRegistry,
      last_updated: resource.lastUpdated,
      previous_uuid: resource.previousUuid,
      source_uuid: resource.sourceUuid,
      successor_uuid: resource.successorUuid,
      operation_type: resource.operationType,
      source_record_type: pool ? "Registered Subnet" : assignment ? "Assignment" : "Calculated",
      source_record_id: pool?.id ?? assignment?.id ?? "",
      pool_name: pool?.name ?? parent?.netname ?? "",
      pool_region: pool?.region ?? "",
      pool_category: pool?.category ?? "",
      pool_lifecycle_state: pool?.lifecycle_state ?? "",
      pool_operational_state: pool?.operational_state ?? "",
      pool_usage_state: pool?.usage_state ?? "",
      pool_vrf_name: pool?.vrf_name ?? "",
      pool_site_name: pool?.site_name ?? "",
      assignment_target_type: assignment?.assignment_target_type ?? "",
      assignment_name: assignment?.assignment_name ?? "",
      assignment_status: assignment?.status ?? resource.administrativeStatus,
      organization_name: assignment?.organization_name ?? resource.organizationName,
      organization_id: assignment?.organization_id ?? resource.organizationId,
      service_id: assignment?.service_id ?? resource.serviceId,
      service_description: assignment?.service_description ?? resource.serviceDescription,
      assignment_date: assignment?.assignment_date ?? "",
      assignment_purpose: assignment?.assignment_purpose ?? "",
      service_specification_id: assignment?.service_specification_id ?? "",
      service_specification_name: assignment?.service_specification_name ?? "",
      service_instance_id: assignment?.service_instance_id ?? "",
      service_instance_name: assignment?.service_instance_name ?? "",
      service_type: assignment?.service_type ?? "",
      service_category: assignment?.service_category ?? "",
      l3_service: assignment?.l3_service ?? "",
      service: assignment?.service ?? "",
      customer_id: assignment?.customer_id ?? resource.organizationId,
      customer_name: assignment?.customer_name ?? resource.organizationName ?? resource.fullName ?? "",
      customer_type: assignment?.customer_type ?? resource.customerType ?? "NA",
      subnet_type: assignment?.subnet_type ?? resource.subnetType ?? "NA",
      product_class: assignment?.product_class ?? resource.productClass ?? "",
      customer_account_id: assignment?.customer_account_id ?? "",
      customer_segment: assignment?.customer_segment ?? "",
      commercial_reg_id: assignment?.commercial_reg_id ?? "",
      unified_number: assignment?.unified_number ?? "",
      contact_name: assignment?.contact_name ?? resource.fullName,
      contact_number: assignment?.contact_number ?? resource.mobileNumber,
      contact_email: assignment?.contact_email ?? resource.email,
      city: assignment?.city ?? "",
      region_id: assignment?.region_id ?? resource.regionId,
      city_id: assignment?.city_id ?? resource.cityId,
      region: assignment?.region ?? "",
      internal_business_unit: assignment?.internal_business_unit ?? "",
      internal_application_id: assignment?.internal_application_id ?? "",
      internal_application_name: assignment?.internal_application_name ?? "",
      internal_environment: assignment?.internal_environment ?? "",
      internal_owner_team: assignment?.internal_owner_team ?? "",
      internal_cost_center: assignment?.internal_cost_center ?? "",
      site: assignment?.site ?? pool?.site_name ?? "",
      site_id: assignment?.site_id ?? pool?.site_id ?? "",
      location_name: assignment?.location_name ?? pool?.location_name ?? "",
      vrf_name: assignment?.vrf_name ?? pool?.vrf_name ?? "",
      vlan_id: assignment?.vlan_id ?? pool?.vlan_id ?? "",
      asn: assignment?.asn ?? pool?.asn ?? "",
      routing_domain: assignment?.routing_domain ?? "",
      security_zone: assignment?.security_zone ?? pool?.security_zone ?? "",
      gateway_ip: assignment?.gateway_ip ?? "",
      dns_profile: assignment?.dns_profile ?? "",
      dhcp_scope: assignment?.dhcp_scope ?? "",
      nat_policy: assignment?.nat_policy ?? "",
      qos_profile: assignment?.qos_profile ?? "",
      notes: assignment?.notes ?? pool?.tags ?? ""
    };
  });
}

function isCstSyncedReportRow(row: ResourceUtilizationRow) {
  return ["SUCCESS", "SYNCHRONIZED", "SYNCED", "CST SYNCED"].includes(String(row.cst_sync_status ?? "").trim().toUpperCase());
}

function reportCellNumber(value: ExportCell) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumReportCellNumbers(rows: ResourceUtilizationRow[], key: string) {
  return rows.reduce((total, row) => total + reportCellNumber(row[key]), 0);
}

function formatReportNumber(value: number) {
  return value.toLocaleString("en-US");
}

function exportAllIpRows(rows: ResourceUtilizationRow[], format: "csv" | "xlsx") {
  const date = today();
  if (format === "csv") {
    downloadBlob(`all-ips-${date}.csv`, "text/csv;charset=utf-8", buildColumnCsv(ALL_IP_REPORT_COLUMNS, rows));
    return;
  }
  downloadBlob(
    `all-ips-${date}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("All IPs", ALL_IP_REPORT_COLUMNS.map((column) => column.header), rows.map((row) => ALL_IP_REPORT_COLUMNS.map((column) => row[column.key] ?? "")))
  );
}

function exportResourceUtilization(resources: ManagedResource[], format: "csv" | "xlsx") {
  exportAllIpRows(resourceUtilizationRows(resources), format);
}

function exportGlobalSearchResults(resources: ManagedResource[]) {
  downloadBlob(`global-search-results-${today()}.csv`, "text/csv;charset=utf-8", buildCsv(resourceUtilizationRows(resources)));
}

const RIPE_DISCOVERY_EXPORT_COLUMNS: Array<{ key: keyof RipeDiscoveredRootPool; header: string }> = [
  { key: "pool_name", header: "pool_name" },
  { key: "allocation_range", header: "allocation_range" },
  { key: "cidr", header: "cidr" },
  { key: "total_ips", header: "total_ips" },
  { key: "ripe_maintainer", header: "ripe_maintainer" },
  { key: "ripe_status", header: "ripe_status" },
  { key: "source", header: "source" },
  { key: "local_sync_status", header: "local_sync_status" },
  { key: "cst_sync_status", header: "cst_sync_status" },
  { key: "last_sync_date", header: "last_sync_date" }
];

function exportRipeDiscoveryRows(rows: RipeDiscoveredRootPool[], format: "csv" | "xlsx") {
  const date = today();
  const headers = RIPE_DISCOVERY_EXPORT_COLUMNS.map((column) => column.header);
  const values = rows.map((row) => RIPE_DISCOVERY_EXPORT_COLUMNS.map((column) => row[column.key] ?? ""));
  if (format === "csv") {
    downloadBlob(`ripe-ip-pools-discovery-${date}.csv`, "text/csv;charset=utf-8", buildSimpleCsv(headers, values));
    return;
  }
  downloadBlob(
    `ripe-ip-pools-discovery-${date}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("RIPE Pools Discovery", headers, values)
  );
}

function normalizePoolImportCsv(csvText: string) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    throw new Error("CSV file is empty.");
  }
  const firstRow = rows[0];
  if ("cidr" in normalizeCsvRecord(firstRow)) {
    return csvText;
  }
  if (!("startip" in normalizeCsvRecord(firstRow)) && !("endip" in normalizeCsvRecord(firstRow)) && !("total" in normalizeCsvRecord(firstRow))) {
    throw new Error("Subnet import requires either cidr,name,region or StartIP,EndIP,Total headers.");
  }

  const converted: ResourceUtilizationRow[] = [];
  rows.forEach((row, index) => {
    const normalized = normalizeCsvRecord(row);
    const startIp = normalized.startip || normalized.start_ip || normalized.start;
    const endIp = normalized.endip || normalized.end_ip || normalized.end;
    const totalText = normalized.total;
    const maintainer = normalized.maintainer || normalized.ripe_maintainer || normalized["mnt-by"] || normalized.mnt_by || normalized.owner || "ITC-NOC-MNT";
    const description = normalized.description || normalized.descr || "";
    if (!startIp || !endIp || !totalText) {
      throw new Error(`row ${index + 2}: StartIP, EndIP, and Total are required.`);
    }
    const start = ipToNumber(startIp);
    const end = ipToNumber(endIp);
    if (start > end) {
      throw new Error(`row ${index + 2}: StartIP must be less than or equal to EndIP.`);
    }
    const expectedTotal = Number.parseInt(totalText, 10);
    const actualTotal = end - start + 1;
    if (!Number.isInteger(expectedTotal) || expectedTotal <= 0) {
      throw new Error(`row ${index + 2}: Total must be a positive whole number.`);
    }
    if (expectedTotal !== actualTotal) {
      throw new Error(`row ${index + 2}: Total ${expectedTotal} does not match StartIP-EndIP size ${actualTotal}.`);
    }
    for (const block of rangeToCidrs(start, end)) {
      converted.push({
        cidr: block.cidr,
        name: normalized.name || `Bulk range ${startIp}-${endIp}`,
        region: normalized.region || "Unassigned region",
        maintainer,
        description
      });
    }
  });

  return buildSimpleCsv(
    ["cidr", "name", "region", "maintainer", "description"],
    converted.map((row) => [row.cidr, row.name, row.region, row.maintainer, row.description])
  );
}

function normalizeAssignmentImportCsv(csvText: string) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) {
    throw new Error("CSV file is empty.");
  }
  const firstRow = normalizeCsvRecord(rows[0]);
  const hasCidr = "cidr" in firstRow;
  const hasRange = "startip" in firstRow || "start_ip" in firstRow || "start" in firstRow || "endip" in firstRow || "end_ip" in firstRow || "end" in firstRow;
  if (!hasCidr && !hasRange) {
    throw new Error("Assignment import requires either cidr or startIp/endIp/size headers plus CST assignment fields.");
  }
  const valueOf = (row: Record<string, string>, ...keys: string[]) => keys.map((key) => row[key.toLowerCase()]).find((value) => value && value.trim())?.trim() ?? "";
  const requireFields = (row: Record<string, string>, rowNumber: number, fields: Array<[string, string[]]>) => {
    fields.forEach(([label, aliases]) => {
      if (!valueOf(row, ...aliases)) {
        throw new Error(`row ${rowNumber}: ${label} is required.`);
      }
    });
  };

  rows.forEach((row, index) => {
    const normalized = normalizeCsvRecord(row);
    const rowNumber = index + 2;
    const cidr = normalized.cidr;
    const startIp = normalized.startip || normalized.start_ip || normalized.start;
    const endIp = normalized.endip || normalized.end_ip || normalized.end;
    const sizeText = normalized.size || normalized.total;
    const status = normalized.status;
    const assignmentDate = normalized.assignmentdate || normalized.assignment_date;
    const assignmentType = (normalized.assignmenttype || normalized.assignment_type || (status === "2" ? "INTERNAL" : "BUSINESS")).toUpperCase();

    if (!assignmentDate) {
      throw new Error(`row ${rowNumber}: assignmentDate is required.`);
    }
    if (!["BUSINESS", "INTERNAL"].includes(assignmentType)) {
      throw new Error(`row ${rowNumber}: assignmentType must be BUSINESS or INTERNAL.`);
    }
    if (status && !["2", "3"].includes(status)) {
      throw new Error(`row ${rowNumber}: status must be 2 (Internal) or 3 (Business) for CST migration import.`);
    }
    if (assignmentType === "BUSINESS") {
      requireFields(normalized, rowNumber, [
        ["serviceId", ["serviceid", "service_id"]],
        ["customerId", ["customerid", "customer_id", "bsscustomerid", "bss_customer_id"]],
        ["organizationName", ["organizationname", "organization_name", "customername", "customer_name"]],
        ["organizationId/commercialRegId/unifiedNumber/customerId", ["organizationid", "organization_id", "commercialregid", "commercial_reg_id", "unifiednumber", "unified_number", "customerid", "customer_id", "bsscustomerid", "bss_customer_id"]],
        ["customerTypeId", ["customertypeid", "customer_type_id"]],
        ["regionId/region", ["regionid", "region_id", "region"]],
        ["fullName/contactName", ["fullname", "full_name", "contactname", "contact_name"]],
        ["mobileNumber/contactNumber", ["mobilenumber", "mobile_number", "contactnumber", "contact_number"]],
        ["idNumber", ["idnumber", "id_number", "customeridentity", "customer_identity"]],
        ["email/contactEmail", ["email", "contactemail", "contact_email"]]
      ]);
    }
    if (assignmentType === "INTERNAL") {
      requireFields(normalized, rowNumber, [
        ["serviceDescription", ["servicedescription", "service_description", "service"]]
      ]);
    }
    if (cidr) {
      const range = parseCidr(cidr);
      if (sizeText) {
        const expectedSize = Number.parseInt(sizeText, 10);
        if (!Number.isInteger(expectedSize) || expectedSize <= 0) {
          throw new Error(`row ${rowNumber}: size must be a positive whole number.`);
        }
        if (expectedSize !== range.size) {
          throw new Error(`row ${rowNumber}: size ${expectedSize} does not match CIDR size ${range.size}.`);
        }
      }
      return;
    }
    if (!startIp || !endIp || !sizeText) {
      throw new Error(`row ${rowNumber}: startIp, endIp, and size are required for start-end assignment import.`);
    }
    const start = ipToNumber(startIp);
    const end = ipToNumber(endIp);
    if (start > end) {
      throw new Error(`row ${rowNumber}: startIp must be less than or equal to endIp.`);
    }
    const expectedSize = Number.parseInt(sizeText, 10);
    const actualSize = end - start + 1;
    if (!Number.isInteger(expectedSize) || expectedSize <= 0) {
      throw new Error(`row ${rowNumber}: size must be a positive whole number.`);
    }
    if (expectedSize !== actualSize) {
      throw new Error(`row ${rowNumber}: size ${expectedSize} does not match startIp-endIp count ${actualSize}.`);
    }
  });

  return csvText;
}

function parseCsvRows(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [headers[index] ?? `column_${index}`, value.trim()])));
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index + 1] === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function normalizeCsvRecord(row: Record<string, string>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]));
}

function buildSimpleCsv(headers: string[], rows: ExportCell[][]) {
  return [headers.map(escapeCsvCell).join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\r\n");
}

function buildCsv(rows: ResourceUtilizationRow[]) {
  return buildColumnCsv(RESOURCE_UTILIZATION_COLUMNS, rows);
}

function ripeAssignmentColumns(rows: Array<Record<string, string | number>>) {
  const preferred = ["cidr", "inetnum", "netname", "country", "status", "mnt-by", "descr", "source", "object_type", "object_source", "object_href"];
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  return [...preferred.filter((key) => keys.has(key)), ...Array.from(keys).filter((key) => !preferred.includes(key)).sort()];
}

function buildRipeAssignmentCsv(rows: Array<Record<string, string | number>>) {
  const columns = ripeAssignmentColumns(rows);
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column] ?? "")).join(","));
  return [header, ...body].join("\r\n");
}

function exportRipeAssignmentRows(rows: Array<Record<string, string | number>>, reportType = "RIPE Assignment Report") {
  const slug = reportType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "ripe-report";
  downloadBlob(`${slug}-${today()}.csv`, "text/csv;charset=utf-8", buildRipeAssignmentCsv(rows));
}

function buildColumnCsv(columns: Array<{ key: string; header: string }>, rows: ResourceUtilizationRow[]) {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column.key] ?? "")).join(","));
  return [header, ...body].join("\r\n");
}

function escapeCsvCell(value: ExportCell) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function downloadBlob(filename: string, type: string, content: string | BlobPart) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildXlsx(sheetName: string, headers: string[], rows: ExportCell[][]) {
  const worksheetRows = [headers, ...rows];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheetRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => xlsxCell(columnIndex, rowIndex, cell)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zipFiles([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml }
  ]);
}

function xlsxCell(columnIndex: number, rowIndex: number, value: ExportCell) {
  const ref = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
}

function xlsxColumnName(index: number) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function zipFiles(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = zipHeader(0x04034b50, [20, 0, 0, 0, 0], crc, data.length, data.length, nameBytes.length, 0);
    localParts.push(localHeader, nameBytes, data);
    const centralHeader = zipHeader(0x02014b50, [0x0314, 20, 0, 0, 0, 0], crc, data.length, data.length, nameBytes.length, 0, 0, 0, 0, 0, offset);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipEnd(files.length, centralSize, offset);
  return new Blob([...localParts, ...centralParts, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function zipHeader(signature: number, values: number[], crc: number, compressedSize: number, size: number, nameLength: number, extraLength: number, commentLength = 0, disk = 0, attributes = 0, externalAttributes = 0, offset = 0) {
  const bytes: number[] = [];
  push32(bytes, signature);
  for (const value of values) {
    push16(bytes, value);
  }
  push32(bytes, crc);
  push32(bytes, compressedSize);
  push32(bytes, size);
  push16(bytes, nameLength);
  push16(bytes, extraLength);
  if (signature === 0x02014b50) {
    push16(bytes, commentLength);
    push16(bytes, disk);
    push16(bytes, attributes);
    push32(bytes, externalAttributes);
    push32(bytes, offset);
  }
  return new Uint8Array(bytes);
}

function zipEnd(fileCount: number, centralSize: number, centralOffset: number) {
  const bytes: number[] = [];
  push32(bytes, 0x06054b50);
  push16(bytes, 0);
  push16(bytes, 0);
  push16(bytes, fileCount);
  push16(bytes, fileCount);
  push32(bytes, centralSize);
  push32(bytes, centralOffset);
  push16(bytes, 0);
  return new Uint8Array(bytes);
}

function push16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function push32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function resourceUuid(kind: string, id: string, cidr: string) {
  if (kind !== "free" && isUuid(id)) {
    return id;
  }
  return stableUuid(`${kind}:${id}:${cidr}`);
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stableUuid(input: string) {
  let hash1 = 0x811c9dc5;
  let hash2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 0x01000193) >>> 0;
    hash2 = Math.imul(hash2 ^ code, 0x85ebca6b) >>> 0;
  }
  const hex = [
    hash1.toString(16).padStart(8, "0"),
    hash2.toString(16).padStart(8, "0"),
    (hash1 ^ hash2).toString(16).padStart(8, "0"),
    Math.imul(hash1, hash2).toString(16).padStart(8, "0")
  ].join("").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function detectIntegrityIssues(resources: ManagedResource[]) {
  const issues: Array<{ severity: "Major" | "Minor"; title: string; detail: string }> = [];
  const persistedResources = resources.filter((resource) => resource.operationType !== "CALCULATED_FREE_SPACE");
  const ids = new Set(persistedResources.map((resource) => resource.id));
  const orphan = persistedResources.find((resource) => resource.parentId && !ids.has(resource.parentId));
  if (orphan) {
    issues.push({ severity: "Major", title: "Orphan resource detected", detail: `${orphan.cidr} references missing parent ${orphan.parentId}.` });
  }
  const duplicate = persistedResources.find((resource, index) => persistedResources.findIndex((item) => item.cidr === resource.cidr && item.type === resource.type) !== index);
  if (duplicate) {
    issues.push({ severity: "Minor", title: "Duplicate resource representation", detail: `${duplicate.cidr} appears more than once for type ${duplicate.type}.` });
  }
  return issues;
}

function normalizeCstSyncStatus(value: string | undefined | null): CstSyncStatus {
  const normalized = String(value || "PENDING").trim().toUpperCase();
  return CST_SYNC_STATUS_OPTIONS.includes(normalized as CstSyncStatus) ? normalized as CstSyncStatus : "PENDING";
}

function assignedToLabelForStatus(statusId: number | string | null | undefined, targetType: string | null | undefined = "") {
  const normalizedTarget = String(targetType || "").toLowerCase();
  const parsedStatus = Number(statusId || 0);
  if (parsedStatus === 3 || normalizedTarget === "business_customer") {
    return "Business";
  }
  if (parsedStatus === 2 || normalizedTarget === "internal") {
    return "Internal";
  }
  if (parsedStatus === 4 || normalizedTarget === "individual") {
    return "Individual";
  }
  return "Unassigned";
}

function assignedToLabelForAssignment(assignment: Assignment) {
  return assignedToLabelForStatus(assignment.assignment_status_id, assignment.assignment_target_type);
}

function assignedToLabelForResource(resource: ManagedResource) {
  return assignedToLabelForStatus(resource.assignmentStatusId);
}

function assignmentDisplayName(assignment: Assignment) {
  const assignedTo = assignedToLabelForAssignment(assignment);
  if (assignedTo === "Internal") {
    return assignment.service_description || assignment.internal_application_name || assignment.service || assignment.assignment_purpose || assignment.assignment_name || "Internal";
  }
  if (assignedTo === "Business") {
    return assignment.organization_name || assignment.customer_name || assignment.service_description || assignment.service || "Business";
  }
  if (assignedTo === "Individual") {
    return assignment.full_name || assignment.customer_name || "Individual";
  }
  return assignment.service_description || assignment.assignment_name || "Unassigned";
}

function resourceDisplayName(resource: ManagedResource) {
  const assignedTo = assignedToLabelForResource(resource);
  if (assignedTo === "Internal") {
    return resource.serviceDescription || resource.netname || resource.description || "Internal";
  }
  if (assignedTo === "Business") {
    return resource.organizationName || assignedResourceCustomerLabel(resource) || resource.netname || resource.description || "Business";
  }
  if (assignedTo === "Individual") {
    return resource.fullName || assignedResourceCustomerLabel(resource) || "Individual";
  }
  return resource.netname || resource.description || "Unassigned";
}
function assignmentOwner(assignment: Assignment): ResourceOwner | string {
  if (assignment.assignment_target_type === "internal") {
    return assignment.owner || assignment.internal_business_unit || "Internal";
  }
  if (assignmentIsIndividual(assignment)) {
    return "Individual customer";
  }
  return assignment.customer_name ? "Business Customer" : "Business Customer";
}

function assignmentIsIndividual(assignment: Assignment) {
  return assignment.assignment_status_id === 4 || assignment.assignment_target_type === "individual" || assignment.customer_type?.toLowerCase() === "individual";
}

function assignmentReleasedAfterRipeRemoval(assignment: Assignment) {
  return (
    assignment.status === "Retiring" &&
    assignment.action_flag === "D" &&
    ["SUCCESS", "SYNCHRONIZED"].includes(String(assignment.ripe_sync_status || "").toUpperCase())
  );
}

function assignmentStatusIdFromAssignment(assignment: Assignment) {
  if (assignment.assignment_status_id) {
    return assignment.assignment_status_id;
  }
  if (assignment.assignment_target_type === "internal") {
    return 2;
  }
  if (assignment.customer_type?.toLowerCase() === "individual") {
    return 4;
  }
  return 3;
}

function assignmentToAdministrativeStatus(assignment: Assignment): AdministrativeStatus {
  if (assignment.status === "Reserved" || assignment.status === "Planned") {
    return "RESERVED";
  }
  if (assignment.status === "Retiring") {
    return "RETIRED";
  }
  return "ASSIGNED";
}

function usableAddressCount(resource: ManagedResource) {
  return resource.prefix >= 31 ? resource.totalIps : Math.max(0, resource.totalIps - 2);
}

function poolSummaryStatus(pool: ManagedResource, usedAndReserved: number, free: number) {
  if (pool.administrativeStatus === "RETIRED" || pool.administrativeStatus === "HISTORICAL") {
    return pool.administrativeStatus === "RETIRED" ? "Retired" : "Historical";
  }
  if (usedAndReserved <= 0) {
    return "Available";
  }
  if (free <= 0) {
    return "Full";
  }
  return "Partially Used";
}

function poolAdministrativeStatus(pool: Pool): AdministrativeStatus {
  const normalized = String(pool.resource_status || pool.lifecycle_state || "").toUpperCase();
  if (normalized === "RESERVED" || normalized === "ASSIGNED" || normalized === "RETIRED" || normalized === "HISTORICAL") {
    return normalized;
  }
  return "AVAILABLE";
}

function classifyCidr(cidr: string): ResourceRole {
  try {
    const range = toRange(cidr);
    const privateRanges = [toRange("10.0.0.0/8"), toRange("172.16.0.0/12"), toRange("192.168.0.0/16")];
    return privateRanges.some((privateRange) => contains(privateRange, range)) ? "PRIVATE" : "PUBLIC";
  } catch {
    return "PUBLIC";
  }
}

function ripeStatusForAssignment(assignment: Assignment, required: boolean): RipeSyncStatus {
  if (!required) {
    return "EXCLUDED";
  }
  const normalized = String(assignment.ripe_sync_status || "PENDING").toUpperCase();
  if (assignment.status === "Retiring") {
    if ((normalized === "SUCCESS" || normalized === "SYNCHRONIZED") && assignment.action_flag === "D") {
      return "SUCCESS";
    }
    if (normalized === "FAILED" && assignment.action_flag === "D") {
      return "FAILED";
    }
    if (normalized === "SUCCESS" || normalized === "SYNCHRONIZED" || normalized === "DECOMMISSION_PENDING") {
      return "DECOMMISSION_PENDING";
    }
    return "NOT_REQUIRED";
  }
  if (normalized === "SUCCESS" || normalized === "SYNCHRONIZED") {
    return "SUCCESS";
  }
  if (normalized === "FAILED") {
    return "FAILED";
  }
  if (normalized === "SUBMITTED") {
    return "SUBMITTED";
  }
  if (normalized === "DECOMMISSION_PENDING") {
    return "DECOMMISSION_PENDING";
  }
  if (normalized === "NOT_REQUIRED") {
    return "NOT_REQUIRED";
  }
  if (normalized === "EXCLUDED") {
    return "EXCLUDED";
  }
  return "PENDING";
}

function isRipePushEligible(resource: ManagedResource) {
  const pendingRemoval = resource.operationType === "RETIRE" || resource.ripeSyncStatus === "DECOMMISSION_PENDING";
  return (
    resource.type === "Subnet" &&
    (resource.administrativeStatus === "ASSIGNED" || pendingRemoval) &&
    resource.classification === "PUBLIC" &&
    resource.ripeSyncRequired &&
    !["SUCCESS", "SYNCHRONIZED", "EXCLUDED", "NOT_REQUIRED"].includes(resource.ripeSyncStatus)
  );
}

function ripeStatusLabel(status: RipeSyncStatus) {
  if (status === "SUCCESS" || status === "SYNCHRONIZED") {
    return "SYNCED";
  }
  if (status === "FAILED") {
    return "FAILED";
  }
  if (status === "SUBMITTED") {
    return "SUBMITTED";
  }
  if (status === "DECOMMISSION_PENDING") {
    return "REMOVAL PENDING";
  }
  if (status === "NOT_REQUIRED") {
    return "NOT REQUIRED";
  }
  if (status === "EXCLUDED") {
    return "EXCLUDED";
  }
  return "NOT SYNCED";
}

function ripeBadgeVariant(status: RipeSyncStatus) {
  if (status === "SUCCESS" || status === "SYNCHRONIZED") {
    return "success" as const;
  }
  if (status === "FAILED") {
    return "danger" as const;
  }
  if (status === "PENDING" || status === "SUBMITTED" || status === "DECOMMISSION_PENDING") {
    return "warning" as const;
  }
  return "muted" as const;
}

function badgeForResource(resource: ManagedResource) {
  if (resource.ripeSyncStatus === "FAILED") {
    return "danger" as const;
  }
  if (resource.administrativeStatus === "RESERVED" || resource.ripeSyncStatus === "PENDING" || resource.ripeSyncStatus === "DECOMMISSION_PENDING") {
    return "warning" as const;
  }
  if (resource.administrativeStatus === "AVAILABLE" || resource.administrativeStatus === "ASSIGNED" || resource.ripeSyncStatus === "SYNCHRONIZED") {
    return "success" as const;
  }
  return "default" as const;
}

function badgeForStatus(status: ExportCell) {
  if (status === "RESERVED") {
    return "warning" as const;
  }
  if (status === "AVAILABLE" || status === "ASSIGNED") {
    return "success" as const;
  }
  if (status === "RETIRED" || status === "HISTORICAL") {
    return "muted" as const;
  }
  return "default" as const;
}

function badgeForPoolSummaryStatus(status: ExportCell) {
  if (status === "Available") {
    return "success" as const;
  }
  if (status === "Partially Used") {
    return "warning" as const;
  }
  if (status === "Full") {
    return "danger" as const;
  }
  return "default" as const;
}

function statusToAssignmentStatus(status: AdministrativeStatus): AssignmentStatus {
  if (status === "RESERVED") {
    return "Reserved";
  }
  if (status === "RETIRED") {
    return "Retiring";
  }
  return "Active";
}

function resourceTypeMix(resources: ManagedResource[]) {
  const colors: Record<ResourceType, string> = {
    LIR: "#14b8a6",
    Allocation: "#0ea5e9",
    Subnet: "#22c55e",
    "IP Address": "#f59e0b"
  };
  return Object.entries(resources.reduce<Record<string, number>>((acc, resource) => {
    acc[resource.type] = (acc[resource.type] ?? 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value, color: colors[name as ResourceType] ?? "#94a3b8" }));
}

function lifecycleStateMix(resources: ManagedResource[]) {
  return lifecycleStates.map((state) => ({
    name: state,
    value: resources.filter((resource) => resource.administrativeStatus === state).length
  }));
}

function addMonths(months: number) {
  if (!months) {
    return "Exhausted";
  }
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function alertBulk(label: string, result: BulkResult) {
  window.alert(`${label}: ${result.imported} imported, ${result.blocked} blocked${result.errors.length ? `\n${result.errors.join("\n")}` : ""}`);
}

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    return typeof detail === "string" ? detail : error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}


















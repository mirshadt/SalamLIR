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
  BulkBatch,
  BulkResult,
  Conflict,
  getAssignments,
  getAuditEvents,
  getBulkBatches,
  getConflicts,
  getPools,
  getRipeAllocatedPools,
  getRipeConfig,
  getRipeReportPools,
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
  classification: ResourceRole;
  owner: ResourceOwner | string;
  status: AdministrativeStatus;
  administrativeStatus: AdministrativeStatus;
  ripeSyncRequired: boolean;
  ripeSyncStatus: RipeSyncStatus;
  cstSyncStatus: RipeSyncStatus;
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
  | "administrativeStatus"
  | "ripeSyncStatus"
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
  { value: "administrativeStatus", label: "Status", mode: "select" },
  { value: "ripeSyncStatus", label: "RIPE Status", mode: "select" },
  { value: "transactionId", label: "Transaction ID", mode: "text" },
  { value: "netname", label: "Netname", mode: "text" },
  { value: "description", label: "Description", mode: "text" }
];

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
const ripeReportTypes = ["RIPE Assignment Report", "RIPE Maintainer IP Report"];
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
  customer_type: "Enterprise",
  customer_segment: "Enterprise",
  l3_service: "MPLS L3VPN",
  service: "Business IP assignment",
  service_description: "Business IP assignment pending BSS sync"
};

const businessBssFields: AssignmentFieldDefinition[] = [
  { key: "service_id", label: "serviceId", placeholder: "BSS service identifier", required: true },
  { key: "customer_type_id", label: "customerTypeId", placeholder: "Select customer type", required: true, options: customerTypeOptions },
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
  product_specification_id: "",
  product_specification_name: "",
  product_offering_id: "",
  product_offering_name: "",
  customer_id: "",
  customer_name: "",
  customer_type: "Enterprise",
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
        onUsername={setUsername}
        onPassword={setPassword}
        onKeycloakLogin={() => beginKeycloakLogin().catch((error) => setMessage(`Keycloak login failed: ${errorMessage(error)}`))}
        onSubmit={async () => {
          try {
            const result = await login(username.trim(), password);
            window.localStorage.setItem("ipam-token", result.token);
            window.localStorage.setItem("ipam-username", result.username);
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
      onLogout={() => {
        const provider = window.localStorage.getItem("ipam-auth-provider");
        window.localStorage.removeItem("ipam-token");
        window.localStorage.removeItem("ipam-refresh-token");
        window.localStorage.removeItem("ipam-username");
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

function LoginScreen(props: {
  username: string;
  password: string;
  message: string;
  keycloakEnabled: boolean;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  onKeycloakLogin: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src="/salam-favicon.png" alt="Salam" className="h-16 w-16 rounded-md object-contain" />
          <img src="/salam-logo-white.png" alt="Salam" className="h-10 w-44 object-contain" />
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
          <Input name="ipam-application-password" autoComplete="current-password" value={props.password} onChange={(event) => props.onPassword(event.target.value)} placeholder="Application password" type="password" />
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

function RegistryWorkspace({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewKey>("executive");
  const [routeReady, setRouteReady] = useState(false);
  const [signedInUser, setSignedInUser] = useState("admin");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchFilters, setGlobalSearchFilters] = useState<SearchFilterCriterion[]>([]);
  const [poolForm, setPoolForm] = useState({ cidr: "5.42.224.0/19", name: "Salam IPv4 Allocation", region: "Riyadh", description: "Authoritative LIR parent allocation" });
  const [assignmentForm, setAssignmentForm] = useState<AssignmentPayload>({ ...emptyAssignment, cidr: "", customer_name: "", assignment_date: today() });
  const [poolAssignmentDraft, setPoolAssignmentDraft] = useState<PoolAssignmentDraft>({ selectionMode: "subnet", parentPoolId: "", poolSearch: "", startIp: "", endIp: "", prefix: "24" });
  const [reservationForm, setReservationForm] = useState({ cidr: "5.42.225.0/24", purpose: "Enterprise Expansion", requestedBy: "", expiryDate: "", notes: "" });
  const [splitForm, setSplitForm] = useState({ poolId: "", search: "", prefix: "24", direction: "start" as PartitionDirection });
  const [mergeForm, setMergeForm] = useState({ leftPoolId: "", rightPoolId: "", leftSearch: "", rightSearch: "" });
  const [bulkPoolCsv, setBulkPoolCsv] = useState("StartIP,EndIP,Total\n5.42.224.0,5.42.255.255,8192");
  const [bulkAssignmentCsv, setBulkAssignmentCsv] = useState("cidr,size,status,assignmentDate,customerName,serviceId,serviceDescription\n5.42.224.0/24,256,3,2026-06-03,Example Enterprise,SVC-10001,Enterprise L3 service");
  const [ripeConfigForm, setRipeConfigForm] = useState<RipeConfigPayload>({ base_url: "https://rest.db.ripe.net", auth_type: "Basic Authentication", username: "", password: "", connection_timeout: 10, read_timeout: 30, default_maintainer: "ITC-NOC-MNT" });
  const [ripePoolCsv, setRipePoolCsv] = useState("pool_name,cidr,allocation_type,source,created_date\nRIPE Allocation 5.42.224.0,5.42.224.0/19,RIPE Allocated Pool,RIPE Database,2026-06-01");
  const [ripeReportForm, setRipeReportForm] = useState({ poolId: "", dateFrom: "", dateTo: "", reportType: "RIPE Assignment Report" });
  const [ripeReportResult, setRipeReportResult] = useState<RipeReportResponse | null>(null);
  const [ripeDiscoveryResult, setRipeDiscoveryResult] = useState<RipeDiscoveryResponse | null>(null);
  const [ripeDiscoveryStatus, setRipeDiscoveryStatus] = useState<"idle" | "running" | "complete">("idle");
  const [bulkPoolFileName, setBulkPoolFileName] = useState("");
  const [bulkAssignmentFileName, setBulkAssignmentFileName] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "operator" as User["role"] });
  const [passwordReset, setPasswordReset] = useState({ userId: "", password: "" });
  const [confirm, setConfirm] = useState<{ title: string; detail: string; action: () => void; destructive?: boolean } | null>(null);
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null);

  const liveQueryOptions = { staleTime: 0, refetchOnMount: "always" as const, refetchOnWindowFocus: true };
  const poolsQuery = useQuery({ queryKey: ["pools"], queryFn: getPools, ...liveQueryOptions });
  const assignmentsQuery = useQuery({ queryKey: ["assignments"], queryFn: getAssignments, ...liveQueryOptions });
  const conflictsQuery = useQuery({ queryKey: ["conflicts"], queryFn: getConflicts, ...liveQueryOptions });
  const auditQuery = useQuery({ queryKey: ["audit"], queryFn: getAuditEvents, ...liveQueryOptions });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: getUsers, ...liveQueryOptions });
  const ripeConfigQuery = useQuery({ queryKey: ["ripe-config"], queryFn: getRipeConfig, ...liveQueryOptions });
  const ripeAllocatedPoolsQuery = useQuery({ queryKey: ["ripe-allocated-pools"], queryFn: getRipeAllocatedPools, ...liveQueryOptions });
  const ripeReportPoolsQuery = useQuery({ queryKey: ["ripe-report-pools"], queryFn: getRipeReportPools, ...liveQueryOptions });
  const bulkBatchesQuery = useQuery({
    queryKey: ["bulk-batches"],
    queryFn: getBulkBatches,
    refetchInterval: (query) => query.state.data?.some((batch) => batch.status === "RUNNING") ? 3000 : false,
    ...liveQueryOptions
  });

  const pools = poolsQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const conflicts = conflictsQuery.data ?? [];
  const auditEvents = auditQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const ripeConfig = ripeConfigQuery.data ?? null;
  const ripeAllocatedPools = ripeAllocatedPoolsQuery.data ?? [];
  const ripeReportPools = ripeReportPoolsQuery.data ?? [];
  const bulkBatches = bulkBatchesQuery.data ?? [];

  useEffect(() => {
    setSignedInUser(window.localStorage.getItem("ipam-username") ?? "admin");
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

  const resources = useMemo(() => buildRegistryResources(pools, assignments), [pools, assignments]);
  const stats = useMemo(() => buildRegistryStats(resources, conflicts), [resources, conflicts]);
  const selectedResource = resources.find((resource) => resource.id === selectedResourceId) ?? resources[0] ?? null;
  const registryUnavailable =
    (poolsQuery.isError && poolsQuery.data === undefined) ||
    (assignmentsQuery.isError && assignmentsQuery.data === undefined);

  useEffect(() => {
    if (!selectedResourceId && resources[0]) {
      setSelectedResourceId(resources[0].id);
    }
  }, [resources, selectedResourceId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pools"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments"] });
    void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    void queryClient.invalidateQueries({ queryKey: ["audit"] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    void queryClient.invalidateQueries({ queryKey: ["bulk-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["ripe-config"] });
    void queryClient.invalidateQueries({ queryKey: ["ripe-allocated-pools"] });
    void queryClient.invalidateQueries({ queryKey: ["ripe-report-pools"] });
    void poolsQuery.refetch();
    void assignmentsQuery.refetch();
    void conflictsQuery.refetch();
    void auditQuery.refetch();
    void usersQuery.refetch();
    void bulkBatchesQuery.refetch();
    void ripeConfigQuery.refetch();
    void ripeAllocatedPoolsQuery.refetch();
    void ripeReportPoolsQuery.refetch();
  };

  useEffect(() => {
    if (view === "search") {
      void poolsQuery.refetch();
      void assignmentsQuery.refetch();
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

  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: refresh,
    onError: (error) => window.alert(errorMessage(error))
  });

  const run = (operation: () => Promise<unknown>) => mutation.mutate(operation);
  const navigateTo = (nextView: ViewKey) => setView(nextView);
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
          <div className="flex items-center gap-3">
            <button className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={() => navigateTo("executive")} aria-label="Go to home">
              <img src="/salam-logo-white.png" alt="Salam" className="h-9 w-36 object-contain" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Salam LIR</p>
              <h1 className="text-2xl font-semibold">Resource Registry & IPAM Platform</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={registryUnavailable ? "danger" : "success"}>
              <Database className="mr-1 h-3 w-3" />
              SQLite {registryUnavailable ? "unavailable" : "online"}
            </Badge>
            <Badge variant="default">{signedInUser}</Badge>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>

        {registryUnavailable ? (
          <Card className="border-destructive/60 bg-destructive/10">
            <CardContent className="pt-5 text-sm text-red-200">
              FastAPI is not reachable at {process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001"}. Start the backend with <code>npm.cmd run api:py</code>.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border bg-card p-3">
            <div className="mb-3 px-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Registry Modules</p>
            </div>
            <nav className="grid gap-1">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition",
                    view === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => navigateTo(item.id)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          <section className="min-w-0">
            <BreadcrumbNavigation view={view} resource={selectedResource} onNavigate={navigateTo} />
            {view === "executive" ? <ExecutiveDashboard stats={stats} resources={resources} auditEvents={auditEvents} /> : null}
            {view === "registry" ? (
              <ResourceRegistry
                resources={resources}
                expanded={expanded}
                globalSearch={globalSearch}
                poolForm={poolForm}
                onExpanded={setExpanded}
                onGlobalSearch={setGlobalSearch}
                onPoolForm={setPoolForm}
                onOpen={openResource}
                onCreatePool={() => run(async () => { await api.post("/pools", poolForm); })}
                onRefresh={refresh}
                ripeDiscoveryResult={ripeDiscoveryResult}
                ripeDiscoveryStatus={ripeDiscoveryStatus}
                onDiscoverRipePools={() => {
                  setRipeDiscoveryStatus("running");
                  run(async () => {
                    try {
                      const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools");
                      setRipeDiscoveryResult(data);
                      setRipeDiscoveryStatus("complete");
                    } catch (error) {
                      setRipeDiscoveryStatus("idle");
                      throw error;
                    }
                  });
                }}
                onSyncRipePool={(pool) => run(async () => {
                  await api.post("/ripe/discovery/root-pools/sync", pool);
                  const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools");
                  setRipeDiscoveryResult(data);
                  void queryClient.invalidateQueries({ queryKey: ["ripe-report-pools"] });
                  refresh();
                })}
                onSyncCstLir={(pool) => run(async () => {
                  await api.post("/ripe/discovery/root-pools/cst-sync", pool);
                  const { data } = await api.get<RipeDiscoveryResponse>("/ripe/discovery/root-pools");
                  setRipeDiscoveryResult(data);
                  refresh();
                })}
                onPushToRipe={(resource) => run(async () => {
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
                })}
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
                      : `Move ${resource.cidr} to RIPE removal pending? The subnet can be deleted after the RIPE unassignment is completed.`,
                    destructive: true,
                    action: () => run(async () => {
                      if (resource.administrativeStatus === "RESERVED") {
                        await api.delete(`/assignments/${source.id}`);
                      } else {
                        await api.patch(`/assignments/${source.id}/status`, { status: "Retiring" });
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
                  title: "Release assignment",
                  detail: `Move ${assignment.cidr} to RIPE removal pending? The subnet can be deleted after the RIPE unassignment is completed.`,
                  destructive: true,
                  action: () => run(async () => { await api.patch(`/assignments/${assignment.id}/status`, { status: "Retiring" }); })
                })}
                onStatus={(assignment, status) => run(async () => { await api.patch(`/assignments/${assignment.id}/status`, { status }); })}
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
            {view === "integrity" ? <IntegrityManagement conflicts={conflicts} resources={resources} onOpen={openResource} /> : null}
            {view === "bulk" ? (
              <BulkOperations
                poolCsv={bulkPoolCsv}
                assignmentCsv={bulkAssignmentCsv}
                poolFileName={bulkPoolFileName}
                assignmentFileName={bulkAssignmentFileName}
                batches={bulkBatches}
                isRefreshing={bulkBatchesQuery.isFetching}
                onPoolCsv={setBulkPoolCsv}
                onAssignmentCsv={setBulkAssignmentCsv}
                onPoolFileName={setBulkPoolFileName}
                onAssignmentFileName={setBulkAssignmentFileName}
                onRefresh={() => void bulkBatchesQuery.refetch()}
                onImportPools={() => run(async () => {
                  const { data } = await api.post<BulkBatch>("/pools/bulk", { csv_text: bulkPoolCsv, file_name: bulkPoolFileName });
                  setNotice({ title: "Bulk transaction started", detail: `${data.id} is processing ${data.total_rows} subnet rows. Track status in Bulk Transaction History.` });
                })}
                onImportAssignments={() => run(async () => {
                  const { data } = await api.post<BulkBatch>("/assignments/bulk", { csv_text: bulkAssignmentCsv, file_name: bulkAssignmentFileName });
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
                ripeReportPools={ripeReportPools}
                ripeReportForm={ripeReportForm}
                ripeReportResult={ripeReportResult}
                onRipeReportForm={setRipeReportForm}
                onRunRipeReport={() => run(async () => {
                  const { data } = await api.post<RipeReportResponse>("/ripe/reports/query", {
                    pool_id: ripeReportForm.poolId,
                    date_from: ripeReportForm.dateFrom,
                    date_to: ripeReportForm.dateTo,
                    report_type: ripeReportForm.reportType
                  });
                  setRipeReportResult(data);
                })}
              />
            ) : null}
            {view === "administration" ? (
              <Administration
                users={users}
                newUser={newUser}
                passwordReset={passwordReset}
                ripeConfig={ripeConfig}
                ripeConfigForm={ripeConfigForm}
                ripePoolCsv={ripePoolCsv}
                ripeAllocatedPools={ripeAllocatedPools}
                onNewUser={setNewUser}
                onPasswordReset={setPasswordReset}
                onRipeConfigForm={setRipeConfigForm}
                onRipePoolCsv={setRipePoolCsv}
                onAddUser={() => run(async () => { await api.post("/users", newUser); setNewUser({ username: "", password: "", role: "operator" }); })}
                onSetPassword={() => run(async () => { await api.patch(`/users/${passwordReset.userId}/password`, { password: passwordReset.password }); setPasswordReset((current) => ({ ...current, password: "" })); })}
                onToggleUser={(user) => run(async () => { await api.patch(`/users/${user.id}/status`, { status: user.status === "Active" ? "Disabled" : "Active" }); })}
                onSaveRipeConfig={() => run(async () => { await api.put("/ripe/config", ripeConfigForm); })}
                onImportRipePools={() => run(async () => {
                  const { data } = await api.post("/ripe/allocated-pools/bulk", { csv_text: ripePoolCsv, file_name: "ripe-allocated-pools.csv" });
                  setNotice({ title: "RIPE Allocated Pools Imported", detail: `${data.imported} imported, ${data.blocked} blocked.${data.errors?.length ? `\n${data.errors.slice(0, 8).join("\n")}` : ""}` });
                })}
              />
            ) : null}
          </section>
        </div>
      </div>

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

function ExecutiveDashboard({ stats, resources, auditEvents }: { stats: RegistryStats; resources: ManagedResource[]; auditEvents: AuditEvent[] }) {
  const typeMix = resourceTypeMix(resources);
  const lifecycleMix = lifecycleStateMix(resources);
  return (
    <div className="grid gap-5">
      <PageTitle title="Home" description="Authoritative Salam LIR IPv4 and IPv6 resource inventory, lifecycle, RIPE synchronization, and compliance status." />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Total IP Address Resources" value={formatHosts(stats.totalResources)} detail="Total IP addresses in registered subnets" />
        <Metric label="Registered Subnets" value={String(stats.totalPools)} detail="Authoritative parent subnets loaded in the registry" />
        <Metric label="Total Assignments" value={String(stats.totalAssignments)} detail="Assigned resources" />
        <Metric label="Total Reservations" value={String(stats.totalReservations)} detail="Reserved resources" />
        <Metric label="Utilization" value={`${stats.utilization}%`} detail={`${formatHosts(stats.availableCapacity)} available`} />
        <Metric label="Largest Free Block" value={stats.largestFreeBlock?.cidr ?? "None"} detail={stats.largestFreeBlock ? formatHosts(stats.largestFreeBlock.totalIps) : "No capacity"} />
        <Metric label="Fragmentation" value={`${stats.fragmentation}%`} detail="Free block fragmentation" />
        <Metric label="Integrity Issues" value={String(stats.integrityIssues)} detail="Critical, major, minor" />
        <Metric label="Pending Operations" value={String(stats.pendingOperations)} detail="Pending registry actions" />
        <Metric label="RIPE Sync" value="Phase 1 Ready" detail="PENDING / SYNCHRONIZED / EXCLUDED" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Resource Distribution</CardTitle>
            <CardDescription>Registry records by resource type</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeMix} dataKey="value" nameKey="name" innerRadius={70} outerRadius={100}>
                  {typeMix.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle State</CardTitle>
            <CardDescription>Operational state of registered resources</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lifecycleMix}>
                <CartesianGrid stroke="#24405f" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#0e9f8f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent Registry Operations</CardTitle>
          <CardDescription>Latest transaction history captured by the registry audit trail</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {auditEvents.slice(0, 6).map((event) => (
            <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="font-semibold">{event.action}</p>
                <p className="text-sm text-muted-foreground">{event.entity_type} / {event.entity_id}</p>
              </div>
              <span className="text-sm text-muted-foreground">{event.timestamp}</span>
            </div>
          ))}
          {!auditEvents.length ? <p className="text-sm text-muted-foreground">No audit events captured yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceRegistry(props: {
  resources: ManagedResource[];
  expanded: Record<string, boolean>;
  globalSearch: string;
  poolForm: { cidr: string; name: string; region: string; description: string };
  ripeDiscoveryResult: RipeDiscoveryResponse | null;
  ripeDiscoveryStatus: "idle" | "running" | "complete";
  onExpanded: (value: Record<string, boolean>) => void;
  onGlobalSearch: (value: string) => void;
  onPoolForm: (value: { cidr: string; name: string; region: string; description: string }) => void;
  onOpen: (resource: ManagedResource) => void;
  onCreatePool: () => void;
  onRefresh: () => void;
  onDiscoverRipePools: () => void;
  onSyncRipePool: (pool: RipeDiscoveredRootPool) => void;
  onSyncCstLir: (pool: RipeDiscoveredRootPool) => void;
  onPushToRipe: (resource: ManagedResource) => void;
}) {
  const visible = filterResources(presentationResources(props.resources), props.globalSearch);

  return (
    <div className="grid gap-5">
      <PageTitle title="Resource Registry" description="System of record for IPv4 subnets across available, assigned, reserved, retired, and historical lifecycle states." />
      <Card>
        <CardHeader>
          <CardTitle>Register Subnet</CardTitle>
          <CardDescription>Register an authoritative IPv4 subnet in the LIR registry.</CardDescription>
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
      <RipePoolsDiscovery
        result={props.ripeDiscoveryResult}
        status={props.ripeDiscoveryStatus}
        onDiscover={props.onDiscoverRipePools}
        onSync={props.onSyncRipePool}
        onSyncCstLir={props.onSyncCstLir}
      />
      <RipeSyncWorklist resources={props.resources} onOpen={props.onOpen} onPushToRipe={props.onPushToRipe} onRefresh={props.onRefresh} />
      <SubnetNavigator resources={visible} query={props.globalSearch} onQuery={props.onGlobalSearch} onOpen={props.onOpen} />
    </div>
  );
}

function RipePoolsDiscovery({
  result,
  status,
  onDiscover,
  onSync,
  onSyncCstLir
}: {
  result: RipeDiscoveryResponse | null;
  status: "idle" | "running" | "complete";
  onDiscover: () => void;
  onSync: (pool: RipeDiscoveredRootPool) => void;
  onSyncCstLir: (pool: RipeDiscoveredRootPool) => void;
}) {
  const rows = result?.rows ?? [];
  const synced = rows.filter((row) => row.local_sync_status === "LIR Synced").length;
  const unsynced = rows.length - synced;
  const running = status === "running";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>RIPE IP Pools Discovery</CardTitle>
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
            <CardDescription>Discover root inetnum allocations from RIPE using the configured mnt-lower maintainer lookup used by RIPE reports, then sync selected pools into Salam LIR/IPAM.</CardDescription>
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
        <div className="max-h-[360px] overflow-auto rounded-md border">
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
              {rows.map((pool) => (
                <TableRow key={`${pool.cidr}-${pool.allocation_range}`}>
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
                        disabled={pool.local_sync_status === "LIR Synced"}
                        title={pool.cidr.includes(",") ? "This RIPE range will be synced as multiple local LIR pools." : "Sync this RIPE root pool to local LIR."}
                        onClick={() => onSync(pool)}
                      >
                        Sync to Local LIR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pool.local_sync_status !== "LIR Synced" || pool.cst_sync_status === "CST Synced"}
                        title={pool.local_sync_status !== "LIR Synced" ? "Sync to Local LIR before syncing to CST LIR." : "Mark this local LIR pool as synced to CST LIR."}
                        onClick={() => onSyncCstLir(pool)}
                      >
                        Sync to CST LIR
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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

function RipeSyncWorklist({
  resources,
  onOpen,
  onPushToRipe,
  onRefresh
}: {
  resources: ManagedResource[];
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
                      <Button size="sm" variant={resource.ripeSyncStatus === "FAILED" ? "destructive" : "default"} onClick={() => onPushToRipe(resource)}>
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
  onQuery,
  onOpen
}: {
  resources: ManagedResource[];
  query?: string;
  onQuery?: (value: string) => void;
  onOpen: (resource: ManagedResource) => void;
}) {
  const displayResources = presentationSubnets(resources);
  const renderedSubnets = displayResources.slice(0, NAVIGATOR_RENDER_LIMIT);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Subnet Navigator</CardTitle>
            <CardDescription>All CIDRs are modeled as subnets. Select a row to drill into the common Resource Summary page.</CardDescription>
          </div>
          {onQuery ? (
            <Input className="md:max-w-sm" value={query ?? ""} onChange={(event) => onQuery(event.target.value)} placeholder="Search CIDR, resource ID, owner, status, netname" />
          ) : null}
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
  const children = resources.filter((item) => item.parentId === resource.id);
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
              <CardDescription>{resource.type} / {resource.classification} / {resource.owner} / RIPE {resource.ripeSyncStatus}</CardDescription>
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
          ["Resource Type", resource.type],
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
            <button key={resourceKey(child, childIndex, "summary-child")} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-left hover:border-primary/70" onClick={() => onOpen(child)}>
              <span>
                <span className="block font-semibold">{child.cidr}</span>
                <span className="text-sm text-muted-foreground">{child.type} / {child.owner}</span>
              </span>
              <Badge variant={badgeForResource(child)}>{child.status}</Badge>
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

function AssignmentManagement(props: {
  resources: ManagedResource[];
  assignments: Assignment[];
  form: AssignmentPayload;
  poolDraft: PoolAssignmentDraft;
  onForm: (value: AssignmentPayload) => void;
  onPoolDraft: (value: PoolAssignmentDraft) => void;
  onAssign: () => void;
  onRelease: (assignment: Assignment) => void;
  onStatus: (assignment: Assignment, status: AssignmentStatus) => void;
}) {
  const available = presentationResources(props.resources).filter((resource) => resource.administrativeStatus === "AVAILABLE" && resource.type === "Subnet");
  const parentPoolMatches = filterResources(available, props.poolDraft.poolSearch);
  const selectedPool = available.find((resource) => resource.id === props.poolDraft.parentPoolId) ?? null;
  const assignmentSummary = assignmentDraftSummary(props.form, props.poolDraft, props.resources);
  const mergeForm = (patch: Partial<AssignmentPayload>) => props.onForm({ ...props.form, ...patch });
  const update = <Key extends keyof AssignmentPayload>(key: Key, value: AssignmentPayload[Key]) => mergeForm({ [key]: value } as Partial<AssignmentPayload>);
  const updatePoolDraft = (value: Partial<PoolAssignmentDraft>) => props.onPoolDraft({ ...props.poolDraft, ...value });
  const targetType = props.form.assignment_target_type;
  const dynamicOwnerFields =
    targetType === "business_customer" ? businessBssFields : targetType === "individual" ? individualBssFields : internalAssignmentFields;
  const detailTitle = targetType === "business_customer" ? "Business customer details" : targetType === "individual" ? "Individual customer details" : "Internal assignment details";

  return (
    <div className="grid gap-5">
      <PageTitle title="Assignment Management" description="Create, modify, suspend, resume, and release allocations to supported resource owners." />
      <Card>
        <CardHeader>
          <CardTitle>Create Assignment</CardTitle>
          <CardDescription>Assignments consume a registry resource and attach owner, service, contact, and transaction context.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <AssignmentSteps currentStep={assignmentSummary.cidr ? (props.form.service_id || props.form.full_name || props.form.internal_application_name || props.form.requested_by ? 3 : 2) : 1} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3">
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

              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-semibold">2. Enter Details</p>
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
                <AssignmentFieldGroup title={detailTitle} fields={dynamicOwnerFields} form={props.form} onChange={update} />
              </div>

              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-semibold">3. Notes</p>
                  <p className="text-xs text-muted-foreground">Optional operational notes for this assignment.</p>
                </div>
                <Textarea value={props.form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Assignment notes" />
              </div>
            </div>
            <AssignmentReviewCard summary={assignmentSummary} form={props.form} onAssign={props.onAssign} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current Assignments</CardTitle>
          <CardDescription>Assignments and reservations stored in the registry.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[520px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-semibold">{assignment.cidr}</TableCell>
                    <TableCell>{assignment.customer_name || assignment.internal_application_name}</TableCell>
                    <TableCell><Badge variant={assignment.status === "Blocked" ? "danger" : assignment.status === "Reserved" ? "warning" : "success"}>{assignment.status}</Badge></TableCell>
                    <TableCell>{assignment.service_instance_id || assignment.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => props.onStatus(assignment, assignment.status === "Blocked" ? "Active" : "Blocked")}>{assignment.status === "Blocked" ? "Resume" : "Suspend"}</Button>
                        <Button size="sm" variant="destructive" onClick={() => props.onRelease(assignment)}>Release</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
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
          <Badge variant={badgeForResource(resource)}>{resource.type}</Badge>
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
  const searchablePools = presentationResources(props.resources).filter((resource) => resource.type === "Subnet");
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

function IntegrityManagement({ conflicts, resources, onOpen }: { conflicts: Conflict[]; resources: ManagedResource[]; onOpen: (resource: ManagedResource) => void }) {
  const derivedIssues = detectIntegrityIssues(resources);
  const [selectedConflictKey, setSelectedConflictKey] = useState("");
  const conflictItems = conflicts.map((conflict, index) => ({ conflict, key: conflictKey(conflict, index), sides: conflictSides(conflict, resources) }));
  const selectedConflict = conflictItems.find((item) => item.key === selectedConflictKey) ?? conflictItems[0] ?? null;
  return (
    <div className="grid gap-5">
      <PageTitle title="Integrity & Conflict Management" description="Operational module for overlaps, duplicates, invalid CIDR structures, orphan resources, and registry inconsistencies." />
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
          <ConflictReviewPanel item={selectedConflict} onOpen={onOpen} />
        </CardContent>
      </Card>
    </div>
  );
}

function ConflictReviewPanel({ item, onOpen }: { item: { conflict: Conflict; key: string; sides: ReturnType<typeof conflictSides> } | null; onOpen: (resource: ManagedResource) => void }) {
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
          <span>Owner: {side.resource.owner || "N/A"}</span>
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
  batches: BulkBatch[];
  isRefreshing: boolean;
  onPoolCsv: (value: string) => void;
  onAssignmentCsv: (value: string) => void;
  onPoolFileName: (value: string) => void;
  onAssignmentFileName: (value: string) => void;
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
    "CustomerName"
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
    row.customerName
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

function GlobalSearch({
  resources,
  query,
  filters,
  isRefreshing,
  lastUpdated,
  onQuery,
  onFilters,
  onRefresh,
  onOpen
}: {
  resources: ManagedResource[];
  query: string;
  filters: SearchFilterCriterion[];
  isRefreshing: boolean;
  lastUpdated: number;
  onQuery: (value: string) => void;
  onFilters: (value: SearchFilterCriterion[]) => void;
  onRefresh: () => void;
  onOpen: (resource: ManagedResource) => void;
}) {
  const [draftFilter, setDraftFilter] = useState<{ field: SearchFilterField; value: string }>({ field: "administrativeStatus", value: "" });
  const results = filterResources(presentationResources(resources), query, filters);
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
      <PageTitle title="Global Search" description="Search by IP address, CIDR, Resource ID, Transaction ID, owner, status, netname, and selected filter criteria." />
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
          <div className="grid max-h-[560px] gap-2 overflow-auto rounded-md border p-2">
            {results.map((resource, resourceIndex) => (
              <button key={resourceKey(resource, resourceIndex, "global-search")} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-left hover:border-primary/70" onClick={() => onOpen(resource)}>
                <span>
                  <span className="block font-semibold">{resource.cidr}</span>
                  <span className="text-sm text-muted-foreground">{resource.uuid} / {resource.transactionId} / {resource.netname}</span>
                </span>
                <Badge variant={badgeForResource(resource)}>{resource.status}</Badge>
              </button>
            ))}
            {!results.length ? <p className="p-3 text-sm text-muted-foreground">No matching resources.</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Reporting({
  resources,
  auditEvents,
  conflicts,
  ripeReportPools,
  ripeReportForm,
  ripeReportResult,
  onRipeReportForm,
  onRunRipeReport
}: {
  resources: ManagedResource[];
  auditEvents: AuditEvent[];
  conflicts: Conflict[];
  ripeReportPools: RipeAllocatedPool[];
  ripeReportForm: { poolId: string; dateFrom: string; dateTo: string; reportType: string };
  ripeReportResult: RipeReportResponse | null;
  onRipeReportForm: (value: { poolId: string; dateFrom: string; dateTo: string; reportType: string }) => void;
  onRunRipeReport: () => void;
}) {
  const [activeReport, setActiveReport] = useState<"pool-summary" | "cst-lir" | "resource-utilization" | "ripe-allocation" | null>(null);
  const [poolSummaryFilters, setPoolSummaryFilters] = useState<Record<string, string>>({});
  const [poolSummaryVisibleRows, setPoolSummaryVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [registryVisibleRows, setRegistryVisibleRows] = useState(REPORT_BATCH_SIZE);
  const [utilizationVisibleRows, setUtilizationVisibleRows] = useState(REPORT_BATCH_SIZE);
  const poolSummaryRows = poolSummaryReportRows(resources);
  const filteredPoolSummaryRows = filterReportRows(poolSummaryRows, poolSummaryFilters, POOL_SUMMARY_COLUMNS);
  const reportingResources = presentationResources(resources);
  const utilizationRows = resourceUtilizationRows(reportingResources);
  const registryRows = registryExportRows(reportingResources);
  const visiblePoolSummaryRows = filteredPoolSummaryRows.slice(0, poolSummaryVisibleRows);
  const visibleRegistryRows = registryRows.slice(0, registryVisibleRows);
  const visibleUtilizationRows = utilizationRows.slice(0, utilizationVisibleRows);
  useEffect(() => {
    setPoolSummaryVisibleRows(REPORT_BATCH_SIZE);
  }, [poolSummaryFilters, resources.length]);
  useEffect(() => {
    setRegistryVisibleRows(REPORT_BATCH_SIZE);
    setUtilizationVisibleRows(REPORT_BATCH_SIZE);
  }, [resources.length]);
  const loadMorePoolSummaryRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, poolSummaryVisibleRows, filteredPoolSummaryRows.length)) {
      setPoolSummaryVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, filteredPoolSummaryRows.length));
    }
  };
  const loadMoreRegistryRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, registryVisibleRows, registryRows.length)) {
      setRegistryVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, registryRows.length));
    }
  };
  const loadMoreUtilizationRows = (event: UIEvent<HTMLDivElement>) => {
    if (shouldLoadNextReportBatch(event, utilizationVisibleRows, utilizationRows.length)) {
      setUtilizationVisibleRows((current) => Math.min(current + REPORT_BATCH_SIZE, utilizationRows.length));
    }
  };
  const openRipeReport = (reportType: string) => {
    onRipeReportForm({ ...ripeReportForm, reportType });
    setActiveReport("ripe-allocation");
  };
  const reportRows = [
    { id: "pool-summary", activeId: "pool-summary" as const, name: "Subnet Summary Report", scope: `${filteredPoolSummaryRows.length} of ${poolSummaryRows.length} registered subnets`, status: "Available" },
    { id: "resource-utilization", activeId: "resource-utilization" as const, name: "Resource Utilization Report", scope: `${reportingResources.length} resources`, status: "Available" },
    { id: "cst-lir", activeId: "cst-lir" as const, name: "CST/LIR Registry Report", scope: `${registryRows.length} CIDRs`, status: "Available" },
    { id: "ripe-assignment", activeId: "ripe-allocation" as const, reportType: "RIPE Assignment Report", name: "RIPE Assignment Report", scope: `${ripeReportPools.length} RIPE-discovered registry pools`, status: "Available" },
    { id: "ripe-maintainer-ip", activeId: "ripe-allocation" as const, reportType: "RIPE Maintainer IP Report", name: "RIPE Maintainer IP Report", scope: "mnt-lower ITC-NOC-MNT inetnums", status: "Available" },
    { id: "assignments", name: "Assignment Report", scope: `${resources.filter((item) => item.administrativeStatus === "ASSIGNED").length} assignments`, status: "Planned" },
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
                        onClick={() => report.reportType ? openRipeReport(report.reportType) : setActiveReport(report.activeId)}
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
                <CardDescription>Queries RIPE inetnum assignments by selected pool range, or all inetnums maintained by the configured mnt-lower value within that pool, and exports all returned attributes.</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">RIPE Report Type</span>
                <Select
                  value={ripeReportForm.reportType}
                  values={ripeReportTypes}
                  onChange={(reportType) => onRipeReportForm({ ...ripeReportForm, reportType })}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">RIPE Discovered Pool</span>
                <Select
                  value={ripeReportForm.poolId}
                  values={ripeReportPools.map((pool) => pool.id)}
                  labels={Object.fromEntries(ripeReportPools.map((pool) => [pool.id, `${pool.pool_name} (${pool.cidr})`]))}
                  onChange={(poolId) => onRipeReportForm({ ...ripeReportForm, poolId })}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Date From</span>
                <Input value={ripeReportForm.dateFrom} onChange={(event) => onRipeReportForm({ ...ripeReportForm, dateFrom: event.target.value })} placeholder="YYYY-MM-DD" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Date To</span>
                <Input value={ripeReportForm.dateTo} onChange={(event) => onRipeReportForm({ ...ripeReportForm, dateTo: event.target.value })} placeholder="YYYY-MM-DD" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onRunRipeReport} disabled={!ripeReportForm.poolId || !ripeReportPools.length}>
                <Radar className="h-4 w-4" />
                Run {ripeReportForm.reportType}
              </Button>
              <Button variant="outline" onClick={() => ripeReportResult ? exportRipeAssignmentRows(ripeReportResult.rows, ripeReportResult.report_type) : undefined} disabled={!ripeReportResult?.rows.length}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              {!ripeReportPools.length ? <p className="self-center text-sm text-muted-foreground">Run RIPE IP Pools Discovery and sync a pool to Local LIR first.</p> : null}
            </div>
            {ripeReportResult ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="font-semibold">{ripeReportResult.report_type} / {ripeReportResult.pool.cidr}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Maintainer: {ripeReportResult.maintainer || "Not configured"}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{ripeReportResult.message}</p>
                </div>
                {ripeReportResult.rows.length ? (
                  <div className="max-h-[320px] overflow-auto rounded-md border bg-background/40">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {ripeAssignmentColumns(ripeReportResult.rows).map((column) => (
                            <TableHead key={column}>{column}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ripeReportResult.rows.map((row, rowIndex) => (
                          <TableRow key={`${row.inetnum}-${row.netname}-${rowIndex}`}>
                            {ripeAssignmentColumns(ripeReportResult.rows).map((column) => (
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
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pool Name</TableHead>
                    <TableHead>CIDR</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ripeReportPools.map((pool) => (
                    <TableRow key={pool.id}>
                      <TableCell className="font-semibold">{pool.pool_name}</TableCell>
                      <TableCell>{pool.cidr}</TableCell>
                      <TableCell>{pool.start_ip} - {pool.end_ip}</TableCell>
                      <TableCell>{pool.source}</TableCell>
                      <TableCell>{pool.created_date}</TableCell>
                    </TableRow>
                  ))}
                  {!ripeReportPools.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No RIPE-discovered registry pools are synced to Local LIR.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
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
              <CardTitle>Resource Utilization Export</CardTitle>
              <CardDescription>Exports every CIDR in the registry, including registered, assigned, reserved, retired, and calculated available subnet CIDRs.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActiveReport(null)}>
                Back to Reports
              </Button>
              <Button variant="outline" onClick={() => exportResourceUtilization(reportingResources, "csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => exportResourceUtilization(reportingResources, "xlsx")}>
                <FileDown className="h-4 w-4" />
                Export XLSX
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            <ReportMetric label="CIDRs" value={String(reportingResources.length)} detail="Rows included in export" />
            <ReportMetric label="Available" value={String(reportingResources.filter((item) => item.administrativeStatus === "AVAILABLE").length)} detail="Free CIDR blocks" />
            <ReportMetric label="Assigned" value={String(reportingResources.filter((item) => item.administrativeStatus === "ASSIGNED").length)} detail="Active allocations" />
            <ReportMetric label="Reserved" value={String(reportingResources.filter((item) => item.administrativeStatus === "RESERVED").length)} detail="Held capacity" />
          </div>
          <div className="max-h-[620px] overflow-auto rounded-md border" onScroll={loadMoreUtilizationRows}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Free IPs</TableHead>
                  <TableHead>Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUtilizationRows.map((row, rowIndex) => (
                  <TableRow key={reportRowKey(row, rowIndex, "resource-utilization")}>
                    <TableCell className="font-semibold">{row.cidr}</TableCell>
                    <TableCell><Badge variant={badgeForStatus(row.administrative_status)}>{row.administrative_status}</Badge></TableCell>
                    <TableCell>{row.resource_type}</TableCell>
                    <TableCell>{row.start_ip} - {row.end_ip}</TableCell>
                    <TableCell>{row.free_ips}</TableCell>
                    <TableCell>{row.utilization_percent}%</TableCell>
                  </TableRow>
                ))}
                {!utilizationRows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No CIDR records available to export.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {Math.min(utilizationVisibleRows, utilizationRows.length)} of {utilizationRows.length} rows. Scroll down to load the next {REPORT_BATCH_SIZE}. The exported file includes all {RESOURCE_UTILIZATION_COLUMNS.length} columns.
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

function Administration(props: {
  users: User[];
  newUser: { username: string; password: string; role: User["role"] };
  passwordReset: { userId: string; password: string };
  ripeConfig: RipeConfig | null;
  ripeConfigForm: RipeConfigPayload;
  ripePoolCsv: string;
  ripeAllocatedPools: RipeAllocatedPool[];
  onNewUser: (value: { username: string; password: string; role: User["role"] }) => void;
  onPasswordReset: (value: { userId: string; password: string }) => void;
  onRipeConfigForm: (value: RipeConfigPayload) => void;
  onRipePoolCsv: (value: string) => void;
  onAddUser: () => void;
  onSetPassword: () => void;
  onToggleUser: (user: User) => void;
  onSaveRipeConfig: () => void;
  onImportRipePools: () => void;
}) {
  const roles = ["admin", "operator", "viewer"];
  const policyRows = ["Allocation Rules", "Reservation Rules", "Retention Rules"];
  return (
    <div className="grid gap-5">
      <PageTitle title="Administration" description="Users, roles, and registry policies for LIR operations." />
      <Card>
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
      </Card>
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
                  <TableCell>{resource.type}</TableCell>
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
    customer_type: businessLike ? form.customer_type || "Enterprise" : individual ? form.customer_type || "Individual" : form.customer_type,
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

function buildRegistryResources(pools: Pool[], assignments: Assignment[]) {
  const resources: ManagedResource[] = [];
  for (const pool of pools) {
    const poolRange = toRange(pool);
    const occupyingAssignments = assignments.filter((assignment) => !assignmentReleasedAfterRipeRemoval(assignment));
    const childAssignments = occupyingAssignments.filter((assignment) => contains(poolRange, toRange(assignment)));
    const usedIps = childAssignments.filter((assignment) => assignment.status !== "Reserved").reduce((sum, assignment) => sum + assignment.size, 0);
    const reservedIps = childAssignments.filter((assignment) => assignment.status === "Reserved").reduce((sum, assignment) => sum + assignment.size, 0);
    const freeIps = Math.max(0, pool.size - usedIps - reservedIps);
    const poolStatus = poolAdministrativeStatus(pool);
    resources.push({
      id: pool.id,
      uuid: resourceUuid("pool", pool.id, pool.cidr),
      parentId: "",
      cidr: pool.cidr,
      serviceProviderId: "5",
      serviceProviderName: "Salam",
      asn: pool.asn || "AS35753",
      assignmentStatusId: 1,
      serviceId: "",
      organizationName: "",
      organizationId: "",
      customerTypeId: "",
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
      classification: classifyCidr(pool.cidr),
      owner: "Salam LIR",
      status: poolStatus,
      administrativeStatus: poolStatus,
      ripeSyncRequired: classifyCidr(pool.cidr) === "PUBLIC",
      ripeSyncStatus: classifyCidr(pool.cidr) === "PUBLIC" ? "PENDING" : "EXCLUDED",
      cstSyncStatus: "PENDING",
      actionFlag: "N",
      accessTechnologyId: "",
      accessTechnology: "",
      serviceDescription: "",
      transactionId: pool.external_id || pool.id,
      sourceRegistry: pool.source_system || "Local Registry",
      lastUpdated: pool.last_audit_at || pool.created_at,
      netname: pool.name,
      description: pool.description || pool.name,
      country: "SA",
      maintainer: pool.owner || "Salam-LIR-MNT",
      previousUuid: "",
      sourceUuid: "",
      successorUuid: "",
      operationType: "CREATE",
      source: pool
    });

    for (const assignment of childAssignments) {
      const assignmentRange = toRange(assignment);
      const reserved = assignment.status === "Reserved";
      const hideIndividualIdentity = assignmentIsIndividual(assignment);
      resources.push({
        id: assignment.id,
        uuid: resourceUuid("assignment", assignment.id, assignment.cidr),
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
        classification: classifyCidr(assignment.cidr),
        owner: assignmentOwner(assignment),
        status: assignmentToAdministrativeStatus(assignment),
        administrativeStatus: assignmentToAdministrativeStatus(assignment),
        ripeSyncRequired: classifyCidr(assignment.cidr) === "PUBLIC",
        ripeSyncStatus: ripeStatusForAssignment(assignment, classifyCidr(assignment.cidr) === "PUBLIC"),
        cstSyncStatus: assignment.cst_sync_status === "SUCCESS" ? "SUCCESS" : assignment.cst_sync_status === "FAILED" ? "FAILED" : assignment.cst_sync_status === "NOT_REQUIRED" ? "NOT_REQUIRED" : "PENDING",
        actionFlag: assignment.action_flag || "N",
        accessTechnologyId: assignment.access_technology_id,
        accessTechnology: assignment.access_technology || accessTechnologyLabels[assignment.access_technology_id] || "",
        serviceDescription: assignment.service_description || assignment.service || assignment.assignment_purpose,
        transactionId: assignment.service_instance_id || assignment.id,
        sourceRegistry: "Local Registry",
        lastUpdated: assignment.created_at,
        netname: assignment.customer_name || assignment.internal_application_name || assignment.assignment_name,
        description: assignment.service || assignment.assignment_description || assignment.assignment_name,
        country: "SA",
        maintainer: assignment.owner || "Salam-LIR-MNT",
        previousUuid: "",
        sourceUuid: "",
        successorUuid: "",
        operationType: reserved ? "RESERVE" : assignment.status === "Retiring" ? "RETIRE" : "ASSIGN",
        source: assignment
      });
    }

    if (poolStatus !== "RETIRED" && poolStatus !== "HISTORICAL") {
      for (const range of calculateContinuousFreeRanges(pool, occupyingAssignments)) {
        for (const block of rangeToCidrs(range.start, range.end)) {
          if (block.cidr === pool.cidr) {
            continue;
          }
          const freeUuid = resourceUuid("free", pool.id, block.cidr);
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
            classification: classifyCidr(block.cidr),
            owner: "Salam LIR",
            status: "AVAILABLE",
            administrativeStatus: "AVAILABLE",
            ripeSyncRequired: false,
            ripeSyncStatus: "EXCLUDED",
            cstSyncStatus: "NOT_REQUIRED",
            actionFlag: "S",
            accessTechnologyId: "",
            accessTechnology: "",
            serviceDescription: "",
            transactionId: `AVAILABLE-${pool.id}`,
            sourceRegistry: "Calculated",
            lastUpdated: pool.created_at,
            netname: `${pool.name}-FREE`,
            description: "Calculated available free block",
            country: "SA",
            maintainer: "Salam-LIR-MNT",
            previousUuid: "",
            sourceUuid: resourceUuid("pool", pool.id, pool.cidr),
            successorUuid: "",
            operationType: "CALCULATED_FREE_SPACE",
            source: null
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
    const textMatch = !normalized || [resource.id, resource.uuid, resource.parentId, resource.cidr, resource.startIp, resource.endIp, resource.type, resource.classification, resource.owner, resource.administrativeStatus, resource.ripeSyncStatus, resource.transactionId, resource.netname, resource.description]
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
  { key: "asn", header: "asn" },
  { key: "ipVersion", header: "ipVersion" },
  { key: "assignmentStatusId", header: "assignmentStatusId" },
  { key: "serviceId", header: "serviceId" },
  { key: "organizationName", header: "organizationName" },
  { key: "organizationId", header: "organizationId" },
  { key: "customerTypeId", header: "customerTypeId" },
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
  { key: "total", header: "Total" },
  { key: "usable", header: "Usable" },
  { key: "in_use", header: "In Use" },
  { key: "reserved", header: "Reserved" },
  { key: "free", header: "Free" },
  { key: "usage_percent", header: "Usage %" },
  { key: "largest_free_cidr", header: "Largest Free CIDR" },
  { key: "status", header: "Status" }
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

function registryExportRows(resources: ManagedResource[]): ResourceUtilizationRow[] {
  return resources.map((resource) => ({
    transactionId: resource.transactionId,
    serviceProviderId: resource.serviceProviderId,
    ipSubnet: resource.cidr,
    asn: resource.asn,
    ipVersion: 1,
    assignmentStatusId: resource.assignmentStatusId,
    serviceId: resource.serviceId,
    organizationName: resource.organizationName,
    organizationId: resource.organizationId,
    customerTypeId: resource.customerTypeId,
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
      assignment_status: assignment?.status ?? "",
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
      customer_id: assignment?.customer_id ?? "",
      customer_name: assignment?.customer_name ?? "",
      customer_type: assignment?.customer_type ?? "",
      customer_account_id: assignment?.customer_account_id ?? "",
      customer_segment: assignment?.customer_segment ?? "",
      commercial_reg_id: assignment?.commercial_reg_id ?? "",
      unified_number: assignment?.unified_number ?? "",
      contact_name: assignment?.contact_name ?? "",
      contact_number: assignment?.contact_number ?? "",
      contact_email: assignment?.contact_email ?? "",
      city: assignment?.city ?? "",
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

function exportResourceUtilization(resources: ManagedResource[], format: "csv" | "xlsx") {
  const rows = resourceUtilizationRows(resources);
  const date = today();
  if (format === "csv") {
    downloadBlob(`resource-utilization-${date}.csv`, "text/csv;charset=utf-8", buildCsv(rows));
    return;
  }
  downloadBlob(
    `resource-utilization-${date}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildXlsx("Resource Utilization", RESOURCE_UTILIZATION_COLUMNS.map((column) => column.header), rows.map((row) => RESOURCE_UTILIZATION_COLUMNS.map((column) => row[column.key] ?? "")))
  );
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
        region: normalized.region || "Unassigned region"
      });
    }
  });

  return buildSimpleCsv(
    ["cidr", "name", "region"],
    converted.map((row) => [row.cidr, row.name, row.region])
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
    throw new Error("Assignment import requires either cidr,size,status,assignmentDate,customerName or startIp,endIp,size,status,assignmentDate,customerName headers.");
  }

  rows.forEach((row, index) => {
    const normalized = normalizeCsvRecord(row);
    const rowNumber = index + 2;
    const cidr = normalized.cidr;
    const startIp = normalized.startip || normalized.start_ip || normalized.start;
    const endIp = normalized.endip || normalized.end_ip || normalized.end;
    const sizeText = normalized.size || normalized.total;
    const status = normalized.status;
    const assignmentDate = normalized.assignmentdate || normalized.assignment_date;
    const customerName = normalized.customername || normalized.customer_name;

    if (!assignmentDate) {
      throw new Error(`row ${rowNumber}: assignmentDate is required.`);
    }
    if (!status) {
      throw new Error(`row ${rowNumber}: status is required. Use 1 Unassigned, 2 Internal, 3 Business, or 4 Individual.`);
    }
    if (!["1", "2", "3", "4"].includes(status)) {
      throw new Error(`row ${rowNumber}: status must be 1 (Unassigned), 2 (Internal), 3 (Business), or 4 (Individual).`);
    }
    if (status === "3" && !(normalized.serviceid || normalized.service_id)) {
      throw new Error(`row ${rowNumber}: serviceId is required for Business rows.`);
    }
    if (status === "2" && !(normalized.servicedescription || normalized.service_description || normalized.service)) {
      throw new Error(`row ${rowNumber}: serviceDescription is required for Internal rows.`);
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
  if (isUuid(id)) {
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
    if (normalized === "FAILED") {
      return "FAILED";
    }
    if ((normalized === "SUCCESS" || normalized === "SYNCHRONIZED") && assignment.action_flag === "D") {
      return "SUCCESS";
    }
    if (!["NOT_REQUIRED", "EXCLUDED"].includes(normalized)) {
      return "DECOMMISSION_PENDING";
    }
  }
  if (assignment.status === "Retiring" && !["NOT_REQUIRED", "EXCLUDED"].includes(normalized)) {
    return "DECOMMISSION_PENDING";
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

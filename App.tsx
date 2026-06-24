import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

type TabId = "overview" | "subnetting" | "assignments" | "conflicts" | "pool-detail" | "admin";
type AssignmentStatus = "Reserved" | "Active" | "Planned" | "Retiring" | "Quarantined" | "Blocked";
type Environment = "Production" | "Staging" | "Development" | "Shared";
type L3Service = "Internet DIA" | "MPLS L3VPN" | "IP Transit" | "Private APN" | "Cloud Connect";
type Severity = "critical" | "warning" | "info";
type IconName = keyof typeof Ionicons.glyphMap;

type CidrRange = {
  cidr: string;
  start: number;
  end: number;
  prefix: number;
  size: number;
  firstUsable: string;
  lastUsable: string;
};

type NetworkPool = CidrRange & {
  id: string;
  name: string;
  region: string;
  source: string;
  createdAt: string;
};

type Assignment = CidrRange & {
  id: string;
  customerName: string;
  commercialRegId: string;
  unifiedNumber: string;
  contactNumber: string;
  city: string;
  region: string;
  contactName: string;
  l3Service: L3Service;
  service: string;
  owner: string;
  site: string;
  environment: Environment;
  status: AssignmentStatus;
  assignmentDate: string;
  notes: string;
};

type AssignmentForm = {
  cidr: string;
  customerName: string;
  commercialRegId: string;
  unifiedNumber: string;
  contactNumber: string;
  city: string;
  region: string;
  contactName: string;
  l3Service: L3Service;
  service: string;
  owner: string;
  site: string;
  environment: Environment;
  status: AssignmentStatus;
  assignmentDate: string;
  notes: string;
};

type PlannedSubnet = CidrRange & {
  parentId: string;
  available: boolean;
  blockingAssignments: string[];
};

type Conflict = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  ranges: string[];
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

type AdminUser = {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  status: "Active" | "Disabled";
  createdAt?: string;
};

const environments: Environment[] = ["Production", "Staging", "Development", "Shared"];
const statuses: AssignmentStatus[] = ["Active", "Planned", "Reserved", "Retiring", "Quarantined", "Blocked"];
const l3Services: L3Service[] = ["Internet DIA", "MPLS L3VPN", "IP Transit", "Private APN", "Cloud Connect"];
const userRoles: AdminUser["role"][] = ["admin", "operator", "viewer"];
const apiBaseUrl = "http://127.0.0.1:3001";
const initialUsers: AdminUser[] = [{ id: "user-admin", username: "ipam-admin", role: "admin", status: "Active" }];
const salamFavicon = require("./assets/salam-favicon.png");
const salamLogoWhite = require("./assets/salam-logo-white.png");

type ApiPool = {
  id: string;
  cidr: string;
  name: string;
  region: string;
  source: string;
  created_at: string;
};

type ApiAssignment = {
  id: string;
  cidr: string;
  customer_name: string;
  commercial_reg_id: string;
  unified_number: string;
  contact_number: string;
  city: string;
  region: string;
  contact_name: string;
  l3_service: string;
  service: string;
  owner: string;
  site: string;
  environment: string;
  status: string;
  assignment_date: string;
  notes: string;
};

type ApiUser = {
  id: string;
  username: string;
  role: string;
  status: string;
  created_at: string;
};

type LoginResponse = {
  token: string;
  username: string;
  role: string;
};

type BulkImportResult = {
  imported: number;
  blocked: number;
  errors: string[];
};

function createAssignment(input: Omit<Assignment, keyof CidrRange | "id"> & { cidr: string }): Assignment {
  return {
    ...parseCidr(input.cidr),
    id: `asn-${Math.random().toString(16).slice(2, 9)}`,
    customerName: input.customerName,
    commercialRegId: input.commercialRegId,
    unifiedNumber: input.unifiedNumber,
    contactNumber: input.contactNumber,
    city: input.city,
    region: input.region,
    contactName: input.contactName,
    l3Service: input.l3Service,
    service: input.service,
    owner: input.owner,
    site: input.site,
    environment: input.environment,
    status: input.status,
    assignmentDate: input.assignmentDate,
    notes: input.notes
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `API request failed with HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === "string") {
        message = payload.detail;
      }
    } catch (error) {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown API error";
}

function mapApiPool(pool: ApiPool): NetworkPool {
  return {
    ...parseCidr(pool.cidr),
    id: pool.id,
    name: pool.name,
    region: pool.region,
    source: pool.source,
    createdAt: pool.created_at.slice(0, 10)
  };
}

function mapApiAssignment(assignment: ApiAssignment): Assignment {
  return {
    ...parseCidr(assignment.cidr),
    id: assignment.id,
    customerName: assignment.customer_name,
    commercialRegId: assignment.commercial_reg_id,
    unifiedNumber: assignment.unified_number,
    contactNumber: assignment.contact_number,
    city: assignment.city,
    region: assignment.region,
    contactName: assignment.contact_name,
    l3Service: normalizeL3Service(assignment.l3_service),
    service: assignment.service,
    owner: assignment.owner,
    site: assignment.site,
    environment: normalizeEnvironment(assignment.environment),
    status: normalizeAssignmentStatus(assignment.status),
    assignmentDate: assignment.assignment_date,
    notes: assignment.notes
  };
}

function mapApiUser(user: ApiUser): AdminUser {
  return {
    id: user.id,
    username: user.username,
    role: userRoles.includes(user.role as AdminUser["role"]) ? (user.role as AdminUser["role"]) : "viewer",
    status: user.status === "Disabled" ? "Disabled" : "Active",
    createdAt: user.created_at.slice(0, 10)
  };
}

function assignmentPayload(form: AssignmentForm) {
  return {
    cidr: form.cidr.trim(),
    customer_name: form.customerName.trim(),
    commercial_reg_id: form.commercialRegId.trim(),
    unified_number: form.unifiedNumber.trim(),
    contact_number: form.contactNumber.trim(),
    city: form.city.trim(),
    region: form.region.trim(),
    contact_name: form.contactName.trim(),
    l3_service: form.l3Service,
    service: form.service.trim() || "L3 service allocation",
    owner: form.owner.trim() || "Network service desk",
    site: form.site.trim() || "Unassigned site",
    environment: form.environment,
    status: form.status,
    assignment_date: form.assignmentDate.trim() || new Date().toISOString().slice(0, 10),
    notes: form.notes.trim()
  };
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("ipam-admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signedInUsername, setSignedInUsername] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [pools, setPools] = useState<NetworkPool[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [detailPoolId, setDetailPoolId] = useState("");
  const [rangePath, setRangePath] = useState<CidrRange[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [bulkPoolCsv, setBulkPoolCsv] = useState("cidr,name,region\n100.64.0.0/10,CGNAT service pool,Shared services\n198.18.0.0/15,Lab benchmark pool,Riyadh lab");
  const [bulkAssignmentCsv, setBulkAssignmentCsv] = useState("cidr,customerName,commercialRegId,unifiedNumber,contactNumber,city,region,contactName,l3Service,service,site,environment,status,assignmentDate,notes\n10.40.0.0/24,Example Customer,1019999999,7099999999,+966 55 999 9999,Riyadh,Riyadh Region,Admin Contact,MPLS L3VPN,L3 branch service,Riyadh POP,Production,Planned,2026-06-02,CSV import sample");
  const [adminMessage, setAdminMessage] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<AdminUser["role"]>("operator");
  const [passwordResetUserId, setPasswordResetUserId] = useState(initialUsers[0]?.id ?? "");
  const [passwordResetValue, setPasswordResetValue] = useState("");
  const [importText, setImportText] = useState("100.64.0.0/10\n198.18.0.0/15");
  const [poolName, setPoolName] = useState("Imported allocation");
  const [poolRegion, setPoolRegion] = useState("Unassigned region");
  const [importMessage, setImportMessage] = useState("");
  const [poolOperationMessage, setPoolOperationMessage] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [targetPrefix, setTargetPrefix] = useState("16");
  const [joinPoolId, setJoinPoolId] = useState("");
  const [search, setSearch] = useState("");
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>({
    cidr: "10.24.16.0/24",
    customerName: "New customer",
    commercialRegId: "1010000000",
    unifiedNumber: "7000000000",
    contactNumber: "+966 5X XXX XXXX",
    city: "Riyadh",
    region: "Riyadh Region",
    contactName: "Customer contact",
    l3Service: "MPLS L3VPN" as L3Service,
    service: "L3 service allocation",
    owner: "Network service desk",
    site: "Riyadh DC",
    environment: "Production" as Environment,
    status: "Planned" as AssignmentStatus,
    assignmentDate: new Date().toISOString().slice(0, 10),
    notes: ""
  });

  useEffect(() => {
    if (isAuthenticated) {
      refreshData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (pools.length === 0) {
      return;
    }

    const fallback = pools[0];
    if (!pools.some((pool) => pool.id === selectedParentId)) {
      setSelectedParentId(fallback.id);
    }
    if (!pools.some((pool) => pool.id === detailPoolId)) {
      setDetailPoolId(fallback.id);
      setRangePath([parseCidr(fallback.cidr)]);
    }
    if (!joinPoolId || !pools.some((pool) => pool.id === joinPoolId)) {
      setJoinPoolId(pools.find((pool) => pool.id !== fallback.id)?.id ?? "");
    }
  }, [detailPoolId, joinPoolId, pools, selectedParentId]);

  async function refreshData() {
    try {
      const [apiPools, apiAssignments, apiUsers] = await Promise.all([
        apiRequest<ApiPool[]>("/pools"),
        apiRequest<ApiAssignment[]>("/assignments"),
        apiRequest<ApiUser[]>("/users")
      ]);

      const nextPools = apiPools.map(mapApiPool);
      const nextAssignments = apiAssignments.map(mapApiAssignment);
      const nextUsers = apiUsers.map(mapApiUser);
      setPools(nextPools);
      setAssignments(nextAssignments);
      setUsers(nextUsers);
      setPasswordResetUserId((current) => (nextUsers.some((user) => user.id === current) ? current : nextUsers[0]?.id ?? ""));
      setApiMessage(`SQLite connected: ${nextPools.length} pools, ${nextAssignments.length} assignments`);
    } catch (error) {
      setApiMessage(`SQLite API unavailable: ${apiErrorMessage(error)}`);
    }
  }

  const selectedParent = pools.find((pool) => pool.id === selectedParentId) ?? pools[0];

  const plannedSubnets = useMemo(() => {
    if (!selectedParent) {
      return [];
    }
    const prefix = Number.parseInt(targetPrefix, 10);
    return planSubnets(selectedParent, prefix, assignments);
  }, [assignments, selectedParent, targetPrefix]);

  const conflicts = useMemo(() => findConflicts(pools, assignments), [pools, assignments]);
  const stats = useMemo(() => buildStats(pools, assignments, conflicts), [assignments, conflicts, pools]);

  const visibleAssignments = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return assignments;
    }
    return assignments.filter((assignment) =>
      [
        assignment.cidr,
        assignment.customerName,
        assignment.commercialRegId,
        assignment.unifiedNumber,
        assignment.contactNumber,
        assignment.city,
        assignment.region,
        assignment.contactName,
        assignment.l3Service,
        assignment.service,
        assignment.owner,
        assignment.site,
        assignment.environment,
        assignment.status,
        assignment.assignmentDate
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [assignments, search]);

  async function login() {
    try {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword })
      });
      setIsAuthenticated(true);
      setSignedInUsername(response.username);
      setLoginError("");
      setLoginPassword("");
    } catch (error) {
      setLoginError(`Login failed: ${apiErrorMessage(error)}. Start the FastAPI backend with npm run api:py.`);
    }
  }

  function logout() {
    setIsAuthenticated(false);
    setActiveTab("overview");
    setLoginPassword("");
    setSignedInUsername("");
  }

  async function importPools() {
    const rows = importText
      .split(/\r?\n|,/)
      .map((row) => row.trim())
      .filter(Boolean);
    const errors: string[] = [];
    const imported: NetworkPool[] = [];

    for (const [index, row] of rows.entries()) {
      try {
        const pool = await apiRequest<ApiPool>("/pools", {
          method: "POST",
          body: JSON.stringify({
            cidr: row,
            name: rows.length === 1 ? poolName.trim() || "Imported allocation" : `${poolName.trim() || "Imported allocation"} ${index + 1}`,
            region: poolRegion.trim() || "Unassigned region"
          })
        });
        imported.push(mapApiPool(pool));
      } catch (error) {
        errors.push(`${row}: ${apiErrorMessage(error)}`);
      }
    }

    if (imported.length > 0) {
      await refreshData();
      setSelectedParentId(imported[0].id);
      setDetailPoolId(imported[0].id);
      setRangePath([parseCidr(imported[0].cidr)]);
    }

    if (errors.length > 0) {
      setImportMessage(`Imported ${imported.length} pool(s). Blocked: ${errors.join("; ")}`);
    } else {
      setImportMessage(`Imported ${imported.length} pool(s) into SQLite. Conflict checks refreshed.`);
    }
  }

  async function importBulkPoolsFromCsv() {
    try {
      const result = await apiRequest<BulkImportResult>("/pools/bulk", {
        method: "POST",
        body: JSON.stringify({ csv_text: bulkPoolCsv })
      });
      await refreshData();
      setAdminMessage(`Bulk pool import: ${result.imported} imported to SQLite${result.blocked ? `, ${result.blocked} blocked (${result.errors.join("; ")})` : "."}`);
    } catch (error) {
      setAdminMessage(`Bulk pool import failed: ${apiErrorMessage(error)}`);
    }
  }

  async function importBulkAssignmentsFromCsv() {
    try {
      const result = await apiRequest<BulkImportResult>("/assignments/bulk", {
        method: "POST",
        body: JSON.stringify({ csv_text: bulkAssignmentCsv })
      });
      await refreshData();
      setAdminMessage(`Bulk assignment import: ${result.imported} imported to SQLite${result.blocked ? `, ${result.blocked} blocked (${result.errors.join("; ")})` : "."}`);
    } catch (error) {
      setAdminMessage(`Bulk assignment import failed: ${apiErrorMessage(error)}`);
    }
  }

  async function addUser() {
    const username = newUsername.trim();
    if (!username) {
      setAdminMessage("Enter a username before adding a user.");
      return;
    }
    if (newUserPassword.length < 8) {
      setAdminMessage("Enter a password with at least 8 characters.");
      return;
    }
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      setAdminMessage(`${username} already exists.`);
      return;
    }
    try {
      await apiRequest<ApiUser>("/users", {
        method: "POST",
        body: JSON.stringify({ username, password: newUserPassword, role: newUserRole })
      });
      await refreshData();
      setNewUsername("");
      setNewUserPassword("");
      setAdminMessage(`User ${username} added to SQLite.`);
    } catch (error) {
      setAdminMessage(`User was not added: ${apiErrorMessage(error)}`);
    }
  }

  async function toggleUser(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) {
      return;
    }
    const nextStatus = user.status === "Active" ? "Disabled" : "Active";
    try {
      await apiRequest<ApiUser>(`/users/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      await refreshData();
      setAdminMessage(`${user.username} is now ${nextStatus}.`);
    } catch (error) {
      setAdminMessage(`User status was not updated: ${apiErrorMessage(error)}`);
    }
  }

  async function setUserPassword() {
    if (!passwordResetUserId) {
      setAdminMessage("Select a user before setting a password.");
      return;
    }
    if (passwordResetValue.length < 8) {
      setAdminMessage("Password must be at least 8 characters.");
      return;
    }
    const user = users.find((item) => item.id === passwordResetUserId);
    try {
      await apiRequest<ApiUser>(`/users/${passwordResetUserId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: passwordResetValue })
      });
      await refreshData();
      setPasswordResetValue("");
      setAdminMessage(user ? `Password updated for ${user.username}.` : "Password updated.");
    } catch (error) {
      setAdminMessage(`Password was not updated: ${apiErrorMessage(error)}`);
    }
  }

  async function addAssignment() {
    let candidate: Assignment;
    try {
      candidate = createAssignment({
        ...assignmentForm,
        cidr: assignmentForm.cidr.trim()
      });
    } catch (error) {
      setImportMessage("Assignment was not added. Use IPv4 CIDR notation such as 10.20.0.0/24.");
      return;
    }

    const validation = validateAssignment(candidate, pools, assignments);
    if (!validation.ok) {
      setImportMessage(validation.reason);
      setActiveTab("assignments");
      return;
    }

    try {
      const saved = mapApiAssignment(await apiRequest<ApiAssignment>("/assignments", {
        method: "POST",
        body: JSON.stringify(assignmentPayload(assignmentForm))
      }));
      await refreshData();
      setAssignmentForm((current) => ({
        ...current,
        cidr: nextAvailableSuggestion(pools, [saved, ...assignments], saved.prefix),
        service: "L3 service allocation",
        notes: ""
      }));
      setImportMessage("Customer assignment saved to SQLite. Conflict checks refreshed.");
      setActiveTab("conflicts");
    } catch (error) {
      setImportMessage(`Assignment was not saved: ${apiErrorMessage(error)}`);
      setActiveTab("assignments");
    }
  }

  function requestAddAssignment() {
    setConfirmDialog({
      title: "Confirm assignment",
      message: `Assign ${assignmentForm.cidr.trim()} to ${assignmentForm.customerName.trim() || "this customer"}?`,
      confirmLabel: "Yes, assign",
      onConfirm: addAssignment
    });
  }

  async function partitionSelectedPool() {
    if (!selectedParent) {
      return;
    }
    const prefix = Number.parseInt(targetPrefix, 10);
    const children = planSubnets(selectedParent, prefix, assignments);
    const blocker = getPartitionBlocker(selectedParent, prefix, assignments);
    if (blocker) {
      setPoolOperationMessage(blocker);
      return;
    }
    if (children.length === 0 || Math.floor(selectedParent.size / prefixSize(prefix)) > 256) {
      setPoolOperationMessage("Partition not applied. Choose a target prefix that creates 256 or fewer child pools.");
      return;
    }
    try {
      const childPools = (await apiRequest<ApiPool[]>("/pools/partition", {
        method: "POST",
        body: JSON.stringify({ pool_id: selectedParent.id, target_prefix: prefix })
      })).map(mapApiPool);
      await refreshData();
      if (childPools[0]) {
        setSelectedParentId(childPools[0].id);
        setDetailPoolId(childPools[0].id);
        setRangePath([parseCidr(childPools[0].cidr)]);
      }
      setPoolOperationMessage(`Partitioned ${selectedParent.cidr} into ${childPools.length} child pools in SQLite.`);
    } catch (error) {
      setPoolOperationMessage(`Partition not applied: ${apiErrorMessage(error)}`);
    }
  }

  async function joinSelectedPools() {
    if (!selectedParent) {
      return;
    }
    const other = pools.find((pool) => pool.id === joinPoolId);
    const validation = other ? validateJoin(selectedParent, other, pools) : { ok: false, reason: "Select another pool to join." };
    if (!validation.ok || !other || !validation.joined) {
      setPoolOperationMessage(validation.reason);
      return;
    }
    try {
      const joined = mapApiPool(await apiRequest<ApiPool>("/pools/join", {
        method: "POST",
        body: JSON.stringify({ left_pool_id: selectedParent.id, right_pool_id: other.id })
      }));
      await refreshData();
      setSelectedParentId(joined.id);
      setDetailPoolId(joined.id);
      setRangePath([parseCidr(joined.cidr)]);
      setJoinPoolId("");
      setPoolOperationMessage(`Joined ${selectedParent.cidr} and ${other.cidr} into ${joined.cidr} in SQLite.`);
    } catch (error) {
      setPoolOperationMessage(`Join not applied: ${apiErrorMessage(error)}`);
    }
  }

  async function reservePlannedSubnet(subnet: PlannedSubnet) {
    const nextForm: AssignmentForm = {
      cidr: subnet.cidr,
      customerName: assignmentForm.customerName,
      commercialRegId: assignmentForm.commercialRegId,
      unifiedNumber: assignmentForm.unifiedNumber,
      contactNumber: assignmentForm.contactNumber,
      city: assignmentForm.city,
      region: assignmentForm.region,
      contactName: assignmentForm.contactName,
      l3Service: assignmentForm.l3Service,
      service: assignmentForm.service || "Reserved subnet",
      owner: assignmentForm.owner || "Network team",
      site: assignmentForm.site || selectedParent.region,
      environment: assignmentForm.environment,
      status: "Reserved",
      assignmentDate: assignmentForm.assignmentDate,
      notes: `Created from ${selectedParent.name}`
    };
    const next = createAssignment(nextForm);
    const validation = validateAssignment(next, pools, assignments);
    if (!validation.ok) {
      setPoolOperationMessage(validation.reason);
      return;
    }
    try {
      await apiRequest<ApiAssignment>("/assignments", {
        method: "POST",
        body: JSON.stringify(assignmentPayload(nextForm))
      });
      await refreshData();
      setPoolOperationMessage(`Reserved ${subnet.cidr} in SQLite.`);
      setActiveTab("assignments");
    } catch (error) {
      setPoolOperationMessage(`Reservation was not saved: ${apiErrorMessage(error)}`);
    }
  }

  async function updateAssignmentStatus(assignmentId: string, status: AssignmentStatus) {
    try {
      await apiRequest<ApiAssignment>(`/assignments/${assignmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await refreshData();
      setPoolOperationMessage(`Assignment status changed to ${status}.`);
    } catch (error) {
      setPoolOperationMessage(`Status was not updated: ${apiErrorMessage(error)}`);
    }
  }

  async function unassignRange(assignmentId: string) {
    try {
      await apiRequest<void>(`/assignments/${assignmentId}`, { method: "DELETE" });
      await refreshData();
      setPoolOperationMessage("Assignment removed from SQLite.");
    } catch (error) {
      setPoolOperationMessage(`Assignment was not removed: ${apiErrorMessage(error)}`);
    }
  }

  function requestUnassignRange(assignmentId: string) {
    const assignment = assignments.find((item) => item.id === assignmentId);
    setConfirmDialog({
      title: "Confirm unassignment",
      message: assignment
        ? `Unassign ${assignment.cidr} from ${assignment.customerName}?`
        : "Unassign this range?",
      confirmLabel: "Yes, unassign",
      destructive: true,
      onConfirm: () => unassignRange(assignmentId)
    });
  }

  function openPoolDetail(poolId: string) {
    const pool = pools.find((item) => item.id === poolId);
    setDetailPoolId(poolId);
    setSelectedParentId(poolId);
    if (pool) {
      setRangePath([parseCidr(pool.cidr)]);
    }
    setActiveTab("pool-detail");
  }

  function openRangeDrilldown(range: CidrRange) {
    setRangePath((current) => [...current, range]);
    setActiveTab("pool-detail");
  }

  function goToBreadcrumb(index: number) {
    setRangePath((current) => current.slice(0, index + 1));
  }

  function prepareAssignmentForRange(range: CidrRange) {
    setAssignmentForm((current) => ({
      ...current,
      cidr: range.cidr,
      assignmentDate: new Date().toISOString().slice(0, 10)
    }));
    setActiveTab("assignments");
  }

  function joinFreeRanges(left: CidrRange, right: CidrRange) {
    if (left.end + 1 !== right.start) {
      setPoolOperationMessage("Join blocked. Select directly adjacent free ranges.");
      return;
    }
    const joined = rangeToCidrs(left.start, right.end);
    if (joined.length !== 1) {
      setPoolOperationMessage("Join blocked. Adjacent ranges do not align to one CIDR block.");
      return;
    }
    setPoolOperationMessage(`Joined ${left.cidr} and ${right.cidr} into ${joined[0].cidr}.`);
    openRangeDrilldown(joined[0]);
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onLogin={login}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Image source={salamFavicon} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Image source={salamLogoWhite} style={styles.headerBrandImage} resizeMode="contain" />
            <View>
              <Text style={styles.kicker}>IP Address Management</Text>
              <Text style={styles.title}>NetAtlas IPAM</Text>
            </View>
          </View>
          <View style={styles.healthBadge}>
            <View style={styles.healthDot} />
            <Text style={styles.healthText}>Signed in as {signedInUsername} · {apiMessage || "SQLite sync pending"}</Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Ionicons name="log-out-outline" size={17} color="#dbeafe" />
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        <View style={styles.summaryBand}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Plan, allocate, and police IPv4 space from one console.</Text>
            <Text style={styles.heroSubtitle}>
              Import parent ranges, split or join pools, assign L3 services to customers, and block conflicts before they ship.
            </Text>
          </View>
          <View style={styles.capacityPanel}>
            <Text style={styles.capacityLabel}>Total managed space</Text>
            <Text style={styles.capacityNumber}>{formatHosts(stats.totalAddresses)}</Text>
            <Text style={styles.capacityMeta}>{stats.poolCount} parent pools</Text>
          </View>
        </View>

        <View style={styles.tabs}>
          <TabButton id="overview" activeTab={activeTab} icon="analytics-outline" label="Overview" onPress={setActiveTab} />
          <TabButton id="subnetting" activeTab={activeTab} icon="cut-outline" label="Subnetting" onPress={setActiveTab} />
          <TabButton id="assignments" activeTab={activeTab} icon="business-outline" label="Assignments" onPress={setActiveTab} />
          <TabButton id="conflicts" activeTab={activeTab} icon="warning-outline" label="Conflicts" onPress={setActiveTab} count={conflicts.length} />
          <TabButton id="admin" activeTab={activeTab} icon="shield-outline" label="Admin" onPress={setActiveTab} />
        </View>

        {activeTab === "overview" ? (
          <Overview
            stats={stats}
            pools={pools}
            assignments={assignments}
            conflicts={conflicts}
            importText={importText}
            poolName={poolName}
            poolRegion={poolRegion}
            importMessage={importMessage}
            onImportTextChange={setImportText}
            onPoolNameChange={setPoolName}
            onPoolRegionChange={setPoolRegion}
            onImport={importPools}
            onOpenPool={openPoolDetail}
          />
        ) : null}

        {activeTab === "subnetting" && selectedParent ? (
          <Subnetting
            pools={pools}
            selectedParent={selectedParent}
            selectedParentId={selectedParentId}
            targetPrefix={targetPrefix}
            joinPoolId={joinPoolId}
            operationMessage={poolOperationMessage}
            plannedSubnets={plannedSubnets}
            onParentChange={setSelectedParentId}
            onTargetPrefixChange={setTargetPrefix}
            onJoinPoolChange={setJoinPoolId}
            onPartition={partitionSelectedPool}
            onJoin={joinSelectedPools}
            onReserve={reservePlannedSubnet}
          />
        ) : null}

        {activeTab === "assignments" ? (
          <Assignments
            assignments={visibleAssignments}
            form={assignmentForm}
            search={search}
            onSearchChange={setSearch}
            onFormChange={setAssignmentForm}
            onAdd={requestAddAssignment}
            onUnassign={requestUnassignRange}
            onSetStatus={updateAssignmentStatus}
          />
        ) : null}

        {activeTab === "conflicts" ? <Conflicts conflicts={conflicts} pools={pools} assignments={assignments} /> : null}

        {activeTab === "admin" ? (
          <AdminPanel
            bulkPoolCsv={bulkPoolCsv}
            bulkAssignmentCsv={bulkAssignmentCsv}
            adminMessage={adminMessage}
            users={users}
            newUsername={newUsername}
            newUserPassword={newUserPassword}
            newUserRole={newUserRole}
            passwordResetUserId={passwordResetUserId}
            passwordResetValue={passwordResetValue}
            onBulkPoolCsvChange={setBulkPoolCsv}
            onBulkAssignmentCsvChange={setBulkAssignmentCsv}
            onImportPools={importBulkPoolsFromCsv}
            onImportAssignments={importBulkAssignmentsFromCsv}
            onNewUsernameChange={setNewUsername}
            onNewUserPasswordChange={setNewUserPassword}
            onNewUserRoleChange={setNewUserRole}
            onPasswordResetUserChange={setPasswordResetUserId}
            onPasswordResetValueChange={setPasswordResetValue}
            onAddUser={addUser}
            onSetUserPassword={setUserPassword}
            onToggleUser={toggleUser}
          />
        ) : null}

        {activeTab === "pool-detail" ? (
          <PoolDetail
            pool={pools.find((pool) => pool.id === detailPoolId) ?? selectedParent}
            assignments={assignments}
            path={rangePath}
            onBack={() => setActiveTab("overview")}
            onBreadcrumb={goToBreadcrumb}
            onOpenRange={openRangeDrilldown}
            onAssignRange={prepareAssignmentForRange}
            onJoinFreeRanges={joinFreeRanges}
            onUnassign={requestUnassignRange}
            onSetStatus={updateAssignmentStatus}
          />
        ) : null}
      </ScrollView>
      <ConfirmDialog
        dialog={confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const action = confirmDialog?.onConfirm;
          setConfirmDialog(null);
          action?.();
        }}
      />
    </SafeAreaView>
  );
}

function LoginScreen({
  username,
  password,
  error,
  onUsernameChange,
  onPasswordChange,
  onLogin
}: {
  username: string;
  password: string;
  error: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.loginPage}>
        <View style={styles.loginCard}>
          <View style={styles.logoMark}>
            <Image source={salamFavicon} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Image source={salamLogoWhite} style={styles.loginBrandImage} resizeMode="contain" />
          <Text style={styles.loginTitle}>NetAtlas IPAM</Text>
          <Text style={styles.loginSubtitle}>Admin access required</Text>
          <TextInput
            value={username}
            onChangeText={onUsernameChange}
            style={styles.input}
            placeholder="Admin username"
            placeholderTextColor="#8da2ba"
            autoCapitalize="none"
          />
          <TextInput
            value={password}
            onChangeText={onPasswordChange}
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#8da2ba"
            secureTextEntry
          />
          <Pressable style={styles.primaryButton} onPress={onLogin}>
            <Ionicons name="log-in-outline" size={19} color="#ffffff" />
            <Text style={styles.primaryButtonText}>Login</Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function AdminPanel({
  bulkPoolCsv,
  bulkAssignmentCsv,
  adminMessage,
  users,
  newUsername,
  newUserPassword,
  newUserRole,
  passwordResetUserId,
  passwordResetValue,
  onBulkPoolCsvChange,
  onBulkAssignmentCsvChange,
  onImportPools,
  onImportAssignments,
  onNewUsernameChange,
  onNewUserPasswordChange,
  onNewUserRoleChange,
  onPasswordResetUserChange,
  onPasswordResetValueChange,
  onAddUser,
  onSetUserPassword,
  onToggleUser
}: {
  bulkPoolCsv: string;
  bulkAssignmentCsv: string;
  adminMessage: string;
  users: AdminUser[];
  newUsername: string;
  newUserPassword: string;
  newUserRole: AdminUser["role"];
  passwordResetUserId: string;
  passwordResetValue: string;
  onBulkPoolCsvChange: (value: string) => void;
  onBulkAssignmentCsvChange: (value: string) => void;
  onImportPools: () => void;
  onImportAssignments: () => void;
  onNewUsernameChange: (value: string) => void;
  onNewUserPasswordChange: (value: string) => void;
  onNewUserRoleChange: (value: AdminUser["role"]) => void;
  onPasswordResetUserChange: (value: string) => void;
  onPasswordResetValueChange: (value: string) => void;
  onAddUser: () => void;
  onSetUserPassword: () => void;
  onToggleUser: (userId: string) => void;
}) {
  return (
    <View style={styles.contentStack}>
      <SectionHeader icon="shield-outline" title="Admin Operations" subtitle="Bulk load parent pools and customer assignments with CSV. Invalid or conflicting rows are blocked." />
      <View style={styles.formPanel}>
        <Text style={styles.label}>Bulk parent pools CSV</Text>
        <Text style={styles.csvHint}>Required columns: cidr,name,region</Text>
        <TextInput
          value={bulkPoolCsv}
          onChangeText={onBulkPoolCsvChange}
          multiline
          style={[styles.input, styles.csvInput]}
          autoCapitalize="none"
        />
        <Pressable style={styles.primaryButton} onPress={onImportPools}>
          <Ionicons name="cloud-upload-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Import pool CSV</Text>
        </Pressable>
      </View>

      <View style={styles.formPanel}>
        <Text style={styles.label}>Bulk customer assignments CSV</Text>
        <Text style={styles.csvHint}>Required columns include cidr, customerName, commercialRegId, unifiedNumber, contactNumber, city, region, contactName.</Text>
        <TextInput
          value={bulkAssignmentCsv}
          onChangeText={onBulkAssignmentCsvChange}
          multiline
          style={[styles.input, styles.csvInputLarge]}
          autoCapitalize="none"
        />
        <Pressable style={styles.primaryButton} onPress={onImportAssignments}>
          <Ionicons name="document-text-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Import assignment CSV</Text>
        </Pressable>
        {adminMessage ? <Text style={styles.formHint}>{adminMessage}</Text> : null}
      </View>

      <SectionHeader icon="people-outline" title="User Management" subtitle="Create local admin users and enable or disable access for the prototype." />
      <View style={styles.formPanel}>
        <View style={styles.twoColumn}>
          <TextInput
            value={newUsername}
            onChangeText={onNewUsernameChange}
            style={[styles.input, styles.flexInput]}
            placeholder="Username"
            placeholderTextColor="#8da2ba"
            autoCapitalize="none"
          />
          <TextInput
            value={newUserPassword}
            onChangeText={onNewUserPasswordChange}
            style={[styles.input, styles.flexInput]}
            placeholder="Initial password"
            placeholderTextColor="#8da2ba"
            secureTextEntry
          />
        </View>
        <View style={styles.twoColumn}>
          <View style={styles.flexInput}>
            <ChipGroup values={userRoles} selected={newUserRole} onSelect={onNewUserRoleChange} />
          </View>
        </View>
        <Pressable style={styles.secondaryButton} onPress={onAddUser}>
          <Ionicons name="person-add-outline" size={17} color="#dbeafe" />
          <Text style={styles.secondaryButtonText}>Add user</Text>
        </Pressable>
        <View style={styles.divider} />
        <Text style={styles.label}>Set password for existing user</Text>
        <View style={styles.chipGroup}>
          {users.map((user) => (
            <Pressable key={user.id} style={[styles.chip, passwordResetUserId === user.id && styles.chipActive]} onPress={() => onPasswordResetUserChange(user.id)}>
              <Text style={[styles.chipText, passwordResetUserId === user.id && styles.chipTextActive]}>{user.username}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.twoColumn}>
          <TextInput
            value={passwordResetValue}
            onChangeText={onPasswordResetValueChange}
            style={[styles.input, styles.flexInput]}
            placeholder="New password"
            placeholderTextColor="#8da2ba"
            secureTextEntry
          />
          <Pressable style={styles.secondaryButton} onPress={onSetUserPassword}>
            <Ionicons name="key-outline" size={17} color="#dbeafe" />
            <Text style={styles.secondaryButtonText}>Set password</Text>
          </Pressable>
        </View>
        <View style={styles.assignmentList}>
          {users.map((user) => (
            <View key={user.id} style={styles.userRow}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{user.username}</Text>
                <Text style={styles.rowMeta}>{user.role} Â· {user.status}</Text>
              </View>
              <Pressable style={styles.smallActionButton} onPress={() => onToggleUser(user.id)}>
                <Ionicons name={user.status === "Active" ? "pause-circle-outline" : "play-circle-outline"} size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>{user.status === "Active" ? "Disable" : "Enable"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Overview({
  stats,
  pools,
  assignments,
  conflicts,
  importText,
  poolName,
  poolRegion,
  importMessage,
  onImportTextChange,
  onPoolNameChange,
  onPoolRegionChange,
  onImport,
  onOpenPool
}: {
  stats: ReturnType<typeof buildStats>;
  pools: NetworkPool[];
  assignments: Assignment[];
  conflicts: Conflict[];
  importText: string;
  poolName: string;
  poolRegion: string;
  importMessage: string;
  onImportTextChange: (value: string) => void;
  onPoolNameChange: (value: string) => void;
  onPoolRegionChange: (value: string) => void;
  onImport: () => void;
  onOpenPool: (poolId: string) => void;
}) {
  return (
    <View style={styles.contentStack}>
      <View style={styles.metricGrid}>
        <MetricCard label="Utilized" value={`${stats.utilizationPercent}%`} detail={`${formatHosts(stats.assignedAddresses)} assigned`} icon="speedometer-outline" tone="#0e7c66" />
        <MetricCard label="Conflicts" value={String(conflicts.length)} detail={`${stats.criticalConflicts} critical`} icon="warning-outline" tone="#b42318" />
        <MetricCard label="Customers" value={String(stats.customers)} detail={`${assignments.length} allocations`} icon="people-outline" tone="#5746af" />
        <MetricCard label="Largest free block" value={stats.largestFreeBlock} detail="estimated from managed pools" icon="cube-outline" tone="#2662a6" />
      </View>

      <SectionHeader icon="cloud-upload-outline" title="Load Big Subnets" subtitle="Paste one CIDR per line or comma separated. The engine normalizes ranges and immediately recalculates conflicts." />
      <View style={styles.formPanel}>
        <TextInput value={poolName} onChangeText={onPoolNameChange} style={styles.input} placeholder="Pool name" placeholderTextColor="#8da2ba" />
        <TextInput value={poolRegion} onChangeText={onPoolRegionChange} style={styles.input} placeholder="Region or site" placeholderTextColor="#8da2ba" />
        <TextInput
          value={importText}
          onChangeText={onImportTextChange}
          multiline
          style={[styles.input, styles.textArea]}
          placeholder="10.0.0.0/8"
          placeholderTextColor="#8da2ba"
          autoCapitalize="none"
        />
        <Pressable style={styles.primaryButton} onPress={onImport}>
          <Ionicons name="add-circle-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Import pools</Text>
        </Pressable>
        {importMessage ? <Text style={styles.formHint}>{importMessage}</Text> : null}
      </View>

      <SectionHeader icon="layers-outline" title="Parent Address Pools" subtitle="Large blocks stay compact in the UI while capacity and assignment math are still calculated exactly." />
      <View style={styles.table}>
        {pools.map((pool) => {
          const assigned = assignments.filter((assignment) => containsRange(pool, assignment)).reduce((sum, assignment) => sum + assignment.size, 0);
          const usedPercent = Math.min(100, Math.round((assigned / pool.size) * 1000) / 10);
          return (
            <Pressable key={pool.id} style={styles.poolRow} onPress={() => onOpenPool(pool.id)}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{pool.cidr}</Text>
                <Text style={styles.rowMeta}>{pool.name} Â· {pool.region}</Text>
              </View>
              <View style={styles.rowSide}>
                <Text style={styles.rowTitle}>{usedPercent}%</Text>
                <Text style={styles.rowMeta}>{formatHosts(pool.size)} IPs Â· open</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Subnetting({
  pools,
  selectedParent,
  selectedParentId,
  targetPrefix,
  joinPoolId,
  operationMessage,
  plannedSubnets,
  onParentChange,
  onTargetPrefixChange,
  onJoinPoolChange,
  onPartition,
  onJoin,
  onReserve
}: {
  pools: NetworkPool[];
  selectedParent: NetworkPool;
  selectedParentId: string;
  targetPrefix: string;
  joinPoolId: string;
  operationMessage: string;
  plannedSubnets: PlannedSubnet[];
  onParentChange: (id: string) => void;
  onTargetPrefixChange: (value: string) => void;
  onJoinPoolChange: (id: string) => void;
  onPartition: () => void;
  onJoin: () => void;
  onReserve: (subnet: PlannedSubnet) => void;
}) {
  const totalChildren = Math.pow(2, Math.max(0, Number.parseInt(targetPrefix || "0", 10) - selectedParent.prefix));
  const shownChildren = plannedSubnets.length;
  const joinCandidates = pools.filter((pool) => pool.id !== selectedParentId);

  return (
    <View style={styles.contentStack}>
      <SectionHeader icon="git-branch-outline" title="Partition or Join Pools" subtitle="Admins can split a free parent pool into child pools or join two adjacent pools. Operations are blocked when they would hide or overlap customer allocations." />
      <View style={styles.formPanel}>
        <Text style={styles.label}>Parent pool</Text>
        <View style={styles.chipGroup}>
          {pools.map((pool) => (
            <Pressable key={pool.id} style={[styles.chip, selectedParentId === pool.id && styles.chipActive]} onPress={() => onParentChange(pool.id)}>
              <Text style={[styles.chipText, selectedParentId === pool.id && styles.chipTextActive]}>{pool.cidr}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Target subnet prefix</Text>
        <TextInput
          value={targetPrefix}
          onChangeText={onTargetPrefixChange}
          style={styles.input}
          keyboardType="number-pad"
          placeholder="24"
          placeholderTextColor="#8da2ba"
        />
        <View style={styles.plannerSummary}>
          <View>
            <Text style={styles.rowTitle}>{formatHosts(prefixSize(Number.parseInt(targetPrefix || "32", 10)))} IPs per block</Text>
            <Text style={styles.rowMeta}>Showing {shownChildren} of {Number.isFinite(totalChildren) ? formatHosts(totalChildren) : "0"} possible child subnets</Text>
          </View>
          <Text style={styles.statusPill}>max 256 rendered</Text>
        </View>
        <Pressable style={styles.primaryButton} onPress={onPartition}>
          <Ionicons name="git-branch-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Apply partition</Text>
        </Pressable>
      </View>

      <View style={styles.formPanel}>
        <SectionHeader icon="git-merge-outline" title="Join Pools" subtitle="Select a second pool. Join is allowed only for adjacent pools with the same prefix and no overlap with other parent pools." />
        <View style={styles.chipGroup}>
          {joinCandidates.map((pool) => (
            <Pressable key={pool.id} style={[styles.chip, joinPoolId === pool.id && styles.chipActive]} onPress={() => onJoinPoolChange(pool.id)}>
              <Text style={[styles.chipText, joinPoolId === pool.id && styles.chipTextActive]}>{pool.cidr}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.secondaryButton} onPress={onJoin}>
          <Ionicons name="git-merge-outline" size={17} color="#dbeafe" />
          <Text style={styles.secondaryButtonText}>Join selected pools</Text>
        </Pressable>
        {operationMessage ? <Text style={styles.formHint}>{operationMessage}</Text> : null}
      </View>

      <View style={styles.subnetGrid}>
        {plannedSubnets.map((subnet) => (
          <View key={subnet.cidr} style={[styles.subnetCard, !subnet.available && styles.subnetCardBlocked]}>
            <View style={styles.subnetHeader}>
              <Text style={styles.subnetCidr}>{subnet.cidr}</Text>
              <Text style={[styles.availability, subnet.available ? styles.available : styles.blocked]}>
                {subnet.available ? "Available" : "In use"}
              </Text>
            </View>
            <Text style={styles.rowMeta}>{subnet.firstUsable} - {subnet.lastUsable}</Text>
            <Text style={styles.rowMeta}>{formatHosts(subnet.size)} addresses</Text>
            {subnet.blockingAssignments.length > 0 ? (
              <Text style={styles.blockingText}>Blocks: {subnet.blockingAssignments.join(", ")}</Text>
            ) : (
              <Pressable style={styles.secondaryButton} onPress={() => onReserve(subnet)}>
                <Ionicons name="bookmark-outline" size={17} color="#dbeafe" />
                <Text style={styles.secondaryButtonText}>Reserve</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function Assignments({
  assignments,
  form,
  search,
  onSearchChange,
  onFormChange,
  onAdd,
  onUnassign,
  onSetStatus
}: {
  assignments: Assignment[];
  form: AssignmentForm;
  search: string;
  onSearchChange: (value: string) => void;
  onFormChange: (value: AssignmentForm) => void;
  onAdd: () => void;
  onUnassign: (assignmentId: string) => void;
  onSetStatus: (assignmentId: string, status: AssignmentStatus) => void;
}) {
  function update<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    onFormChange({ ...form, [key]: value });
  }

  return (
    <View style={styles.contentStack}>
      <SectionHeader icon="create-outline" title="Assign L3 Service to Customer" subtitle="Customer allocations are saved only when the CIDR sits inside a managed parent pool and does not overlap another customer." />
      <View style={styles.formPanel}>
        <View style={styles.twoColumn}>
          <TextInput value={form.cidr} onChangeText={(value) => update("cidr", value)} style={[styles.input, styles.flexInput]} placeholder="CIDR block" placeholderTextColor="#8da2ba" autoCapitalize="none" />
          <TextInput value={form.customerName} onChangeText={(value) => update("customerName", value)} style={[styles.input, styles.flexInput]} placeholder="Customer name" placeholderTextColor="#8da2ba" />
        </View>
        <View style={styles.twoColumn}>
          <TextInput value={form.commercialRegId} onChangeText={(value) => update("commercialRegId", value)} style={[styles.input, styles.flexInput]} placeholder="Commercial reg ID" placeholderTextColor="#8da2ba" />
          <TextInput value={form.unifiedNumber} onChangeText={(value) => update("unifiedNumber", value)} style={[styles.input, styles.flexInput]} placeholder="Unified number" placeholderTextColor="#8da2ba" />
        </View>
        <View style={styles.twoColumn}>
          <TextInput value={form.contactName} onChangeText={(value) => update("contactName", value)} style={[styles.input, styles.flexInput]} placeholder="Contact name" placeholderTextColor="#8da2ba" />
          <TextInput value={form.contactNumber} onChangeText={(value) => update("contactNumber", value)} style={[styles.input, styles.flexInput]} placeholder="Contact number" placeholderTextColor="#8da2ba" />
        </View>
        <View style={styles.twoColumn}>
          <TextInput value={form.city} onChangeText={(value) => update("city", value)} style={[styles.input, styles.flexInput]} placeholder="City" placeholderTextColor="#8da2ba" />
          <TextInput value={form.region} onChangeText={(value) => update("region", value)} style={[styles.input, styles.flexInput]} placeholder="Region" placeholderTextColor="#8da2ba" />
        </View>
        <Text style={styles.label}>L3 service</Text>
        <ChipGroup values={l3Services} selected={form.l3Service} onSelect={(value) => update("l3Service", value)} />
        <View style={styles.twoColumn}>
          <TextInput value={form.service} onChangeText={(value) => update("service", value)} style={[styles.input, styles.flexInput]} placeholder="Service description" placeholderTextColor="#8da2ba" />
          <TextInput value={form.site} onChangeText={(value) => update("site", value)} style={[styles.input, styles.flexInput]} placeholder="Site" placeholderTextColor="#8da2ba" />
        </View>
        <TextInput value={form.assignmentDate} onChangeText={(value) => update("assignmentDate", value)} style={styles.input} placeholder="Assignment date YYYY-MM-DD" placeholderTextColor="#8da2ba" />
        <Text style={styles.label}>Environment</Text>
        <ChipGroup values={environments} selected={form.environment} onSelect={(value) => update("environment", value as Environment)} />
        <Text style={styles.label}>Status</Text>
        <ChipGroup values={statuses} selected={form.status} onSelect={(value) => update("status", value as AssignmentStatus)} />
        <TextInput value={form.notes} onChangeText={(value) => update("notes", value)} style={[styles.input, styles.notesInput]} placeholder="Notes" placeholderTextColor="#8da2ba" />
        <Pressable style={styles.primaryButton} onPress={onAdd}>
          <Ionicons name="save-outline" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>Save assignment</Text>
        </Pressable>
      </View>

      <View style={styles.assignmentToolbar}>
        <TextInput value={search} onChangeText={onSearchChange} style={[styles.input, styles.searchInput]} placeholder="Search assignments" placeholderTextColor="#8da2ba" />
      </View>
      <View style={styles.assignmentList}>
        {assignments.map((assignment) => (
          <View key={assignment.id} style={styles.assignmentCard}>
            <View style={styles.assignmentTop}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{assignment.cidr}</Text>
                <Text style={styles.rowMeta}>{assignment.customerName} Â· {assignment.l3Service} Â· {assignment.service}</Text>
              </View>
              <Text style={styles.statusPill}>{assignment.status}</Text>
            </View>
            <View style={styles.detailGrid}>
              <Detail label="CR ID" value={assignment.commercialRegId} />
              <Detail label="Unified no." value={assignment.unifiedNumber} />
              <Detail label="Contact" value={assignment.contactName} />
              <Detail label="Phone" value={assignment.contactNumber} />
              <Detail label="City" value={assignment.city} />
              <Detail label="Region" value={assignment.region} />
              <Detail label="Site" value={assignment.site} />
              <Detail label="Environment" value={assignment.environment} />
              <Detail label="Assigned" value={assignment.assignmentDate} />
              <Detail label="Capacity" value={`${formatHosts(assignment.size)} IPs`} />
            </View>
            <View style={styles.actionRow}>
              <Pressable style={styles.smallActionButton} onPress={() => onSetStatus(assignment.id, "Quarantined")}>
                <Ionicons name="pause-circle-outline" size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>Quarantine</Text>
              </Pressable>
              <Pressable style={styles.smallActionButton} onPress={() => onSetStatus(assignment.id, "Blocked")}>
                <Ionicons name="ban-outline" size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>Block</Text>
              </Pressable>
              <Pressable style={[styles.smallActionButton, styles.dangerActionButton]} onPress={() => onUnassign(assignment.id)}>
                <Ionicons name="trash-outline" size={16} color="#b42318" />
                <Text style={[styles.smallActionText, styles.dangerActionText]}>Unassign</Text>
              </Pressable>
            </View>
            {assignment.notes ? <Text style={styles.notesText}>{assignment.notes}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function PoolDetail({
  pool,
  assignments,
  path,
  onBack,
  onBreadcrumb,
  onOpenRange,
  onAssignRange,
  onJoinFreeRanges,
  onUnassign,
  onSetStatus
}: {
  pool?: NetworkPool;
  assignments: Assignment[];
  path: CidrRange[];
  onBack: () => void;
  onBreadcrumb: (index: number) => void;
  onOpenRange: (range: CidrRange) => void;
  onAssignRange: (range: CidrRange) => void;
  onJoinFreeRanges: (left: CidrRange, right: CidrRange) => void;
  onUnassign: (assignmentId: string) => void;
  onSetStatus: (assignmentId: string, status: AssignmentStatus) => void;
}) {
  if (!pool) {
    return (
      <View style={styles.emptyPanel}>
        <Text style={styles.emptyTitle}>Pool not found</Text>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back to pools</Text>
        </Pressable>
      </View>
    );
  }

  const currentRange = path[path.length - 1] ?? parseCidr(pool.cidr);
  const containedAssignments = assignments
    .filter((assignment) => containsRange(currentRange, assignment))
    .sort((left, right) => left.start - right.start);
  const freeRanges = calculateFreeSubranges(currentRange, containedAssignments);
  const displayedFreeRanges =
    containedAssignments.length === 0 && currentRange.prefix < 30 ? splitRangeChildren(currentRange) : freeRanges;
  const assignedTotal = containedAssignments.reduce((sum, assignment) => sum + assignment.size, 0);
  const utilization = Math.min(100, Math.round((assignedTotal / currentRange.size) * 1000) / 10);

  return (
    <View style={styles.contentStack}>
      <View style={styles.detailHeader}>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Ionicons name="arrow-back-outline" size={17} color="#dbeafe" />
          <Text style={styles.secondaryButtonText}>Pools</Text>
        </Pressable>
        <View style={styles.rowMain}>
          <View style={styles.breadcrumbRow}>
            {path.map((crumb, index) => (
              <Pressable key={`${crumb.cidr}-${index}`} style={styles.breadcrumbCrumb} onPress={() => onBreadcrumb(index)}>
                <Text style={[styles.breadcrumbText, index === path.length - 1 && styles.breadcrumbTextActive]}>
                  {index === 0 ? "Pool" : "Subrange"} {crumb.cidr}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionTitle}>{currentRange.cidr}</Text>
          <Text style={styles.sectionSubtitle}>{pool.name} · {pool.region} · {utilization}% utilized · {formatHosts(currentRange.size)} addresses</Text>
        </View>
      </View>

      <SectionHeader icon="radio-button-on-outline" title="Assigned Ranges" subtitle="Customer, quarantined, and blocked allocations currently occupying this range." />
      <View style={styles.assignmentList}>
        {containedAssignments.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>No assigned ranges</Text>
            <Text style={styles.emptyText}>This range is fully available for subnet planning.</Text>
          </View>
        ) : (
          containedAssignments.map((assignment) => (
            <Pressable key={assignment.id} style={styles.assignmentCard} onPress={() => onOpenRange(assignment)}>
              <View style={styles.assignmentTop}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{assignment.cidr}</Text>
                  <Text style={styles.rowMeta}>{assignment.customerName} · {assignment.l3Service} · assigned {assignment.assignmentDate}</Text>
                </View>
                <Text style={styles.statusPill}>{assignment.status}</Text>
              </View>
              <View style={styles.actionRow}>
                <Pressable style={styles.smallActionButton} onPress={() => onOpenRange(assignment)}>
                  <Ionicons name="enter-outline" size={16} color="#dbeafe" />
                  <Text style={styles.smallActionText}>Open</Text>
                </Pressable>
                <Pressable style={styles.smallActionButton} onPress={() => onSetStatus(assignment.id, "Quarantined")}>
                  <Ionicons name="pause-circle-outline" size={16} color="#dbeafe" />
                  <Text style={styles.smallActionText}>Quarantine</Text>
                </Pressable>
                <Pressable style={styles.smallActionButton} onPress={() => onSetStatus(assignment.id, "Blocked")}>
                  <Ionicons name="ban-outline" size={16} color="#dbeafe" />
                  <Text style={styles.smallActionText}>Block</Text>
                </Pressable>
                <Pressable style={[styles.smallActionButton, styles.dangerActionButton]} onPress={() => onUnassign(assignment.id)}>
                  <Ionicons name="trash-outline" size={16} color="#b42318" />
                  <Text style={[styles.smallActionText, styles.dangerActionText]}>Unassign</Text>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </View>

      <SectionHeader icon="ellipse-outline" title="Unassigned Subranges" subtitle="Free CIDR ranges inside this range after subtracting all current assignments." />
      <View style={styles.subnetGrid}>
        {displayedFreeRanges.map((range, index) => {
          const nextRange = displayedFreeRanges[index + 1];
          const canJoinNext = Boolean(nextRange && range.end + 1 === nextRange.start);
          return (
          <Pressable key={range.cidr} style={styles.subnetCard} onPress={() => onOpenRange(range)}>
            <View style={styles.subnetHeader}>
              <Text style={styles.subnetCidr}>{range.cidr}</Text>
              <Text style={[styles.availability, styles.available]}>Free</Text>
            </View>
            <Text style={styles.rowMeta}>{range.firstUsable} - {range.lastUsable}</Text>
            <Text style={styles.rowMeta}>{formatHosts(range.size)} addresses</Text>
            <View style={styles.actionRow}>
              <Pressable style={styles.smallActionButton} onPress={() => onOpenRange(range)}>
                <Ionicons name="enter-outline" size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>Open</Text>
              </Pressable>
              <Pressable style={styles.smallActionButton} onPress={() => onOpenRange(range)}>
                <Ionicons name="git-branch-outline" size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>Split</Text>
              </Pressable>
              <Pressable style={styles.smallActionButton} onPress={() => onAssignRange(range)}>
                <Ionicons name="person-add-outline" size={16} color="#dbeafe" />
                <Text style={styles.smallActionText}>Assign</Text>
              </Pressable>
              {canJoinNext ? (
                <Pressable style={styles.smallActionButton} onPress={() => nextRange && onJoinFreeRanges(range, nextRange)}>
                  <Ionicons name="git-merge-outline" size={16} color="#dbeafe" />
                  <Text style={styles.smallActionText}>Join next</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        );
        })}
      </View>
    </View>
  );
}

function Conflicts({ conflicts, pools, assignments }: { conflicts: Conflict[]; pools: NetworkPool[]; assignments: Assignment[] }) {
  return (
    <View style={styles.contentStack}>
      <SectionHeader icon="shield-checkmark-outline" title="Conflict Management" subtitle="Overlap, duplicate allocation, and out-of-policy checks across imported parent pools and customer L3 assignments." />
      {conflicts.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Ionicons name="checkmark-circle-outline" size={42} color="#0e7c66" />
          <Text style={styles.emptyTitle}>No conflicts detected</Text>
          <Text style={styles.emptyText}>All {assignments.length} assignments are covered by {pools.length} managed parent pool(s).</Text>
        </View>
      ) : (
        conflicts.map((conflict) => (
          <View key={conflict.id} style={[styles.conflictCard, conflict.severity === "critical" && styles.conflictCritical]}>
            <View style={styles.conflictTop}>
              <SeverityBadge severity={conflict.severity} />
              <Text style={styles.conflictTitle}>{conflict.title}</Text>
            </View>
            <Text style={styles.conflictDetail}>{conflict.detail}</Text>
            <View style={styles.conflictRangeRow}>
              {conflict.ranges.map((range) => (
                <Text key={range} style={styles.conflictRange}>{range}</Text>
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function TabButton({
  id,
  activeTab,
  icon,
  label,
  count,
  onPress
}: {
  id: TabId;
  activeTab: TabId;
  icon: IconName;
  label: string;
  count?: number;
  onPress: (id: TabId) => void;
}) {
  const active = activeTab === id;
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={() => onPress(id)}>
      <Ionicons name={icon} size={18} color={active ? "#ffffff" : "#16324f"} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      {count ? <Text style={[styles.tabCount, active && styles.tabCountActive]}>{count}</Text> : null}
    </Pressable>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: IconName; tone: string }) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: tone }]}>
        <Ionicons name={icon} size={20} color="#ffffff" />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: IconName; title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name={icon} size={20} color="#2662a6" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

function ChipGroup<T extends string>({ values, selected, onSelect }: { values: readonly T[]; selected: T; onSelect: (value: T) => void }) {
  return (
    <View style={styles.chipGroup}>
      {values.map((value) => (
        <Pressable key={value} style={[styles.chip, selected === value && styles.chipActive]} onPress={() => onSelect(value)}>
          <Text style={[styles.chipText, selected === value && styles.chipTextActive]}>{value}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ConfirmDialog({
  dialog,
  onCancel,
  onConfirm
}: {
  dialog: ConfirmDialogState | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal transparent visible={dialog !== null} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{dialog?.title}</Text>
          <Text style={styles.confirmMessage}>{dialog?.message}</Text>
          <View style={styles.confirmActions}>
            <Pressable style={styles.noButton} onPress={onCancel}>
              <Text style={styles.noButtonText}>No</Text>
            </Pressable>
            <Pressable
              style={[styles.yesButton, dialog?.destructive && styles.yesButtonDanger]}
              onPress={onConfirm}
            >
              <Text style={styles.yesButtonText}>{dialog?.confirmLabel ?? "Yes"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const color = severity === "critical" ? "#b42318" : severity === "warning" ? "#b76e00" : "#2662a6";
  return (
    <View style={[styles.severityBadge, { backgroundColor: color }]}>
      <Text style={styles.severityText}>{severity.toUpperCase()}</Text>
    </View>
  );
}

function calculateFreeSubranges(pool: CidrRange, assignments: Assignment[]) {
  const occupied = assignments
    .filter((assignment) => containsRange(pool, assignment))
    .sort((left, right) => left.start - right.start);
  const freeIntervals: Array<{ start: number; end: number }> = [];
  let cursor = pool.start;

  occupied.forEach((assignment) => {
    if (assignment.start > cursor) {
      freeIntervals.push({ start: cursor, end: assignment.start - 1 });
    }
    cursor = Math.max(cursor, assignment.end + 1);
  });

  if (cursor <= pool.end) {
    freeIntervals.push({ start: cursor, end: pool.end });
  }

  return freeIntervals.flatMap((interval) => rangeToCidrs(interval.start, interval.end)).slice(0, 256);
}

function splitRangeChildren(range: CidrRange) {
  const childPrefix = Math.min(30, range.prefix + 1);
  const childSize = prefixSize(childPrefix);
  const childCount = Math.min(256, Math.floor(range.size / childSize));
  return Array.from({ length: childCount }, (_, index) => {
    const start = range.start + index * childSize;
    const end = start + childSize - 1;
    return {
      cidr: `${numberToIp(start)}/${childPrefix}`,
      start,
      end,
      prefix: childPrefix,
      size: childSize,
      firstUsable: numberToIp(childPrefix >= 31 ? start : start + 1),
      lastUsable: numberToIp(childPrefix >= 31 ? end : end - 1)
    };
  });
}

function rangeToCidrs(start: number, end: number): CidrRange[] {
  const ranges: CidrRange[] = [];
  let current = start;

  while (current <= end && ranges.length < 256) {
    let maxSize = largestAlignedBlockSize(current);
    const remaining = end - current + 1;
    while (maxSize > remaining) {
      maxSize = maxSize / 2;
    }
    const prefix = sizeToPrefix(maxSize);
    const rangeEnd = current + maxSize - 1;
    ranges.push({
      cidr: `${numberToIp(current)}/${prefix}`,
      start: current,
      end: rangeEnd,
      prefix,
      size: maxSize,
      firstUsable: numberToIp(prefix >= 31 ? current : current + 1),
      lastUsable: numberToIp(prefix >= 31 ? rangeEnd : rangeEnd - 1)
    });
    current = rangeEnd + 1;
  }

  return ranges;
}

function largestAlignedBlockSize(start: number) {
  let size = 1;
  const max = Math.pow(2, 32);
  while (size < max && start % (size * 2) === 0) {
    size *= 2;
  }
  return size;
}

function parseCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = (values[index] ?? "").trim();
      return row;
    }, {});
  });
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
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

function readCsvField(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined) {
      return direct.trim();
    }
    const foundKey = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (foundKey) {
      return row[foundKey].trim();
    }
  }
  return "";
}

function normalizeL3Service(value: string): L3Service {
  return l3Services.find((service) => service.toLowerCase() === value.trim().toLowerCase()) ?? "MPLS L3VPN";
}

function normalizeEnvironment(value: string): Environment {
  return environments.find((environment) => environment.toLowerCase() === value.trim().toLowerCase()) ?? "Production";
}

function normalizeAssignmentStatus(value: string): AssignmentStatus {
  return statuses.find((status) => status.toLowerCase() === value.trim().toLowerCase()) ?? "Planned";
}

function validateAssignment(candidate: Assignment, pools: NetworkPool[], assignments: Assignment[]) {
  const parent = pools.find((pool) => containsRange(pool, candidate) && candidate.prefix > pool.prefix);
  if (!parent) {
    return {
      ok: false,
      reason: `Assignment blocked. ${candidate.cidr} must be a smaller subnet inside an imported parent pool.`
    };
  }

  const overlap = assignments.find((assignment) => rangesOverlap(candidate, assignment));
  if (overlap) {
    return {
      ok: false,
      reason: `Assignment blocked. ${candidate.cidr} overlaps ${overlap.customerName} allocation ${overlap.cidr}.`
    };
  }

  return { ok: true, reason: "" };
}

function getPartitionBlocker(parent: NetworkPool, targetPrefix: number, assignments: Assignment[]) {
  if (!Number.isInteger(targetPrefix) || targetPrefix <= parent.prefix || targetPrefix > 30) {
    return `Partition blocked. Choose a prefix larger than /${parent.prefix} and no larger than /30.`;
  }

  const assignment = assignments.find((item) => containsRange(parent, item));
  if (assignment) {
    return `Partition blocked. ${parent.cidr} already contains customer ${assignment.customerName} allocation ${assignment.cidr}. Move or split that allocation first.`;
  }

  return "";
}

function validateJoin(left: NetworkPool, right: NetworkPool, pools: NetworkPool[]) {
  if (left.id === right.id) {
    return { ok: false, reason: "Join blocked. Choose two different pools." };
  }

  if (left.prefix !== right.prefix) {
    return { ok: false, reason: "Join blocked. Pools must have the same prefix length." };
  }

  const size = left.size;
  const lower = left.start < right.start ? left : right;
  const upper = lower.id === left.id ? right : left;
  if (upper.start !== lower.end + 1) {
    return { ok: false, reason: "Join blocked. Pools must be directly adjacent with no gap." };
  }

  const joinedPrefix = left.prefix - 1;
  if (joinedPrefix < 0 || Math.floor(lower.start / (size * 2)) * (size * 2) !== lower.start) {
    return { ok: false, reason: "Join blocked. These adjacent pools are not aligned to a valid supernet boundary." };
  }

  const joined = parseCidr(`${numberToIp(lower.start)}/${joinedPrefix}`);
  const overlap = pools.find((pool) => pool.id !== left.id && pool.id !== right.id && rangesOverlap(pool, joined));
  if (overlap) {
    return { ok: false, reason: `Join blocked. Result ${joined.cidr} would overlap existing parent pool ${overlap.cidr}.` };
  }

  return { ok: true, reason: "", joined };
}

function buildStats(pools: NetworkPool[], assignments: Assignment[], conflicts: Conflict[]) {
  const totalAddresses = pools.reduce((sum, pool) => sum + pool.size, 0);
  const assignedAddresses = assignments.reduce((sum, assignment) => sum + assignment.size, 0);
  const utilizationPercent = totalAddresses > 0 ? Math.round((assignedAddresses / totalAddresses) * 1000) / 10 : 0;
  const customerCount = new Set(assignments.map((assignment) => assignment.customerName)).size;
  const freeEstimate = Math.max(0, totalAddresses - assignedAddresses);
  return {
    totalAddresses,
    assignedAddresses,
    utilizationPercent,
    poolCount: pools.length,
    customers: customerCount,
    criticalConflicts: conflicts.filter((conflict) => conflict.severity === "critical").length,
    largestFreeBlock: freeEstimate > 0 ? `/${sizeToPrefix(freeEstimate)}` : "None"
  };
}

function findConflicts(pools: NetworkPool[], assignments: Assignment[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < pools.length; i += 1) {
    for (let j = i + 1; j < pools.length; j += 1) {
      if (rangesOverlap(pools[i], pools[j])) {
        conflicts.push({
          id: `pool-${pools[i].id}-${pools[j].id}`,
          severity: "warning",
          title: "Parent pools overlap",
          detail: `${pools[i].name} and ${pools[j].name} both cover part of the same address space.`,
          ranges: [pools[i].cidr, pools[j].cidr]
        });
      }
    }
  }

  assignments.forEach((assignment) => {
    if (!pools.some((pool) => containsRange(pool, assignment))) {
      conflicts.push({
        id: `outside-${assignment.id}`,
        severity: "critical",
        title: "Assignment outside managed pools",
        detail: `${assignment.customerName} owns ${assignment.cidr}, but no imported parent pool contains it.`,
        ranges: [assignment.cidr]
      });
    }
  });

  for (let i = 0; i < assignments.length; i += 1) {
    for (let j = i + 1; j < assignments.length; j += 1) {
      if (rangesOverlap(assignments[i], assignments[j])) {
        conflicts.push({
          id: `assignment-${assignments[i].id}-${assignments[j].id}`,
          severity: "critical",
          title: "Business assignments overlap",
          detail: `${assignments[i].customerName} ${assignments[i].service} overlaps ${assignments[j].customerName} ${assignments[j].service}.`,
          ranges: [assignments[i].cidr, assignments[j].cidr]
        });
      }
    }
  }

  return conflicts;
}

function planSubnets(parent: NetworkPool, targetPrefix: number, assignments: Assignment[]): PlannedSubnet[] {
  if (!Number.isInteger(targetPrefix) || targetPrefix < parent.prefix || targetPrefix > 30) {
    return [];
  }

  const childSize = prefixSize(targetPrefix);
  const childCount = Math.min(256, Math.floor(parent.size / childSize));
  const subnets: PlannedSubnet[] = [];

  for (let index = 0; index < childCount; index += 1) {
    const start = parent.start + index * childSize;
    const end = start + childSize - 1;
    const cidr = `${numberToIp(start)}/${targetPrefix}`;
    const blockers = assignments.filter((assignment) => rangesOverlap({ start, end }, assignment)).map((assignment) => `${assignment.customerName} ${assignment.cidr}`);
    subnets.push({
      cidr,
      start,
      end,
      prefix: targetPrefix,
      size: childSize,
      firstUsable: numberToIp(targetPrefix >= 31 ? start : start + 1),
      lastUsable: numberToIp(targetPrefix >= 31 ? end : end - 1),
      parentId: parent.id,
      available: blockers.length === 0,
      blockingAssignments: blockers
    });
  }

  return subnets;
}

function nextAvailableSuggestion(pools: NetworkPool[], assignments: Assignment[], prefix: number) {
  for (const pool of pools) {
    const candidates = planSubnets(pool, prefix, assignments);
    const found = candidates.find((candidate) => candidate.available);
    if (found) {
      return found.cidr;
    }
  }
  return "10.0.0.0/24";
}

function parseCidr(input: string): CidrRange {
  const trimmed = input.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new Error("CIDR requires slash prefix");
  }
  const ip = ipToNumber(parts[0]);
  const prefix = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error("Invalid prefix");
  }
  const size = prefixSize(prefix);
  const start = Math.floor(ip / size) * size;
  const end = start + size - 1;
  return {
    cidr: `${numberToIp(start)}/${prefix}`,
    start,
    end,
    prefix,
    size,
    firstUsable: numberToIp(prefix >= 31 ? start : start + 1),
    lastUsable: numberToIp(prefix >= 31 ? end : end - 1)
  };
}

function ipToNumber(value: string) {
  const octets = value.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid IPv4 address");
  }
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function numberToIp(value: number) {
  const safe = value >>> 0;
  return [safe >>> 24, (safe >>> 16) & 255, (safe >>> 8) & 255, safe & 255].join(".");
}

function prefixSize(prefix: number) {
  return Math.pow(2, 32 - prefix);
}

function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start <= right.end && right.start <= left.end;
}

function containsRange(parent: { start: number; end: number }, child: { start: number; end: number }) {
  return parent.start <= child.start && parent.end >= child.end;
}

function sizeToPrefix(size: number) {
  const power = Math.floor(Math.log2(size));
  return Math.max(0, Math.min(32, 32 - power));
}

function formatHosts(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: value >= 1000000 ? "compact" : "standard" }).format(value);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111f"
  },
  page: {
    padding: 18,
    paddingBottom: 42,
    gap: 18
  },
  loginPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  loginCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 18,
    gap: 12
  },
  loginTitle: {
    color: "#eaf2ff",
    fontSize: 28,
    fontWeight: "900"
  },
  loginSubtitle: {
    color: "#9fb2ca",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1
  },
  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#101c2e",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  logoImage: {
    width: 38,
    height: 38
  },
  headerBrandImage: {
    width: 108,
    height: 34
  },
  loginBrandImage: {
    width: 150,
    height: 46,
    alignSelf: "flex-start"
  },
  kicker: {
    color: "#8da2ba",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: "#eaf2ff",
    fontSize: 24,
    fontWeight: "900"
  },
  healthBadge: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: "#101c2e",
    borderWidth: 1,
    borderColor: "#273a52",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0e7c66"
  },
  healthText: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "800"
  },
  logoutButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  logoutText: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "900"
  },
  summaryBand: {
    backgroundColor: "#16324f",
    borderRadius: 8,
    padding: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    alignItems: "stretch"
  },
  heroCopy: {
    flex: 1,
    minWidth: 0
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "900",
    maxWidth: 620
  },
  heroSubtitle: {
    color: "#b9c8dc",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 660
  },
  capacityPanel: {
    flexBasis: 190,
    flexGrow: 1,
    borderRadius: 8,
    backgroundColor: "#101c2e",
    padding: 16,
    justifyContent: "center"
  },
  capacityLabel: {
    color: "#9fb2ca",
    fontSize: 12,
    fontWeight: "800"
  },
  capacityNumber: {
    color: "#eaf2ff",
    fontSize: 32,
    fontWeight: "900",
    marginTop: 8
  },
  capacityMeta: {
    color: "#9fb2ca",
    fontWeight: "800",
    marginTop: 4
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  tabButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  tabButtonActive: {
    backgroundColor: "#2662a6",
    borderColor: "#2662a6"
  },
  tabText: {
    color: "#dbeafe",
    fontWeight: "900"
  },
  tabTextActive: {
    color: "#ffffff"
  },
  tabCount: {
    minWidth: 22,
    textAlign: "center",
    overflow: "hidden",
    borderRadius: 11,
    backgroundColor: "#4a1c21",
    color: "#b42318",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  tabCountActive: {
    backgroundColor: "#101c2e",
    color: "#b42318"
  },
  contentStack: {
    gap: 16
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  metricCard: {
    flexBasis: 160,
    flexGrow: 1,
    minHeight: 142,
    borderRadius: 8,
    backgroundColor: "#101c2e",
    borderWidth: 1,
    borderColor: "#273a52",
    padding: 14
  },
  metricIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12
  },
  metricLabel: {
    color: "#9fb2ca",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  metricValue: {
    color: "#eaf2ff",
    fontSize: 27,
    fontWeight: "900",
    marginTop: 4
  },
  metricDetail: {
    color: "#9fb2ca",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2
  },
  sectionHeader: {
    gap: 5
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  sectionTitle: {
    color: "#eaf2ff",
    fontSize: 20,
    fontWeight: "900"
  },
  sectionSubtitle: {
    color: "#9fb2ca",
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 760
  },
  formPanel: {
    borderRadius: 8,
    backgroundColor: "#101c2e",
    borderWidth: 1,
    borderColor: "#273a52",
    padding: 14,
    gap: 10
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#0d1828",
    color: "#eaf2ff",
    fontSize: 15,
    fontWeight: "700",
    paddingHorizontal: 12
  },
  flexInput: {
    flex: 1,
    minWidth: 180
  },
  textArea: {
    minHeight: 108,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  csvInput: {
    minHeight: 128,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  csvInputLarge: {
    minHeight: 176,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  csvHint: {
    color: "#9fb2ca",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18
  },
  notesInput: {
    minHeight: 78,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  label: {
    color: "#9fb2ca",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: "#2662a6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900"
  },
  secondaryButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#101c2e",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  secondaryButtonText: {
    color: "#dbeafe",
    fontWeight: "900"
  },
  formHint: {
    color: "#9fb2ca",
    fontWeight: "800"
  },
  divider: {
    height: 1,
    backgroundColor: "#24364d",
    marginVertical: 4
  },
  errorText: {
    color: "#b42318",
    fontWeight: "900",
    lineHeight: 20
  },
  table: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e"
  },
  poolRow: {
    minHeight: 72,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e7edf3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  rowMain: {
    flex: 1,
    minWidth: 0
  },
  rowSide: {
    alignItems: "flex-end"
  },
  rowTitle: {
    color: "#eaf2ff",
    fontSize: 16,
    fontWeight: "900"
  },
  rowMeta: {
    color: "#9fb2ca",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3
  },
  chipGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  chip: {
    minHeight: 39,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#0d1828",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  chipActive: {
    backgroundColor: "#16324f",
    borderColor: "#16324f"
  },
  chipText: {
    color: "#dbeafe",
    fontWeight: "900"
  },
  chipTextActive: {
    color: "#ffffff"
  },
  plannerSummary: {
    borderRadius: 8,
    backgroundColor: "#0c1a2d",
    borderWidth: 1,
    borderColor: "#25405c",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#24364d",
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  subnetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  subnetCard: {
    flexBasis: 230,
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 13
  },
  subnetCardBlocked: {
    backgroundColor: "#2a1417",
    borderColor: "#7f2a31"
  },
  subnetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8
  },
  subnetCidr: {
    color: "#eaf2ff",
    fontSize: 16,
    fontWeight: "900"
  },
  availability: {
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "900"
  },
  available: {
    backgroundColor: "#0d342d",
    color: "#0e7c66"
  },
  blocked: {
    backgroundColor: "#4a1c21",
    color: "#b42318"
  },
  blockingText: {
    color: "#b42318",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
    lineHeight: 17
  },
  twoColumn: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  assignmentToolbar: {
    gap: 8
  },
  searchInput: {
    backgroundColor: "#101c2e"
  },
  assignmentList: {
    gap: 12
  },
  detailHeader: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  breadcrumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8
  },
  breadcrumbCrumb: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#0d1828",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  breadcrumbText: {
    color: "#9fb2ca",
    fontSize: 12,
    fontWeight: "900"
  },
  breadcrumbTextActive: {
    color: "#ffffff"
  },
  assignmentCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 14,
    gap: 12
  },
  userRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#0d1828",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  assignmentTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  detailItem: {
    flexBasis: 140,
    flexGrow: 1,
    borderRadius: 8,
    backgroundColor: "#0d1828",
    padding: 10
  },
  detailLabel: {
    color: "#9fb2ca",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  detailValue: {
    color: "#eaf2ff",
    fontWeight: "900",
    marginTop: 3
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(16, 34, 53, 0.38)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  confirmCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 8,
    backgroundColor: "#101c2e",
    borderWidth: 1,
    borderColor: "#273a52",
    padding: 18
  },
  confirmTitle: {
    color: "#eaf2ff",
    fontSize: 20,
    fontWeight: "900"
  },
  confirmMessage: {
    color: "#9fb2ca",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: 8
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18
  },
  noButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#101c2e",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  noButtonText: {
    color: "#dbeafe",
    fontWeight: "900"
  },
  yesButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#2662a6",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  yesButtonDanger: {
    backgroundColor: "#b42318"
  },
  yesButtonText: {
    color: "#ffffff",
    fontWeight: "900"
  },
  notesText: {
    color: "#9fb2ca",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700"
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  smallActionButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#31455f",
    backgroundColor: "#0d1828",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  smallActionText: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "900"
  },
  dangerActionButton: {
    borderColor: "#7f2a31",
    backgroundColor: "#2a1417"
  },
  dangerActionText: {
    color: "#b42318"
  },
  emptyPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 22,
    alignItems: "center"
  },
  emptyTitle: {
    color: "#eaf2ff",
    fontSize: 19,
    fontWeight: "900",
    marginTop: 10
  },
  emptyText: {
    color: "#9fb2ca",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
    textAlign: "center"
  },
  conflictCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#273a52",
    backgroundColor: "#101c2e",
    padding: 14,
    gap: 10
  },
  conflictCritical: {
    borderColor: "#7f2a31",
    backgroundColor: "#2a1417"
  },
  conflictTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  conflictTitle: {
    color: "#eaf2ff",
    fontSize: 16,
    fontWeight: "900",
    flex: 1
  },
  conflictDetail: {
    color: "#9fb2ca",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700"
  },
  conflictRangeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  conflictRange: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#142235",
    color: "#dbeafe",
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  severityBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  severityText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900"
  }
});




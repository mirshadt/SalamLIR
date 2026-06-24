const http = require("http");

const host = "0.0.0.0";
const port = 3001;

const pools = [
  createPool("10.0.0.0/8", "Enterprise private backbone", "Global WAN"),
  createPool("172.16.0.0/12", "Data center estate", "Riyadh DC"),
  createPool("192.168.0.0/16", "Branch and office LAN", "KSA branches")
];

const assignments = [
  createAssignment({
    cidr: "10.16.0.0/20",
    customerName: "Riyadh Digital Bank",
    commercialRegId: "1010456789",
    unifiedNumber: "7001234567",
    contactNumber: "+966 11 555 0101",
    city: "Riyadh",
    region: "Riyadh Region",
    contactName: "Nora Al-Fahad",
    l3Service: "MPLS L3VPN",
    service: "Mobile app platform",
    owner: "Network service desk",
    site: "Riyadh DC",
    environment: "Production",
    status: "Active",
    notes: "Kubernetes worker nodes and service endpoints"
  }),
  createAssignment({
    cidr: "172.16.32.0/22",
    customerName: "Najd Manufacturing Co.",
    commercialRegId: "4030987654",
    unifiedNumber: "7007654321",
    contactNumber: "+966 12 555 0172",
    city: "Jeddah",
    region: "Makkah Region",
    contactName: "Maha Saleh",
    l3Service: "Cloud Connect",
    service: "Factory ERP private link",
    owner: "Network service desk",
    site: "Riyadh DC",
    environment: "Shared",
    status: "Reserved",
    notes: "Reserved for customer onboarding"
  })
];

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createPool(cidr, name, region, source = "API") {
  return {
    id: `pool-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ...parseCidr(cidr),
    name,
    region,
    source,
    createdAt: new Date().toISOString()
  };
}

function createAssignment(body) {
  return {
    id: `asn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ...parseCidr(body.cidr),
    customerName: body.customerName || "Unassigned customer",
    commercialRegId: body.commercialRegId || "",
    unifiedNumber: body.unifiedNumber || "",
    contactNumber: body.contactNumber || "",
    city: body.city || "",
    region: body.region || "",
    contactName: body.contactName || "",
    l3Service: body.l3Service || "MPLS L3VPN",
    service: body.service || "L3 service",
    owner: body.owner || "Network service desk",
    site: body.site || "Unassigned site",
    environment: body.environment || "Production",
    status: body.status || "Planned",
    notes: body.notes || "",
    createdAt: new Date().toISOString()
  };
}

function validatePool(candidate, excludeIds = []) {
  const overlap = pools.find((pool) => !excludeIds.includes(pool.id) && rangesOverlap(pool, candidate));
  if (overlap) {
    return { ok: false, reason: `${candidate.cidr} overlaps parent pool ${overlap.cidr}` };
  }
  return { ok: true, reason: "" };
}

function validateAssignment(candidate) {
  if (!pools.some((pool) => containsRange(pool, candidate))) {
    return { ok: false, reason: `${candidate.cidr} is outside managed parent pools` };
  }

  const overlap = assignments.find((assignment) => rangesOverlap(assignment, candidate));
  if (overlap) {
    return { ok: false, reason: `${candidate.cidr} overlaps ${overlap.customerName} allocation ${overlap.cidr}` };
  }

  return { ok: true, reason: "" };
}

function findConflicts() {
  const conflicts = [];

  for (let i = 0; i < pools.length; i += 1) {
    for (let j = i + 1; j < pools.length; j += 1) {
      if (rangesOverlap(pools[i], pools[j])) {
        conflicts.push({ severity: "warning", title: "Parent pools overlap", ranges: [pools[i].cidr, pools[j].cidr] });
      }
    }
  }

  assignments.forEach((assignment) => {
    if (!pools.some((pool) => containsRange(pool, assignment))) {
      conflicts.push({ severity: "critical", title: "Assignment outside managed pools", ranges: [assignment.cidr] });
    }
  });

  for (let i = 0; i < assignments.length; i += 1) {
    for (let j = i + 1; j < assignments.length; j += 1) {
      if (rangesOverlap(assignments[i], assignments[j])) {
        conflicts.push({ severity: "critical", title: "Customer assignments overlap", ranges: [assignments[i].cidr, assignments[j].cidr] });
      }
    }
  }

  return conflicts;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.url === "/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, pools: pools.length, assignments: assignments.length });
  }

  if (req.url === "/pools" && req.method === "GET") {
    return sendJson(res, 200, pools);
  }

  if (req.url === "/assignments" && req.method === "GET") {
    return sendJson(res, 200, assignments);
  }

  if (req.url === "/conflicts" && req.method === "GET") {
    return sendJson(res, 200, findConflicts());
  }

  if (req.url === "/pools" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const pool = createPool(body.cidr, body.name || "Imported allocation", body.region || "Unassigned region");
      const validation = validatePool(pool);
      if (!validation.ok) {
        return sendJson(res, 409, { error: validation.reason });
      }
      pools.unshift(pool);
      return sendJson(res, 201, pool);
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid pool payload" });
    }
  }

  if (req.url === "/pools/partition" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const parent = pools.find((pool) => pool.id === body.poolId || pool.cidr === body.cidr);
      const prefix = Number.parseInt(body.targetPrefix, 10);
      if (!parent || !Number.isInteger(prefix) || prefix <= parent.prefix || prefix > 30) {
        return sendJson(res, 400, { error: "Invalid partition request" });
      }
      const blocker = assignments.find((assignment) => containsRange(parent, assignment));
      if (blocker) {
        return sendJson(res, 409, { error: `Pool contains customer allocation ${blocker.cidr}` });
      }
      const count = Math.pow(2, prefix - parent.prefix);
      if (count > 256) {
        return sendJson(res, 409, { error: "Partition would create more than 256 child pools" });
      }
      const childSize = Math.pow(2, 32 - prefix);
      const children = Array.from({ length: count }, (_, index) =>
        createPool(`${numberToIp(parent.start + index * childSize)}/${prefix}`, `${parent.name} part ${index + 1}`, parent.region, `Partitioned from ${parent.cidr}`)
      );
      const parentIndex = pools.findIndex((pool) => pool.id === parent.id);
      pools.splice(parentIndex, 1, ...children);
      return sendJson(res, 201, children);
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid partition payload" });
    }
  }

  if (req.url === "/pools/join" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const left = pools.find((pool) => pool.id === body.leftPoolId || pool.cidr === body.leftCidr);
      const right = pools.find((pool) => pool.id === body.rightPoolId || pool.cidr === body.rightCidr);
      const validation = left && right ? validateJoin(left, right) : { ok: false, reason: "Select two pools" };
      if (!validation.ok) {
        return sendJson(res, 409, { error: validation.reason });
      }
      pools.splice(pools.findIndex((pool) => pool.id === left.id), 1);
      pools.splice(pools.findIndex((pool) => pool.id === right.id), 1);
      const joined = createPool(validation.joined.cidr, `${left.name} + ${right.name}`, left.region === right.region ? left.region : "Multi-region", `Joined ${left.cidr} and ${right.cidr}`);
      pools.unshift(joined);
      return sendJson(res, 201, joined);
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid join payload" });
    }
  }

  if (req.url === "/assignments" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const assignment = createAssignment(body);
      const validation = validateAssignment(assignment);
      if (!validation.ok) {
        return sendJson(res, 409, { error: validation.reason });
      }
      assignments.unshift(assignment);
      return sendJson(res, 201, assignment);
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid assignment payload" });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
});

function validateJoin(left, right) {
  if (left.id === right.id) {
    return { ok: false, reason: "Choose two different pools" };
  }
  if (left.prefix !== right.prefix) {
    return { ok: false, reason: "Pools must have the same prefix" };
  }

  const lower = left.start < right.start ? left : right;
  const upper = lower.id === left.id ? right : left;
  if (upper.start !== lower.end + 1) {
    return { ok: false, reason: "Pools must be adjacent" };
  }

  const joinedPrefix = left.prefix - 1;
  const joinedSize = Math.pow(2, 32 - joinedPrefix);
  if (Math.floor(lower.start / joinedSize) * joinedSize !== lower.start) {
    return { ok: false, reason: "Pools are not aligned to a valid supernet boundary" };
  }

  const joined = parseCidr(`${numberToIp(lower.start)}/${joinedPrefix}`);
  const validation = validatePool(joined, [left.id, right.id]);
  if (!validation.ok) {
    return validation;
  }

  return { ok: true, reason: "", joined };
}

function parseCidr(input) {
  const parts = String(input || "").trim().split("/");
  if (parts.length !== 2) {
    throw new Error("CIDR requires slash prefix");
  }

  const ip = ipToNumber(parts[0]);
  const prefix = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error("Invalid prefix");
  }

  const size = Math.pow(2, 32 - prefix);
  const start = Math.floor(ip / size) * size;
  const end = start + size - 1;
  return {
    cidr: `${numberToIp(start)}/${prefix}`,
    start,
    end,
    prefix,
    size
  };
}

function ipToNumber(value) {
  const octets = String(value).split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid IPv4 address");
  }
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function numberToIp(value) {
  const safe = value >>> 0;
  return [safe >>> 24, (safe >>> 16) & 255, (safe >>> 8) & 255, safe & 255].join(".");
}

function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

function containsRange(parent, child) {
  return parent.start <= child.start && parent.end >= child.end;
}

server.listen(port, host, () => {
  console.log(`NetAtlas IPAM API running at http://localhost:${port}`);
});

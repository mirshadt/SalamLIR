# NetAtlas IPAM

Next.js / React application for IP address management, backed by FastAPI and SQLite.

## Technology Stack

- Frontend: Next.js 15 / React 19
- UI: Tailwind CSS with local shadcn/ui-style components
- Tables: TanStack Table
- Charts: Recharts
- API calls: Axios and TanStack React Query
- Auth: Keycloak OAuth2/OIDC with Authorization Code + PKCE, plus local FastAPI login fallback
- Backend: FastAPI
- Database: SQLite3 at `backend/ipam.db`

## Features

- Dark theme with Salam favicon/logo assets
- Admin login enabled with seeded admin user
- Import large IPv4 parent pools with CIDR normalization
- Bulk import parent pools with CSV
- Bulk import customer assignments with CSV
- Block parent pool imports that overlap existing managed pools
- Partition an IP pool by allocating one child subnet from the start or end of the current continuous free pool
- Reject middle allocation and fragmented partitioning to preserve a single continuous remaining free pool
- Join adjacent same-prefix parent pools into a valid supernet
- Reserve subnet blocks from the planner
- Assign CIDRs to L3 service customers with customer name, commercial registration ID, unified number, contact number, city, region, contact name, service, site, environment, and status metadata
- SID-aligned IP subnet common information model: IP subnet is a logical resource, service is a specification/instance, and assignment relates the resource to either internal service usage or enterprise customer service
- Clickable CIDR summary pages for parent pools and assigned subnets showing resource, service, customer/internal, technical, place, lifecycle, and audit details
- Capture assignment date for every customer allocation
- Block customer assignment when the requested subnet overlaps another customer or is outside managed space
- Unassign customer ranges, or mark them as quarantined or blocked while keeping them unavailable for reuse
- Open a parent pool to view assigned ranges and generated unassigned subranges inside that pool
- Breadcrumb navigation inside parent pools and subranges
- Drill into any assigned or unassigned subrange; free subranges support split, join-next, and assign actions
- Manage admin/operator/viewer users
- Set an initial password during user onboarding and reset passwords for existing users
- Search assignments by CIDR, customer, identifiers, contact, city, region, service, site, environment, or status
- Detect overlapping parent pools, overlapping customer assignments, and assignments outside managed space
- Dashboard metrics for managed capacity, assigned space, utilization, customer coverage, and conflict severity
- Dashboard section for Free Fragmented Pools with fragment summary widgets, operational alerts, and recommended actions

## Run Locally

Start the SQLite-backed FastAPI service first:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\scripts\start-api.ps1
```

You can also start the API with `npm.cmd run api:py` from the project root. Keep the API terminal open while using the GUI; if it is closed, the web app will show FastAPI as unreachable.

The database file is `backend/ipam.db`. Keep this file when redeploying or restarting if you want pools, assignments, and users to remain available. The backend creates the admin user automatically, but it does not auto-create demo IP pools or assignments.

In a second terminal, start the Next.js web app:

```powershell
npm.cmd install
npm.cmd run web
```

Open `http://localhost:8082` for the Next.js browser preview.

## Application URLs

| Service | URL | Purpose |
| --- | --- | --- |
| Web UI | `http://127.0.0.1:8082/` | IPAM user interface |
| Web UI alternate | `http://localhost:8082/` | Same UI using localhost |
| FastAPI base URL | `http://127.0.0.1:3001` | Backend API base |
| FastAPI health | `http://127.0.0.1:3001/health` | Backend/database status |
| FastAPI Swagger UI | `http://127.0.0.1:3001/docs` | Interactive API documentation |
| FastAPI OpenAPI JSON | `http://127.0.0.1:3001/openapi.json` | Machine-readable API schema |

The frontend uses `NEXT_PUBLIC_API_URL` when set. If it is not set, the UI calls `http://127.0.0.1:3001`.

Brand assets:

- Web favicon comes from `Salam_Favicon.rar` and is copied to `assets/favicon.png`
- App icon, adaptive icon, splash, and in-app logo assets come from `Salam_EN.rar`

Default admin login:

```text
Username: ipam-admin
Password: Adminirshad@324
```

## Keycloak Setup

The UI supports Keycloak without changing the FastAPI/SQLite stack. Create a public Keycloak client for this app:

- Client type: OpenID Connect
- Access type: Public client
- Standard flow: Enabled
- PKCE: S256
- Valid redirect URI for local dev: `http://localhost:8082/*`
- Web origins for local dev: `http://localhost:8082`

Create `.env.local` in the project root:

```text
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
NEXT_PUBLIC_KEYCLOAK_REALM=ipam
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=netatlas-ipam
NEXT_PUBLIC_KEYCLOAK_REDIRECT_URI=http://localhost:8082
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
```

When those variables are present, the login screen shows `Login with Keycloak`. The received Keycloak access token is stored as the session token and sent to FastAPI as an `Authorization: Bearer ...` header. If Keycloak is not configured, the local `ipam-admin` login remains available for development.

## API URLs

Base URL:

```text
http://127.0.0.1:3001
```

Authentication:

| Method | URL | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Local username/password login |

Users:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/users` | List users |
| `POST` | `/users` | Create user |
| `PATCH` | `/users/{user_id}/status` | Enable or disable user |
| `PATCH` | `/users/{user_id}/password` | Set user password |

Pools and subnet operations:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/pools` | List parent pools |
| `GET` | `/pools/{pool_id}/ranges` | View assigned and unassigned ranges inside a pool |
| `POST` | `/pools` | Create parent pool |
| `PATCH` | `/pools/{pool_id}` | Update pool lifecycle/registry fields |
| `DELETE` | `/pools/{pool_id}` | Blocked for root pools; root pools must be retired, not deleted |
| `POST` | `/pools/bulk` | Bulk import pools/subnets by CIDR or `StartIP,EndIP,Total` CSV |
| `POST` | `/pools/partition` | Partition from start/end of parent pool |
| `POST` | `/pools/join` | Join adjacent pools |

Normalized CIDR resources:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/resources` | List current CIDR inventory from `ip_resources`, joined to `assignment_details` by `resource_uuid` |

Assignments and reservations:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/assignments` | List assignments and reservations |
| `POST` | `/assignments` | Create assignment or reservation |
| `POST` | `/assignments/bulk` | Bulk import assignments/reservations |
| `PATCH` | `/assignments/{assignment_id}/status` | Update assignment status |
| `DELETE` | `/assignments/{assignment_id}` | Release assignment/reservation |

Audit and integrity:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API and SQLite status |
| `GET` | `/audit` | Recent audit events |
| `GET` | `/conflicts` | Pool/assignment overlap and integrity conflicts |

Pool CSV columns:

```csv
cidr,name,region
100.64.0.0/10,CGNAT service pool,Shared services
```

Pool range CSV columns:

```csv
StartIP,EndIP,Total
192.168.1.0,192.168.1.255,256
10.0.0.0,10.0.0.255,256
172.16.0.0,172.16.3.255,1024
100.64.0.0,100.64.15.255,4096
5.42.224.0,5.42.255.255,8192
```

Assignment CSV columns:

```csv
cidr,customerName,commercialRegId,unifiedNumber,contactNumber,city,region,contactName,l3Service,service,site,environment,status,assignmentDate,notes
10.40.0.0/24,Example Customer,1019999999,7099999999,+966 55 999 9999,Riyadh,Riyadh Region,Admin Contact,MPLS L3VPN,L3 branch service,Riyadh POP,Production,Planned,2026-06-02,CSV import sample
```

Assignment bulk CSV format A:

```csv
startIp,endIp,size,status,assignmentDate,customerName
192.168.1.10,192.168.1.12,3,1,2026-06-09,Example Enterprise
```

Assignment bulk CSV format B:

```csv
cidr,size,status,assignmentDate,customerName
10.40.0.0/24,256,2,2026-06-09,Reserved Capacity
```

For the new assignment bulk formats, `status` must be `1` for `ASSIGNED_TO_BUSINESS` or `2` for `RESERVED`. IP ranges are summarized into the minimum valid set of CIDRs, and the import output includes input row number, processing status, generated resource UUID, generated version UUID, generated CIDR, generated size, status, assignment date, and customer name.

Open `http://localhost:3001/docs` for the interactive FastAPI API documentation. The FastAPI implementation uses Python's built-in `ipaddress` library for CIDR normalization, subnet containment, overlap checks, partitioning, and join validation.

FastAPI stores pools, customer assignments, current CIDR resources, assignment details, and users in SQLite at `backend/ipam.db`. The database schema and admin user are created automatically the first time the backend imports. IP pools and assignments must be imported or created by the user. Passwords are stored as salted PBKDF2 hashes in the FastAPI backend.

## IP Pool Partitioning Rule

Partitioning allocates one child subnet from an existing parent pool using:

- Allocation direction: `Start of Pool` or `End of Pool`
- Required subnet prefix length, such as `/22`

The backend calculates the CIDR boundary automatically. It does not accept a custom start IP, so allocating from the middle of a pool is prohibited. The request is rejected when the requested subnet is too large, the calculated boundary is not CIDR-aligned, the subnet would overlap an existing child subnet, or existing subnets have already fragmented the parent into multiple free ranges.

Example for `5.42.224.0/19`:

```text
Start + /22 => allocated 5.42.224.0/22, remaining 5.42.228.0 - 5.42.255.255
End   + /22 => allocated 5.42.252.0/22, remaining 5.42.224.0 - 5.42.251.255
```

## Free Fragmented Pools Dashboard

The Overview dashboard includes a dedicated **Free Fragmented Pools** section. For each parent allocation, the UI calculates all continuous free ranges and classifies every range outside the largest continuous free pool as fragmented free space.

The dashboard shows:

- Total Free IPs
- Total Fragmented Free IPs
- Number of Free Fragments
- Largest Fragment
- Smallest Fragment
- Fragmentation Ratio

Each fragment row includes parent allocation, start/end IP, CIDR representation, total and available IPs, utilization, last allocation date, status, and adjacent allocated subnet count.

Alerts are generated when the fragmentation ratio exceeds `30%`, a parent has more than `3` fragments, or the currently requested assignment CIDR cannot fit in any continuous free range despite sufficient total free IPs.

## IP Subnet Common Information Model

The backend schema is aligned to TM Forum SID-style concepts:

- Current CIDR inventory state is stored in `ip_resources`
- Assignment/customer/service details are stored separately in `assignment_details`
- `assignment_details.resource_uuid` joins to `ip_resources.resource_uuid`
- `resource_uuid` remains stable for a CIDR lifecycle, while `version_uuid` changes on structural or lifecycle changes
- Supported current inventory statuses are `ASSIGNED_TO_BUSINESS`, `RESERVED`, `AVAILABLE`, and `RETIRED`
- Supported ownership classifications are `BUSINESS`, `INDIVIDUAL`, `INTERNAL`, `INFRASTRUCTURE`, and `POOL`
- IP CIDR/subnet is modeled as a `LogicalResource.IPSubnet`
- Parent pools use resource role `ParentPool`
- Assigned subnets use resource role `AssignedSubnet`
- Service context is captured through service specification and service instance fields
- Enterprise assignments capture customer, account, product specification, product offering, commercial registration, unified number, and contact details
- Internal assignments capture business unit, application, owner team, cost center, project code, change request, and justification
- Technical resource context captures VRF, VLAN, ASN, routing domain, route target, gateway, DNS/DHCP/NAT/QoS, security zone, site, and location details
- Lifecycle context captures status, assignment date, reservation date, requester, approver, approval reference, owner, purpose, notes, and creation time

Every CIDR shown in parent pool and assignment tables is clickable and opens a subnet summary view grouped by:

- Logical Resource
- IP Resource
- Service Assignment
- Enterprise Customer / Product or Internal Consumer
- Technical / Place
- Lifecycle / Audit

## Notes

The Next.js UI reads and writes pools, customer assignments, and users through the FastAPI backend. Frontend redeploys or browser refreshes should reload the same data from `backend/ipam.db`. For production, move the database to a persistent volume or managed database such as Postgres with subnet-aware indexes, audit history, role-based access, approval workflows, and CSV/API imports from network sources of truth.

## Linux VM Deployment

The recommended VM deployment is:

- FastAPI on `127.0.0.1:3001`
- Next.js on `127.0.0.1:8082`
- Nginx on port `80`
- SQLite persisted at `/opt/netatlas-ipam/backend/ipam.db`
- `systemd` keeps both app processes running

The deployment templates are in `deploy/`:

```text
deploy/ipam-api.service
deploy/ipam-web.service
deploy/nginx-ipam.conf
deploy/production.env.example
```

On Ubuntu/Debian, install runtime packages:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx
```

Create an app user and copy the project:

```bash
sudo useradd --system --home /opt/netatlas-ipam --shell /usr/sbin/nologin ipam
sudo mkdir -p /opt/netatlas-ipam
sudo rsync -a --delete ./ /opt/netatlas-ipam/
sudo chown -R ipam:ipam /opt/netatlas-ipam
```

Install backend dependencies:

```bash
cd /opt/netatlas-ipam
sudo -u ipam python3 -m venv backend/.venv
sudo -u ipam backend/.venv/bin/pip install -r backend/requirements.txt
```

Install frontend dependencies and build. Use `/api` so the browser calls the Nginx proxy instead of directly calling port `3001`:

```bash
cd /opt/netatlas-ipam
sudo -u ipam npm ci
sudo -u ipam env NEXT_PUBLIC_API_URL=/api npm run build
```

Initialize or migrate the SQLite database:

```bash
cd /opt/netatlas-ipam
sudo -u ipam backend/.venv/bin/python -c "import backend.main as m; m.init_db(); print(m.health())"
```

Install the services:

```bash
sudo cp /opt/netatlas-ipam/deploy/ipam-api.service /etc/systemd/system/ipam-api.service
sudo cp /opt/netatlas-ipam/deploy/ipam-web.service /etc/systemd/system/ipam-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now ipam-api ipam-web
```

Install Nginx:

```bash
sudo cp /opt/netatlas-ipam/deploy/nginx-ipam.conf /etc/nginx/sites-available/ipam
sudo ln -sf /etc/nginx/sites-available/ipam /etc/nginx/sites-enabled/ipam
sudo nginx -t
sudo systemctl reload nginx
```

Check health:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/resources
curl http://127.0.0.1/
```

Useful operations:

```bash
sudo systemctl status ipam-api ipam-web
sudo journalctl -u ipam-api -f
sudo journalctl -u ipam-web -f
sudo systemctl restart ipam-api ipam-web
```

SQLite backup:

```bash
sudo systemctl stop ipam-api
sudo cp /opt/netatlas-ipam/backend/ipam.db /opt/netatlas-ipam/backend/ipam.$(date +%Y%m%d-%H%M%S).db
sudo systemctl start ipam-api
```

For redeployment, copy the new code to `/opt/netatlas-ipam`, keep `backend/ipam.db`, run `npm ci`, rebuild with `NEXT_PUBLIC_API_URL=/api`, run `m.init_db()` once, then restart both services.

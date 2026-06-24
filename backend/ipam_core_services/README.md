# ipam-core-services

`ipam-core-services` is the backend service layer for the IPAM platform.

The current FastAPI entrypoint remains `backend.main:app` so the GUI and local
startup commands continue to work. New integrations should be added behind the
service layer instead of growing route handlers directly.

## Core Services

### IP Inventory Service

Owns CIDR lifecycle:

- create subnet
- split subnet
- join subnet
- expand / shrink
- reserve
- assign
- release
- retire

### Assignment Service

Owns customer and service assignment intent:

- CIDR
- customer name
- customer ID
- service ID
- assignment type
- assignment date
- operational status

The assignment service updates inventory state to assigned, available,
reserved, or retired.

### Audit Service

Common audit writer for all operations:

- action
- old value
- new value
- user or system actor
- source system
- timestamp
- request ID

## Migration Rule

Move one route workflow at a time into the service layer and keep public API
URLs stable until a versioned API contract is introduced.


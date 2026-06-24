from fastapi import FastAPI

from backend.main import (
    RipeAllocatedPool,
    RipeAllocatedPoolBulkRequest,
    RipeAllocatedPoolBulkResult,
    RipeAllocatedPoolCreate,
    RipeConfigOut,
    RipeConfigUpdate,
    RipeReportRequest,
    RipeReportResponse,
    RipePushResponse,
    bulk_import_ripe_allocated_pools,
    create_ripe_allocated_pool,
    get_ripe_config,
    list_ripe_allocated_pools,
    query_ripe_report,
    push_assignment_to_ripe,
    update_ripe_config,
)


app = FastAPI(title="RIPE Integration Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, bool | str]:
    return {"ok": True, "service": "ripe-integration"}


@app.get("/config", response_model=RipeConfigOut)
def read_config() -> RipeConfigOut:
    return get_ripe_config()


@app.put("/config", response_model=RipeConfigOut)
def write_config(payload: RipeConfigUpdate) -> RipeConfigOut:
    return update_ripe_config(payload)


@app.get("/allocated-pools", response_model=list[RipeAllocatedPool])
def read_allocated_pools() -> list[RipeAllocatedPool]:
    return list_ripe_allocated_pools()


@app.post("/allocated-pools", response_model=RipeAllocatedPool, status_code=201)
def write_allocated_pool(payload: RipeAllocatedPoolCreate) -> RipeAllocatedPool:
    return create_ripe_allocated_pool(payload)


@app.post("/allocated-pools/bulk", response_model=RipeAllocatedPoolBulkResult)
def write_allocated_pools_bulk(payload: RipeAllocatedPoolBulkRequest) -> RipeAllocatedPoolBulkResult:
    return bulk_import_ripe_allocated_pools(payload)


@app.post("/reports/query", response_model=RipeReportResponse)
def read_report(payload: RipeReportRequest) -> RipeReportResponse:
    return query_ripe_report(payload)


@app.post("/assignments/{assignment_id}/push", response_model=RipePushResponse)
def push_assignment(assignment_id: str) -> RipePushResponse:
    return push_assignment_to_ripe(assignment_id)

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class AssignmentServiceDependencies:
    validate_assignment: Callable[..., Any]
    create_assignment_record: Callable[..., Any]
    update_inventory_status: Callable[..., Any]
    release_assignment_record: Callable[..., Any]


class AssignmentService:
    """Business/service assignment boundary.

    Owns assignment intent and maps it to IP inventory state:
    - Assigned to Internal, Business, or Individual
    - Assignment date and operational status
    - Customer/service references used by CST LIR reporting
    - Inventory updates to Assigned, Available, Reserved, or Retired
    """

    def __init__(self, dependencies: AssignmentServiceDependencies) -> None:
        self._dependencies = dependencies


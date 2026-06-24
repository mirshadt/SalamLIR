from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class InventoryServiceDependencies:
    create_subnet: Callable[..., Any]
    split_subnet: Callable[..., Any]
    join_subnet: Callable[..., Any]
    reserve_subnet: Callable[..., Any]
    assign_subnet: Callable[..., Any]
    release_subnet: Callable[..., Any]
    retire_subnet: Callable[..., Any]


class IpInventoryService:
    """CIDR lifecycle service.

    This service owns subnet state transitions:
    create, split, join, expand/shrink, reserve, assign, release, and retire.

    Current FastAPI routes still call the legacy functions directly. The next
    refactor step is to move those route bodies behind this service one
    operation at a time.
    """

    def __init__(self, dependencies: InventoryServiceDependencies) -> None:
        self._dependencies = dependencies


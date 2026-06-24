from __future__ import annotations

from dataclasses import dataclass
import sqlite3
from typing import Callable
from uuid import uuid4


@dataclass(frozen=True)
class AuditContext:
    user: str = "ipam-admin"
    source_system: str = "ipam-core-services"
    request_id: str = ""


class AuditService:
    """Common audit writer used by IP inventory, assignment, and integrations."""

    def __init__(self, now: Callable[[], str]) -> None:
        self._now = now

    def record(
        self,
        connection: sqlite3.Connection,
        action: str,
        entity_type: str,
        entity_id: str,
        old_value: str = "",
        new_value: str = "",
        context: AuditContext | None = None,
    ) -> None:
        context = context or AuditContext()
        connection.execute(
            """
            INSERT INTO audit_events (
              id, user, timestamp, action, entity_type, entity_id,
              old_value, new_value, source_system, request_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"audit-{uuid4().hex[:10]}",
                context.user,
                self._now(),
                action,
                entity_type,
                entity_id,
                old_value,
                new_value,
                context.source_system,
                context.request_id,
            ),
        )


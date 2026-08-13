#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
from datetime import datetime, timezone
from ipaddress import IPv4Network, ip_network
from pathlib import Path

DEFAULT_RESOURCE_MAINTAINER = "ITC-NOC-MNT"


def owner_from_maintainer(maintainer: str | None) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "", str(maintainer or "").upper())
    if "ORBIT" in normalized:
        return "OrbitNet"
    if "SALAM" in normalized or "ITCNOC" in normalized or normalized in {"ITCNOCMNT", "ITCMNT"}:
        return "Salam"
    return str(maintainer or "").strip() or "Salam"


def ensure_ip_resource_columns(connection: sqlite3.Connection) -> None:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(ip_resources)").fetchall()}
    if "owner" not in columns:
        connection.execute("ALTER TABLE ip_resources ADD COLUMN owner TEXT NOT NULL DEFAULT ''")
    if "maintainer" not in columns:
        connection.execute("ALTER TABLE ip_resources ADD COLUMN maintainer TEXT NOT NULL DEFAULT 'ITC-NOC-MNT'")


def parse_network(cidr: str) -> IPv4Network | None:
    try:
        network = ip_network(str(cidr or ""), strict=False)
    except ValueError:
        return None
    return network if isinstance(network, IPv4Network) else None


def main() -> int:
    default_db = Path(__file__).resolve().parents[1] / "backend" / "ipam.db"
    parser = argparse.ArgumentParser(description="Backfill derived IP resource owner from nearest allocated pool maintainer.")
    parser.add_argument("--db", default=str(default_db), help="Path to ipam.db")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without updating the database")
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        ensure_ip_resource_columns(connection)
        connection.commit()
        pool_entries = []
        pools_by_id = {}
        for row in connection.execute("SELECT id, cidr, owner FROM pools").fetchall():
            network = parse_network(row["cidr"])
            if network is None:
                continue
            maintainer = str(row["owner"] or DEFAULT_RESOURCE_MAINTAINER).strip() or DEFAULT_RESOURCE_MAINTAINER
            entry = {"id": str(row["id"]), "network": network, "maintainer": maintainer}
            pool_entries.append(entry)
            pools_by_id[entry["id"]] = entry

        updated_at = datetime.now(timezone.utc).isoformat()
        updates = []
        for row in connection.execute("SELECT resource_uuid, cidr, source_entity_type, source_entity_id, owner, maintainer FROM ip_resources").fetchall():
            pool = pools_by_id.get(str(row["source_entity_id"] or "")) if str(row["source_entity_type"] or "") == "pool" else None
            if pool is None:
                network = parse_network(row["cidr"])
                if network is not None:
                    candidates = [entry for entry in pool_entries if network.subnet_of(entry["network"])]
                    pool = max(candidates, key=lambda entry: entry["network"].prefixlen, default=None)
            maintainer = pool["maintainer"] if pool else DEFAULT_RESOURCE_MAINTAINER
            owner = owner_from_maintainer(maintainer)
            if str(row["owner"] or "") == owner and str(row["maintainer"] or "") == maintainer:
                continue
            updates.append((owner, maintainer, updated_at, row["resource_uuid"], row["cidr"]))

        if not args.dry_run:
            connection.executemany(
                "UPDATE ip_resources SET owner = ?, maintainer = ?, updated_at = ? WHERE resource_uuid = ?",
                [(owner, maintainer, updated_at, resource_uuid) for owner, maintainer, updated_at, resource_uuid, _cidr in updates],
            )
            connection.commit()
        print(f"database={db_path}")
        print(f"pool_count={len(pool_entries)}")
        print(f"resources_updated={len(updates)}")
        owner_counts = connection.execute("SELECT owner, COUNT(*) FROM ip_resources GROUP BY owner ORDER BY COUNT(*) DESC, owner").fetchall()
        for owner, count in owner_counts:
            print(f"owner={owner or '(blank)'} count={count}")
        if args.dry_run and updates[:10]:
            print("sample_changes=")
            for owner, maintainer, _updated_at, resource_uuid, cidr in updates[:10]:
                print(f"  {cidr} {resource_uuid} -> owner={owner} maintainer={maintainer}")
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
#!/usr/bin/env python3
"""
Fetch private merge archive artifacts from Supabase.

Requires service-role key (never ship this to the website):
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_ROLE_KEY=...

Examples:
    python3 scripts/fetch_baseline.py --list
    python3 scripts/fetch_baseline.py --list --kind all
    python3 scripts/fetch_baseline.py --subject 001 --kind experiment_cd --out ./exports
    python3 scripts/fetch_baseline.py --subject 001 --kind raw --out ./raws
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("Install dependency: pip install supabase", file=sys.stderr)
    raise SystemExit(1)

KINDS = ("baseline_ab", "experiment_cd", "raw", "all")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch private merge archive artifacts.")
    parser.add_argument("--list", action="store_true", help="List artifacts only.")
    parser.add_argument("--subject", help="Filter by subject_id.")
    parser.add_argument("--kind", choices=KINDS, default="all", help="Artifact kind filter.")
    parser.add_argument("--out", type=Path, default=Path("archive_exports"), help="Download directory.")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 1

    client = create_client(url, key)
    query = (
        client.table("merge_artifacts")
        .select(
            "id,created_at,subject_id,subject_name,kind,window_label,storage_path,row_count,time_range"
        )
        .order("created_at", desc=True)
        .limit(args.limit)
    )
    if args.kind != "all":
        query = query.eq("kind", args.kind)
    if args.subject:
        query = query.eq("subject_id", args.subject)
    rows = query.execute().data or []

    if not rows:
        print("No artifacts found.")
        return 0

    for row in rows:
        print(
            f"{row['created_at']}  {row['kind']:14}  {row['subject_id']} {row['subject_name']}  "
            f"label={row.get('window_label') or '-'}  rows={row.get('row_count')}  {row['storage_path']}"
        )

    if args.list:
        return 0

    args.out.mkdir(parents=True, exist_ok=True)
    for row in rows:
        path = row["storage_path"]
        local = args.out / row["kind"] / Path(path).name
        local.parent.mkdir(parents=True, exist_ok=True)
        data = client.storage.from_("merge-private").download(path)
        local.write_bytes(data)
        print(f"saved {local}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

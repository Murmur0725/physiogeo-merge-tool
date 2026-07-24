#!/usr/bin/env python3
"""
Fetch baseline (AB) merge artifacts from the private Supabase archive.

Requires service-role key (never ship this to the website):
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_ROLE_KEY=...

Examples:
    python3 scripts/fetch_baseline.py --list
    python3 scripts/fetch_baseline.py --subject 001 --out ./baselines
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch private baseline_ab merges.")
    parser.add_argument("--list", action="store_true", help="List baseline artifacts.")
    parser.add_argument("--subject", help="Filter by subject_id.")
    parser.add_argument("--out", type=Path, default=Path("baselines"), help="Download directory.")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 1

    client = create_client(url, key)
    query = (
        client.table("merge_artifacts")
        .select("id,created_at,subject_id,subject_name,kind,storage_path,row_count,time_range")
        .eq("kind", "baseline_ab")
        .order("created_at", desc=True)
        .limit(args.limit)
    )
    if args.subject:
        query = query.eq("subject_id", args.subject)
    rows = query.execute().data or []

    if args.list or not rows:
        if not rows:
            print("No baseline_ab artifacts found.")
            return 0
        for row in rows:
            print(
                f"{row['created_at']}  {row['subject_id']} {row['subject_name']}  "
                f"rows={row.get('row_count')}  {row['storage_path']}"
            )
        if args.list:
            return 0

    args.out.mkdir(parents=True, exist_ok=True)
    for row in rows:
        path = row["storage_path"]
        local = args.out / Path(path).name
        data = client.storage.from_("merge-private").download(path)
        local.write_bytes(data)
        print(f"saved {local}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

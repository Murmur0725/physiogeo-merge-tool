#!/usr/bin/env python3
"""
Download private archives into a per-subject folder layout:

  {out}/{编号}-{姓名}/
    baseline.csv
    merge.csv
    survey.csv
    {编号}-{姓名}-raw/
      marks.csv / rr.csv / eeg.xlsx / gpx.gpx / hr.csv

Requires service-role (never ship to the website):
  export SUPABASE_URL=...
  export SUPABASE_SERVICE_ROLE_KEY=...

Examples:
  python3 scripts/export_subject_packs.py --list
  python3 scripts/export_subject_packs.py --out ./exports/subjects
  python3 scripts/export_subject_packs.py --subject 001 --out ./exports/subjects

  cd "/Users/qiuchan/Desktop/Chicago workshop/polite study/data/github-merge-site"
export SUPABASE_URL="https://tmluteeppknxslqohlpd.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtbHV0ZWVwcGtueHNscW9obHBkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg2NDMzMiwiZXhwIjoyMTAwNDQwMzMyfQ.kQf-C_YMXTcgQ1LygtsWupseb3cUAFXYYzf-D3MfMHw"
python3 scripts/export_subject_packs.py --out ./exports/subject
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("Install dependency: pip install supabase", file=sys.stderr)
    raise SystemExit(1)

BUCKET = "merge-private"


def safe_part(value: str) -> str:
    text = str(value or "").strip() or "unknown"
    text = re.sub(r"[\\/:*?\"<>|]+", "-", text)
    text = re.sub(r"\s+", "_", text)
    return text[:80] or "unknown"


def subject_folder(subject_id: str, subject_name: str) -> str:
    return f"{safe_part(subject_id)}-{safe_part(subject_name)}"


def latest_by_key(rows: list[dict], key_fn):
    """Keep newest row per key."""
    best: dict = {}
    for row in rows:
        key = key_fn(row)
        prev = best.get(key)
        if prev is None or str(row.get("created_at") or "") > str(prev.get("created_at") or ""):
            best[key] = row
    return best


def write_survey_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "created_at",
        "subject_id",
        "subject_name",
        "route_name",
        "session_instrument",
        "segment_key",
        "segment_label",
        "segment_order",
        "instrument_id",
        "answers_json",
        "scores_json",
        "response_id",
        "session_id",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "created_at": row.get("created_at", ""),
                    "subject_id": row.get("subject_id", ""),
                    "subject_name": row.get("subject_name", ""),
                    "route_name": row.get("route_name", ""),
                    "session_instrument": row.get("session_instrument", ""),
                    "segment_key": row.get("segment_key", ""),
                    "segment_label": row.get("segment_label", ""),
                    "segment_order": row.get("segment_order", ""),
                    "instrument_id": row.get("instrument_id", ""),
                    "answers_json": json.dumps(row.get("answers") or {}, ensure_ascii=False),
                    "scores_json": json.dumps(row.get("scores") or {}, ensure_ascii=False),
                    "response_id": row.get("response_id", ""),
                    "session_id": row.get("session_id", ""),
                }
            )


def download_storage(client, storage_path: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = client.storage.from_(BUCKET).download(storage_path)
    dest.write_bytes(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export per-subject archive packs from Supabase.")
    parser.add_argument("--list", action="store_true", help="List discovered subjects only.")
    parser.add_argument("--subject", help="Only export this subject_id.")
    parser.add_argument("--out", type=Path, default=Path("exports/subjects"), help="Output root.")
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
            file=sys.stderr,
        )
        return 1
    key = key.strip().strip('"').strip("'")
    if any(ord(ch) > 127 for ch in key) or key in {"你的_service_role", "YOUR_SERVICE_ROLE_KEY"}:
        print(
            "SUPABASE_SERVICE_ROLE_KEY looks invalid (placeholder or non-ASCII).\n"
            "Paste the real service_role secret from Supabase → Project Settings → API Keys\n"
            "(it usually starts with eyJ...).",
            file=sys.stderr,
        )
        return 1
    if not key.startswith("eyJ"):
        print(
            "Warning: SUPABASE_SERVICE_ROLE_KEY usually starts with eyJ... Continuing anyway.",
            file=sys.stderr,
        )

    client = create_client(url, key)

    art_q = (
        client.table("merge_artifacts")
        .select(
            "id,created_at,subject_id,subject_name,kind,window_label,storage_path,row_count,time_range"
        )
        .order("created_at", desc=True)
        .limit(args.limit)
    )
    if args.subject:
        art_q = art_q.eq("subject_id", args.subject)
    artifacts = art_q.execute().data or []

    # Fallback: discover subjects from storage listing if metadata table is empty.
    storage_files: list[str] = []
    try:
        for folder in ("baseline", "experiment", "raw"):
            listed = client.storage.from_(BUCKET).list(folder, {"limit": args.limit})
            for item in listed or []:
                name = item.get("name") or ""
                if not name or name.startswith(".") or "placeholder" in name.lower():
                    continue
                if folder == "raw":
                    # raw/{编号}-{姓名}/file.ext
                    nested = client.storage.from_(BUCKET).list(f"raw/{name}", {"limit": 50}) or []
                    for child in nested:
                        cname = child.get("name")
                        if cname and not cname.startswith("."):
                            storage_files.append(f"raw/{name}/{cname}")
                else:
                    storage_files.append(f"{folder}/{name}")
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: storage list failed: {exc}", file=sys.stderr)

    # Survey join via two queries (PostgREST).
    sessions_q = (
        client.table("review_sessions")
        .select("id,created_at,subject_id,subject_name,route_name,instrument_id")
        .order("created_at", desc=True)
        .limit(args.limit)
    )
    if args.subject:
        sessions_q = sessions_q.eq("subject_id", args.subject)
    sessions = sessions_q.execute().data or []
    session_by_id = {s["id"]: s for s in sessions}

    responses = []
    if sessions:
        session_ids = [s["id"] for s in sessions]
        # chunk in case of many sessions
        for i in range(0, len(session_ids), 50):
            chunk = session_ids[i : i + 50]
            resp = (
                client.table("survey_responses")
                .select("id,created_at,session_id,segment_id,instrument_id,answers,scores")
                .in_("session_id", chunk)
                .order("created_at", desc=True)
                .limit(args.limit)
                .execute()
                .data
                or []
            )
            responses.extend(resp)

    segments = []
    if responses:
        segment_ids = sorted({r["segment_id"] for r in responses if r.get("segment_id")})
        for i in range(0, len(segment_ids), 50):
            chunk = segment_ids[i : i + 50]
            segs = (
                client.table("review_segments")
                .select("id,segment_key,label,sort_order,session_id")
                .in_("id", chunk)
                .execute()
                .data
                or []
            )
            segments.extend(segs)
    seg_by_id = {s["id"]: s for s in segments}

    survey_rows_by_subject: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in responses:
        sess = session_by_id.get(r["session_id"]) or {}
        seg = seg_by_id.get(r["segment_id"]) or {}
        sid = sess.get("subject_id") or "unknown"
        sname = sess.get("subject_name") or "unknown"
        if args.subject and sid != args.subject:
            continue
        survey_rows_by_subject[(sid, sname)].append(
            {
                "created_at": r.get("created_at"),
                "subject_id": sid,
                "subject_name": sname,
                "route_name": sess.get("route_name"),
                "session_instrument": sess.get("instrument_id"),
                "segment_key": seg.get("segment_key"),
                "segment_label": seg.get("label"),
                "segment_order": seg.get("sort_order"),
                "instrument_id": r.get("instrument_id"),
                "answers": r.get("answers"),
                "scores": r.get("scores"),
                "response_id": r.get("id"),
                "session_id": r.get("session_id"),
            }
        )

    subjects: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"baseline": None, "merge": None, "raw_paths": [], "survey": []}
    )

    for row in artifacts:
        key = (row["subject_id"], row.get("subject_name") or "")
        kind = row.get("kind")
        if kind == "baseline_ab":
            prev = subjects[key]["baseline"]
            if prev is None or row["created_at"] > prev["created_at"]:
                subjects[key]["baseline"] = row
        elif kind == "experiment_cd":
            prev = subjects[key]["merge"]
            if prev is None or row["created_at"] > prev["created_at"]:
                subjects[key]["merge"] = row
        elif kind == "raw":
            subjects[key]["raw_paths"].append(row)

    def subject_key_from_storage_name(folder: str, name: str):
        """
        baseline/1-ZY-baseline.csv -> (1, ZY)
        experiment/1-ZY-experiment.csv -> (1, ZY)
        raw/1-ZY/... -> (1, ZY)
        """
        if folder == "raw":
            key_name = name
        elif name.endswith("-baseline.csv"):
            key_name = name[: -len("-baseline.csv")]
        elif name.endswith("-experiment.csv"):
            key_name = name[: -len("-experiment.csv")]
        else:
            key_name = Path(name).stem
        if not key_name or key_name.startswith(".") or "placeholder" in key_name.lower():
            return None
        if "-" not in key_name:
            return None
        sid, sname = key_name.split("-", 1)
        if not sid or sname.endswith(".csv") or "." in sname:
            return None
        return sid, sname

    # Infer subjects from storage paths if artifacts missing.
    path_re = re.compile(r"^(baseline|experiment|raw)/([^/]+)(?:/(.+))?$")
    for path in storage_files:
        m = path_re.match(path)
        if not m:
            continue
        folder, name, rest = m.group(1), m.group(2), m.group(3)
        parsed = subject_key_from_storage_name(folder, name)
        if not parsed:
            continue
        sid, sname = parsed
        if args.subject and sid != args.subject:
            continue
        subj_key = (sid, sname)
        fake = {
            "created_at": "",
            "subject_id": sid,
            "subject_name": sname,
            "storage_path": path,
            "kind": {
                "baseline": "baseline_ab",
                "experiment": "experiment_cd",
                "raw": "raw",
            }[folder],
        }
        if folder == "baseline" and subjects[subj_key]["baseline"] is None:
            subjects[subj_key]["baseline"] = fake
        elif folder == "experiment" and subjects[subj_key]["merge"] is None:
            subjects[subj_key]["merge"] = fake
        elif folder == "raw" and rest:
            if not any(r.get("storage_path") == path for r in subjects[subj_key]["raw_paths"]):
                subjects[subj_key]["raw_paths"].append(fake)

    for (sid, sname), rows in survey_rows_by_subject.items():
        subjects[(sid, sname)]["survey"] = sorted(
            rows, key=lambda r: (r.get("created_at") or "", r.get("segment_order") or 0)
        )

    # Drop placeholder / incomplete junk packs.
    subjects = {
        key: pack
        for key, pack in subjects.items()
        if key[0]
        and key[0] != "unknown"
        and not str(key[0]).startswith(".")
        and "placeholder" not in str(key[0]).lower()
        and not str(key[1]).endswith(".csv")
        and (pack["baseline"] or pack["merge"] or pack["raw_paths"] or pack["survey"])
    }
    if args.subject:
        subjects = {k: v for k, v in subjects.items() if k[0] == args.subject}

    if not subjects:
        print("No subjects found in merge_artifacts / storage / surveys.")
        return 0

    print(f"Found {len(subjects)} subject pack(s).")
    for (sid, sname), pack in sorted(subjects.items()):
        folder = subject_folder(sid, sname)
        print(
            f"- {folder}: baseline={'yes' if pack['baseline'] else 'no'}  "
            f"merge={'yes' if pack['merge'] else 'no'}  "
            f"raw={len(pack['raw_paths'])}  survey={len(pack['survey'])}"
        )

    if args.list:
        return 0

    args.out.mkdir(parents=True, exist_ok=True)
    for (sid, sname), pack in sorted(subjects.items()):
        root = args.out / subject_folder(sid, sname)
        root.mkdir(parents=True, exist_ok=True)
        raw_dir = root / f"{subject_folder(sid, sname)}-raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        if pack["baseline"]:
            download_storage(client, pack["baseline"]["storage_path"], root / "baseline.csv")
            print(f"saved {root / 'baseline.csv'}")

        if pack["merge"]:
            download_storage(client, pack["merge"]["storage_path"], root / "merge.csv")
            print(f"saved {root / 'merge.csv'}")

        # Prefer storage listing under raw/{key}/ when artifact rows are sparse.
        raw_paths = [r["storage_path"] for r in pack["raw_paths"] if r.get("storage_path")]
        key = subject_folder(sid, sname)
        if not raw_paths:
            try:
                nested = client.storage.from_(BUCKET).list(f"raw/{key}", {"limit": 50}) or []
                raw_paths = [f"raw/{key}/{item['name']}" for item in nested if item.get("name")]
            except Exception:
                pass

        for storage_path in sorted(set(raw_paths)):
            dest = raw_dir / Path(storage_path).name
            download_storage(client, storage_path, dest)
            print(f"saved {dest}")

        if pack["survey"]:
            write_survey_csv(root / "survey.csv", pack["survey"])
            print(f"saved {root / 'survey.csv'} ({len(pack['survey'])} rows)")
        else:
            # Still create an empty header-only survey.csv for consistency.
            write_survey_csv(root / "survey.csv", [])
            print(f"saved {root / 'survey.csv'} (empty)")

    print(f"Done. Output: {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

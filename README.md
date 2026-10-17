# PhysioGeo Studio

A browser-based toolkit for the Polite Study (Chicago Workshop): merge GPS,
EEG, HR, RR, and Mark files into a second-level aligned CSV. Built with
Vue 3 + Vite, deployed on GitHub Pages.

**Live:** https://murmur0725.github.io/physiogeo-merge-tool/

**Pages:** Merge (`/`) · Review (`/review`) · Demo (`/demo`) — biometric 3D pillars with street views and spectrograms from `public/biometric-demo/`.

## Published merge versions

- **V1 — five files:** https://murmur0725.github.io/physiogeo-merge-tool/v1/
  The original Mark CSV, RR CSV, EEG Excel, GPX and heart-rate CSV workflow.
  The original root URL remains a V1 alias. Existing timezone, RR forward-fill
  and GPS interpolation behavior is preserved.
- **V2 — phone ZIP + EEG CSV / Excel:** https://murmur0725.github.io/physiogeo-merge-tool/v2/
  Upload one complete Somatic City phone session ZIP and one EEG CSV or Excel
  (`.xlsx` / `.xls`) file. Excel must contain one recognizable EEG worksheet.
  The ZIP can contain an enclosing folder, but must contain exactly one each of
  `metadata.json`, `marks.csv`, `heart_rate_raw.csv`, `rr_raw.csv`, `gps_raw.csv`.
  Keep the complete 13-file export: the original ZIP is archived intact.
  Compressed and total uncompressed ZIP size are each limited to 100 MiB.

V2 accepts EEG data in either of these layouts:

1. One sample per row: a `time`, `timestamp`, `datetime`, `timestamp_utc`,
   `received_at_utc`, `unix_ms`, `received_unix_ms` or `timestamp_unix_ms`
   column, plus EEG columns using the existing output names (`attention`,
   `relaxation`, `delta`, etc.) or the original bilingual EEG labels.
   Unix columns are milliseconds. ISO timestamps with a UTC offset are absolute.
2. The original horizontal EEG layout in Excel or CSV: `Date/日期`,
   `时长(Duration)/秒(ss)`, `Time-set/时间集合`, and EEG feature rows.
   Comma-delimited series must be quoted as standard CSV fields.
   The native exporter splits long series strings into repeated rows at 30,000
   characters (32,767-character chunks are also recognized). V2 reconstructs
   adjacent chunks character-for-character before splitting samples, including
   numbers split between rows. Shorter series remain blank after their last
   available sample. Duplicate timestamps are averaged within the same second.

The processing log reports EEG sample coverage, reconstructed series, any gap
between the header end and last sample, and all-zero attention/relaxation in a
cut window. For horizontal exports the timestamp rule remains **header Date minus
Duration plus each Time-set offset**. Overlapping timestamps alone do not verify
the device's recording clock or signal quality. Source timing diagnostics are
stored in the result artifact's `metrics.eeg_source`.

Choose the timezone of offset-free EEG timestamps (Beijing by default in V2).
Phone timestamps use Unix milliseconds/UTC and the session timezone from
`metadata.json`; they do not depend on the importing computer's timezone.
Recording clocks still need to be synchronized. Missing/invalid windows or EEG
with no overlap are reported before upload. Ambiguous/nonexistent DST wall times
require an explicit UTC offset.

Both V2 windows are required: A→B baseline and C→D experiment, or all four
manual timestamps in the phone session timezone. Output uses the same 22-column
schema as V1, including `familarity` and `Mark`. Windows include their start and
end second, matching the legacy CSV layout. Each row represents that whole
second, rather than a precisely simultaneous measurement. Multiple valid
physiological samples in one second are averaged. RR requires the source `valid`
flag and a value of 300–2000 ms. Zero heart-rate readings are excluded. Missing
physiological samples stay blank. GPS uses the latest received usable fix within
the second, with accuracy 0–50 m and sample age at the end of the second ≤15 s.
GPS is not interpolated. This aligned CSV is for combined analysis; beat-level
HRV analysis should use `rr_raw.csv` from the preserved ZIP.

Both versions use the **same Supabase project**, `merge_artifacts` table and
private `merge-private` bucket, with the existing RLS. No new migration is needed
when migrations 001–004 have already been applied. V2 result metadata includes
`version`, `session_id`, timezones, cut boundaries and alignment rules.
V2 paths isolate each session from V1 and other V2 sessions:

```text
baseline/{subject}-v2-{session-id}-baseline.csv
experiment/{subject}-v2-{session-id}-experiment.csv
raw/{subject}-v2-{session-id}/session.zip
raw/{subject}-v2-{session-id}/eeg.{csv|xlsx|xls}
```

Reprocessing the same subject/session replaces that session's stored files,
using the existing private upload policy. Researchers can retrieve artifacts
using `fetch_baseline.py`; use artifact `metrics.session_id` to distinguish
sessions when comparing runs. Existing per-subject exports select the latest
baseline and experiment; use the stored session paths when retrieving individual
V2 recordings.
Only the experiment CSV is offered as a local website download. Baseline and
raw uploads remain private. An incomplete archive is reported as a partial save.

## Usage

1. Fill in 编号 (Equipment ID) and 姓名 (Name).
2. Upload the five raw files:

   - Mark CSV: `展示时间`, `备注`
     - **C / D** define the website merge window (experiment)
     - **A / B** define the baseline window (aligned in background, archived privately)
     - Legacy fallback for merge only: `开始` / `结束`
   - RR CSV: `timestamp`, `rr_ms`
   - EEG Excel: `Date/日期`, `时长(Duration)/秒(ss)`, `Time-set/时间集合`, EEG feature rows
     - On the Merge page, set **Route timezone** to `Chicago` or `Beijing` (default: Chicago). `Chicago` converts EEG `Date/日期` from Beijing wall clock to Chicago before alignment; `Beijing` keeps the EEG timestamp as written.
   - GPX: `trkpt` latitude, longitude, and `time`
   - Heart-rate CSV: metadata `Date`, `Start time`, and sample columns `Time`, `HR (bpm)`

3. Generate:
   - Preview + **Download CD Merge** → `编号姓名-merge.csv` (C→D only; website download)
   - Background private archive (no website download from DB):
     - `experiment_cd` — CD merge CSV
     - `baseline_ab` — AB baseline CSV
     - `raw` — the five uploaded input files (marks/rr/eeg/gpx/hr)

All parsing happens locally in the browser. GBK/ANSI-encoded CSV exports are
decoded automatically. Archive uploads leave the browser only when Supabase
env vars are configured (insert-only; anon cannot SELECT).

## Post-test workflow

Review setup requires **Subjector ID** in both Pre-test and Post-test. Use the
same ID as Merge V1 / V2 so questionnaire and physiological records share the
same `subject_id`. The value persists when switching phases, is trimmed before
saving, and is included in the existing session row and private JSON snapshot.
Missing or whitespace-only IDs block submission and archive writes. No schema
migration is needed.

Review setup uses a two-option **Walk order** dropdown in place of Equipment ID: **Clockwise: commercial → green** (`clockwise_commercial_first`, default) or **Counterclockwise: green → commercial** (`counterclockwise_green_first`). The selection persists when switching between Pre-test and Post-test. Both phases save the condition as `walkingOrder` plus `walkingOrderLabel` in each archived response and at the top of the JSON snapshot; it is kept separate from participant identity. No schema migration is needed. Review labels, photo placeholders, and map language are English.

On Review, switch to Post-test, answer and confirm each of the two route sections (POMS-30 plus the open-ended walking experience). Confirming the last section opens a final **UX/UI evaluation** with the four [UMUX statements](https://www.uxtesttools.com/tools/umux). Each question requires one answer from 1 (Strongly disagree) to 7 (Strongly agree); no answer is preselected. Final submission stays disabled until both route sections are confirmed and all four UMUX items are answered. Returning to edit a route answer requires confirming that section again, while retaining the UMUX draft.

UMUX is recorded once for the web platform as a whole. The same post-test session contains two `posttest` responses and one `umux` response. To work with migration 005's required scope foreign key, the platform response has a separate `__platform_umux__` scope row with empty geometry; it is not a third geographic route section. Raw answers (`u1`–`u4`), instrument version, and scores are saved in `survey_responses` and in the session JSON snapshot's `platformEvaluation` object. Existing researcher survey exports include this response through its `instrument_id = umux`. No new database migration is required.

Scoring follows [Finstad (2010), section 4.2](https://doi.org/10.1016/j.intcom.2010.04.004): `((u1 - 1) + (7 - u2) + (u3 - 1) + (7 - u4)) / 24 * 100`. Items 2 and 4 are reverse-scored; the 0–24 recoded total and 0–100 score (rounded to two decimals) are stored, while raw answers remain unchanged. This uses the original scoring method rather than the reference website's divide-by-28 example. Scores are not displayed to participants during the questionnaire.

Run `npm test` for required-answer gates, score boundaries, archive payload checks, and pre-test compatibility. `npm run build` checks the production bundle. Browser verification also covers the two-section transition, blocking final submission with only three UMUX answers, enabling it with four, and invalidating confirmation after a route edit. Browser checks use disposable local drafts without submitting test responses to the research archive.

## Private archive

1. Apply migrations in order:
   - `supabase/migrations/001_merge_artifacts.sql`
   - `supabase/migrations/002_expand_archive_kinds.sql`
2. Copy `.env.example` → `.env.local` and set:

   ```bash
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...   # publishable/anon — never secret
   ```

3. Researchers fetch with the service role (never in the website):

   ```bash
   export SUPABASE_URL=...
   export SUPABASE_SERVICE_ROLE_KEY=...
   python3 scripts/fetch_baseline.py --list --kind all
   python3 scripts/fetch_baseline.py --subject 001 --kind experiment_cd --out ./exports
   python3 scripts/fetch_baseline.py --subject 001 --kind raw --out ./raws

   # Per-subject pack: baseline.csv + merge.csv + survey.csv + {编号}-{姓名}-raw/
   python3 scripts/export_subject_packs.py --list
   python3 scripts/export_subject_packs.py --out ./exports/subjects
   ```

Storage layout under bucket `merge-private`:

```text
experiment/{编号}-{姓名}-experiment.csv
baseline/{编号}-{姓名}-baseline.csv
raw/{编号}-{姓名}/
  marks.csv
  rr.csv
  eeg.xlsx
  gpx.gpx
  hr.csv
```

（姓名若含中文/特殊字符，路径里会转成安全 ASCII；`upsert` 覆盖同名文件。）

## CLI (Python, same windows)

From `data/`:

```bash
# CD merge (default)
python3 merge_raw_data_with_time_alignment.py --window cd

# AB baseline only
python3 merge_raw_data_with_time_alignment.py --window ab

# Both files
python3 merge_raw_data_with_time_alignment.py --window both
```

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```

Pushing to `main` triggers a GitHub Actions workflow that builds and deploys
to GitHub Pages automatically. Add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
as Actions secrets (and wire them into the build env) to enable private baseline
upload in production.

## Roadmap

- **Archive** — Supabase private storage for CD merge + baseline + raw ✅

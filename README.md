# PhysioGeo Studio

A browser-based toolkit for the Polite Study (Chicago Workshop): merge GPS,
EEG, HR, RR, and Mark files into a second-level aligned CSV. Built with
Vue 3 + Vite, deployed on GitHub Pages.

**Live:** https://murmur0725.github.io/physiogeo-merge-tool/

## Usage

1. Fill in 编号 (Subject ID) and 姓名 (Name).
2. Upload the five raw files:

   - Mark CSV: `展示时间`, `备注`
     - **C / D** define the website merge window (experiment)
     - **A / B** define the baseline window (aligned in background, archived privately)
     - Legacy fallback for merge only: `开始` / `结束`
   - RR CSV: `timestamp`, `rr_ms`
   - EEG Excel: `Date/日期`, `时长(Duration)/秒(ss)`, `Time-set/时间集合`, EEG feature rows
   - GPX: `trkpt` latitude, longitude, and `time`
   - Heart-rate CSV: metadata `Date`, `Start time`, and sample columns `Time`, `HR (bpm)`

3. Generate:
   - Preview + **Download CD Merge** → `编号姓名-merge.csv` (C→D only)
   - AB baseline is generated in the background and uploaded to private Supabase
     storage / `merge_artifacts` (website has **no** baseline download button)

All parsing happens locally in the browser. GBK/ANSI-encoded CSV exports are
decoded automatically. Baseline binary leaves the browser only when Supabase
env vars are configured (insert-only; anon cannot SELECT).

## Baseline archive (private)

1. Apply `supabase/migrations/001_merge_artifacts.sql` in your Supabase project.
2. Copy `.env.example` → `.env.local` and set:

   ```bash
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

3. Researchers fetch baseline with the service role (never in the website):

   ```bash
   export SUPABASE_URL=...
   export SUPABASE_SERVICE_ROLE_KEY=...
   python3 scripts/fetch_baseline.py --list
   python3 scripts/fetch_baseline.py --subject 001 --out ./baselines
   ```

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

- **Map** — Mapbox GL track visualization with physiological overlays
- **Street View** — Mapillary integration
- **Survey** — questionnaire module
- **Archive** — Supabase private storage for baseline (+ optional CD) ✅ schema ready

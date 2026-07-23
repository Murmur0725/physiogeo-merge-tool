# PhysioGeo Studio

A browser-based toolkit for the Polite Study (Chicago Workshop): merge GPS,
EEG, HR, RR, and Mark files into a second-level aligned CSV. Built with
Vue 3 + Vite, deployed on GitHub Pages.

**Live:** https://murmur0725.github.io/physiogeo-merge-tool/

## Usage

1. Fill in 编号 (Subject ID) and 姓名 (Name).
2. Upload the five raw files:

   - Mark CSV: `展示时间`, `备注` (rows containing 开始 / 结束 define the output window)
   - RR CSV: `timestamp`, `rr_ms`
   - EEG Excel: `Date/日期`, `时长(Duration)/秒(ss)`, `Time-set/时间集合`, EEG feature rows
   - GPX: `trkpt` latitude, longitude, and `time`
   - Heart-rate CSV: metadata `Date`, `Start time`, and sample columns `Time`, `HR (bpm)`

3. Generate, preview, and download `编号姓名-merge.csv`.

All parsing happens locally in the browser. GBK/ANSI-encoded CSV exports are
decoded automatically.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```

Pushing to `main` triggers a GitHub Actions workflow that builds and deploys
to GitHub Pages automatically.

## Roadmap

- **Map** — Mapbox GL track visualization with physiological overlays
- **Street View** — Mapillary integration
- **Survey** — questionnaire module
- **Archive** — Supabase private storage for merged + raw data

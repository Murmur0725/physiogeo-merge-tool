# PhysioGeo Merge Tool

A browser-only tool for merging GPS, EEG, HR, RR, and Mark files into a
second-level aligned CSV.

## Input files

Upload these raw files:

- Mark CSV: `展示时间`, `备注`
- RR CSV: `timestamp`, `rr_ms`
- EEG Excel: `Date/日期`, `时长(Duration)/秒(ss)`, `Time-set/时间集合`, EEG feature rows
- GPX: `trkpt` latitude, longitude, and `time`
- Heart-rate CSV: metadata `Date`, `Start time`, and sample columns `Time`, `HR (bpm)`

CSV files exported from Chinese Windows Excel (GBK/ANSI encoded) are decoded
automatically.

## Output

Fill in 编号 (Subject ID) and 姓名 (Name) before merging — the Generate button
stays disabled until both are filled. The exported file is named
`编号姓名-merge.csv` (for example `001张三-merge.csv`).

Columns:

```text
time, location, rr, attention, relaxation, delta, theta, low_alpha,
high_alpha, low_beta, high_beta, low_gamma, mid_gamma, pitch, yaw,
roll, sync_rate, mental_effort, familarity, temperature, heart_rate, Mark
```

## Privacy

All parsing and merging happens in the browser. Raw data is not uploaded to a
server.

## Publish on GitHub Pages

1. Create a GitHub repository.
2. Put `index.html` from this folder in the repository root.
3. Commit and push.
4. In GitHub, open **Settings → Pages**.
5. Choose **Deploy from a branch**.
6. Select the `main` branch and `/root`.
7. Open the generated GitHub Pages URL.

The page uses SheetJS from a CDN to parse Excel files, so the deployed page
needs internet access.

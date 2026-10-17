import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { eegRows, finalColumns, parseCsv, toCsv } from "./merge.js";

const MAX_BYTES = 100 * 1024 * 1024;
const numeric = (value) => String(value ?? "").trim() === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const second = (ms) => Math.floor(ms / 1000) * 1000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const decode = (bytes) => {
  try { return decoder.decode(bytes); } catch { return new TextDecoder("gbk").decode(bytes); }
};
const objects = (text) => {
  return objectsFromRows(parseCsv(text));
};
const objectsFromRows = ([headers = [], ...rows]) => {
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h.trim(), row[i] ?? ""])));
};

export function formatZoned(ms, timeZone) {
  const parts = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(ms)).forEach((p) => { parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// Convert wall-clock input independently of the computer's timezone. Reject
// nonexistent/ambiguous DST times rather than silently choosing a different instant.
export function parseZoned(value, timeZone) {
  const text = String(value ?? "").trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${text}`);
    return ms;
  }
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) throw new Error(`Invalid timestamp: ${text}. Use YYYY-MM-DD HH:mm:ss.`);
  const wall = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => {
    const probe = base + delta;
    return Date.parse(formatZoned(probe, timeZone).replace(" ", "T") + "Z") - probe;
  }));
  const matches = [...offsets].map((offset) => base - offset).filter((ms) => formatZoned(ms, timeZone) === wall);
  if (matches.length !== 1) throw new Error(`Invalid or ambiguous local time: ${text} (${timeZone}). Use an explicit UTC offset.`);
  return matches[0] + Number((m[7] || "").padEnd(3, "0"));
}

export function extractSession(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error("ZIP exceeds the 100 MB limit.");
  let expanded = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    const filename = entry.name.split("/").pop();
    if (entry.name.endsWith("/") || entry.name.startsWith("__MACOSX/") || filename === ".DS_Store" || filename.startsWith("._")) return false;
    expanded += entry.originalSize;
    if (expanded > MAX_BYTES) throw new Error("Uncompressed ZIP exceeds the 100 MB limit.");
    return true;
  } });
  const lookup = (name) => {
    const found = Object.entries(entries).filter(([path]) => path.split("/").pop() === name);
    if (found.length !== 1) throw new Error(`ZIP must contain exactly one ${name}; found ${found.length}. Upload one session ZIP.`);
    return decode(found[0][1]);
  };
  const metadata = JSON.parse(lookup("metadata.json"));
  if (!metadata.id || !metadata.timeZoneIdentifier) throw new Error("metadata.json is missing the session ID or timezone.");
  formatZoned(0, metadata.timeZoneIdentifier); // Validate the supplied timezone.
  const table = (name, required) => {
    const text = lookup(name);
    const headers = (parseCsv(text)[0] || []).map((header) => header.trim());
    if (required.some((header) => !headers.includes(header))) throw new Error(`${name} is missing required columns: ${required.join(", ")}.`);
    return objects(text);
  };
  return {
    metadata, marks: table("marks.csv", ["unix_ms", "备注"]),
    heart: table("heart_rate_raw.csv", ["received_unix_ms", "bpm"]),
    rr: table("rr_raw.csv", ["received_unix_ms", "rr_ms", "valid"]),
    gps: table("gps_raw.csv", ["sampled_unix_ms", "received_unix_ms", "latitude", "longitude", "accuracy_m", "usable"]),
    fileCount: Object.keys(entries).length
  };
}

export function parseEEGCsv(text, timeZone) {
  return parseEEGRows(parseCsv(text), timeZone);
}

function parseEEGRows(inputRows, timeZone, onInfo = () => {}) {
  const rows = inputRows.map((row) => row.map((value) => String(value ?? "")));
  if (!rows.length) throw new Error("EEG file is empty.");
  const samples = [];
  const dictionary = {};
  const seriesNames = new Set([...Object.keys(eegRows), "Time-set/时间集合"]);
  const reassembled = [];
  rows.forEach((row, index) => {
    const key = String(row[0]).trim();
    if (!seriesNames.has(key)) { dictionary[key] = row[1]; return; }
    if (Object.hasOwn(dictionary, key)) {
      // Native EEG exports split long strings at 30,000 characters, including
      // inside numbers. Appending a comma here would corrupt the boundary beat.
      const previous = rows[index - 1];
      if (previous?.[0]?.trim() !== key || ![30000, 32767].includes(previous[1]?.length)) {
        throw new Error(`Repeated EEG series ${key} is not a recognized continuation. Export one recording per file.`);
      }
      dictionary[key] += row[1] ?? "";
      if (!reassembled.includes(key)) reassembled.push(key);
    } else dictionary[key] = row[1] ?? "";
  });
  const info = { format: "timestamp_rows", reconstructed_series: reassembled, field_sample_counts: {} };
  if (dictionary["Date/日期"] !== undefined && (dictionary["时长(Duration)/秒(ss)"] !== undefined || dictionary["Time-set/时间集合"] !== undefined)) {
    info.format = "horizontal_series";
    const duration = numeric(dictionary["时长(Duration)/秒(ss)"]);
    if (duration === null || duration < 0) throw new Error("EEG duration is missing or invalid.");
    info.header_end_unix_ms = parseZoned(dictionary["Date/日期"], timeZone);
    info.header_duration_s = duration;
    const start = info.header_end_unix_ms - duration * 1000;
    const offsets = String(dictionary["Time-set/时间集合"] || "").split(",");
    info.time_offset_count = offsets.filter((offset) => numeric(offset) !== null).length;
    const series = Object.entries(eegRows).map(([source, dest]) => [dest, String(dictionary[source] ?? "").split(",")]);
    series.forEach(([field, values]) => { info.field_sample_counts[field] = values.filter((value) => numeric(value) !== null).length; });
    offsets.forEach((offset, i) => {
      if (numeric(offset) === null) return;
      if (Number(offset) < 0 || Number(offset) > duration) throw new Error("EEG time offsets fall outside the declared duration.");
      samples.push({ ms: start + Number(offset) * 1000, values: Object.fromEntries(series.map(([key, values]) => [key, numeric(values[i])])) });
    });
  } else {
    const headers = rows[0].map((h) => h.trim());
    const timeFields = ["timestamp_unix_ms", "received_unix_ms", "unix_ms", "timestamp_utc", "received_at_utc", "time", "timestamp", "datetime", "Date/日期", "北京时间"];
    const timeField = timeFields.find((key) => headers.includes(key));
    if (!timeField) throw new Error("EEG CSV needs a time/timestamp/timestamp_utc/unix_ms column, or Date/Duration/Time-set rows.");
    const aliases = Object.fromEntries(Object.entries(eegRows).map(([source, dest]) => [dest, headers.includes(dest) ? dest : source]));
    if (!Object.values(aliases).some((key) => headers.includes(key))) throw new Error("EEG CSV has no recognized EEG columns (e.g. attention, relaxation, delta).");
    objectsFromRows(rows).forEach((row, i) => {
      if (!row[timeField]?.trim()) throw new Error(`EEG row ${i + 2} has no timestamp.`);
      const ms = timeField.endsWith("unix_ms") ? numeric(row[timeField]) : parseZoned(row[timeField], timeZone);
      if (!Number.isFinite(ms)) throw new Error(`EEG row ${i + 2} has an invalid timestamp.`);
      samples.push({ ms, values: Object.fromEntries(Object.entries(aliases).map(([dest, source]) => [dest, numeric(row[source])])) });
    });
  }
  const groups = new Map();
  samples.forEach(({ ms, values }) => {
    const key = second(ms);
    if (!groups.has(key)) groups.set(key, {});
    const group = groups.get(key);
    Object.entries(values).forEach(([field, value]) => {
      if (value === null) return;
      if (!group[field]) group[field] = [];
      group[field].push(value);
    });
  });
  const map = new Map([...groups].filter(([, fields]) => Object.keys(fields).length).map(([key, fields]) => [key,
    Object.fromEntries(Object.entries(fields).map(([field, values]) => [field, values.reduce((a, b) => a + b, 0) / values.length]))
  ]));
  if (!map.size) throw new Error("EEG CSV contains no timestamped numeric samples.");
  const times = [...map.keys()];
  info.first_sample_unix_ms = Math.min(...times);
  info.last_sample_unix_ms = Math.max(...times);
  info.seconds_with_samples = map.size;
  onInfo(info);
  return map;
}

export async function parseEEGFile(file, timeZone) {
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Upload an EEG CSV or Excel (.xlsx/.xls) file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let rows, sheetName;
  if (/\.csv$/i.test(file.name)) rows = parseCsv(decode(bytes));
  else {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
    const sheets = workbook.SheetNames.map((name) => ({ name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, blankrows: false })
    })).filter(({ rows: values }) => values.some((row) => Object.hasOwn(eegRows, String(row[0]).trim()))
      || values[0]?.some((value) => Object.values(eegRows).includes(String(value).trim())));
    if (sheets.length !== 1) throw new Error(`EEG Excel must contain one recognizable EEG worksheet; found ${sheets.length}.`);
    rows = sheets[0].rows; sheetName = sheets[0].name;
  }
  let info;
  const samples = parseEEGRows(rows, timeZone, (value) => { info = value; });
  return { samples, info: { ...info, sheet: sheetName || null, source_file: file.name } };
}

function rawTime(row, prefix = "received") {
  const ms = numeric(row[`${prefix}_unix_ms`]);
  const fallback = Date.parse(row[`${prefix}_at_utc`]);
  return ms ?? fallback;
}

export function alignSession(session, eeg, options = {}) {
  const { metadata, marks, heart, rr, gps } = session;
  const zone = metadata.timeZoneIdentifier;
  const events = marks.map((row) => ({
    ms: numeric(row.unix_ms) ?? Date.parse(row.timestamp_utc), code: row["备注"]
  })).sort((a, b) => a.ms - b.ms);
  if (events.some((event) => !Number.isFinite(event.ms))) throw new Error("ZIP contains an invalid event timestamp.");
  const averages = (rows, field, include) => {
    const groups = new Map();
    rows.filter(include).forEach((row) => {
      const ms = rawTime(row), value = numeric(row[field]);
      if (!Number.isFinite(ms) || value === null) return;
      const key = second(ms);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    });
    return new Map([...groups].map(([key, values]) => [key, Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000]));
  };
  const hrMap = averages(heart, "bpm", (r) => numeric(r.bpm) > 0);
  const rrMap = averages(rr, "rr_ms", (r) => r.valid === "Y" && numeric(r.rr_ms) >= 300 && numeric(r.rr_ms) <= 2000);
  const points = gps.map((row) => ({
    ms: rawTime(row, "sampled"), received: rawTime(row), lat: numeric(row.latitude), lon: numeric(row.longitude),
    accuracy: numeric(row.accuracy_m), usable: row.usable === "Y"
  })).filter((p) => p.usable && Number.isFinite(p.ms) && Number.isFinite(p.received) && p.lat !== null && p.lon !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.accuracy !== null && p.accuracy >= 0 && p.accuracy <= 50)
    .sort((a, b) => a.received - b.received);

  function cut(startCode, endCode, manual, kind, label) {
    let start, end;
    if (manual?.start || manual?.end) {
      start = parseZoned(manual.start, zone); end = parseZoned(manual.end, zone);
    } else {
      const starts = events.filter((e) => e.code === startCode);
      const ends = events.filter((e) => e.code === endCode);
      if (starts.length !== 1 || ends.length !== 1) throw new Error(`V2 needs exactly one ${startCode} and ${endCode} mark, or enter both manual timestamps.`);
      start = starts[0].ms; end = ends[0].ms;
    }
    if (start >= end) throw new Error(`${label}: end must be after start.`);
    if (end - start > 24 * 3600 * 1000) throw new Error(`${label} exceeds 24 hours. Check timestamps.`);
    const rows = [];
    let cursor = 0, latest = null;
    for (let ms = second(start); ms <= second(end); ms += 1000) {
      const row = Object.fromEntries(finalColumns.map((key) => [key, ""]));
      row.time = formatZoned(ms, zone);
      row.rr = rrMap.get(ms) ?? "";
      row.heart_rate = hrMap.get(ms) ?? "";
      Object.assign(row, eeg.get(ms) || {});
      row.Mark = events.filter((e) => second(e.ms) === ms).map((e) => e.code).join(" | ");
      // One-second bins: latest received, usable fix at the end of the bin.
      while (cursor < points.length && points[cursor].received < ms + 1000) {
        if (!latest || points[cursor].ms >= latest.ms) latest = points[cursor];
        cursor += 1;
      }
      if (latest && latest.ms < ms + 1000 && ms + 999 - latest.ms <= 15000) row.location = `${latest.lat.toFixed(6)},${latest.lon.toFixed(6)}`;
      rows.push(row);
    }
    const eegCount = rows.filter((r) => Object.keys(eegRows).some((source) => r[eegRows[source]] !== "")).length;
    if (!eegCount) throw new Error(`${label}: EEG has no samples in this window. Check EEG timezone, date and device clock.`);
    return { rows, csv: toCsv(rows), kind, label, range: `${rows[0].time} → ${rows.at(-1).time}`,
      metrics: { rows: rows.length, gps: rows.filter((r) => r.location).length, rr: rows.filter((r) => r.rr !== "").length,
        hr: rows.filter((r) => r.heart_rate !== "").length, eeg: eegCount, version: "v2", session_id: metadata.id,
        time_zone: zone, eeg_time_zone: options.eegTimeZone, rr_method: "valid_only_mean_per_second_no_fill",
        eeg_source: options.eegInfo,
        gps_method: "latest_usable_received_fix_max_age_15s", window_start_unix_ms: start, window_end_unix_ms: end }
    };
  }
  const baseline = cut("A", "B", options.manualBaselineWindow, "baseline_ab", "baseline AB");
  const experiment = cut("C", "D", options.manualWindow, "experiment_cd", "experiment CD");
  if (baseline.metrics.window_end_unix_ms > experiment.metrics.window_start_unix_ms) throw new Error("Baseline must end before the experiment starts.");
  return { baseline, experiment, metadata };
}

export async function runMergeV2(files, log = () => {}, options = {}) {
  if (!files.zip || !files.eeg) throw new Error("Upload the phone session ZIP and EEG CSV or Excel file.");
  if (files.zip.size > MAX_BYTES) throw new Error("ZIP exceeds the 100 MB limit.");
  const session = extractSession(new Uint8Array(await files.zip.arrayBuffer()));
  log(`V2 session ${session.metadata.id}: ${session.fileCount} files; timezone ${session.metadata.timeZoneIdentifier}.`);
  const eegTimeZone = options.eegTimezone === "chicago" ? "America/Chicago" : "Asia/Shanghai";
  const { samples: eeg, info } = await parseEEGFile(files.eeg, eegTimeZone);
  const result = alignSession(session, eeg, { ...options, eegTimeZone, eegInfo: info });
  log(`EEG samples: ${formatZoned(info.first_sample_unix_ms, eegTimeZone)} → ${formatZoned(info.last_sample_unix_ms, eegTimeZone)} (${eegTimeZone}).`);
  if (info.reconstructed_series.length) log(`Reconstructed split EEG series: ${info.reconstructed_series.join(", ")}.`);
  if (info.header_end_unix_ms && info.header_end_unix_ms - info.last_sample_unix_ms > 1000) {
    log(`EEG last sample is ${(info.header_end_unix_ms - info.last_sample_unix_ms) / 1000} seconds before the header end time. Alignment uses header end minus duration plus Time-set offsets; verify the device clock and export semantics.`);
  }
  for (const part of [result.baseline, result.experiment]) {
    const present = part.rows.filter((row) => row.attention !== "" && row.relaxation !== "");
    if (present.length && present.every((row) => row.attention === 0 && row.relaxation === 0)) {
      log(`${part.label}: attention and relaxation are zero in all ${present.length} available seconds. Check the original recording before interpreting these values.`);
    }
  }
  log("One row per second. Valid RR only; no physiological gap filling. GPS fixes expire after 15 seconds.");
  log(`Baseline: ${result.baseline.range}; experiment: ${result.experiment.range}.`);
  if (session.metadata.status !== "finished") log(`Session status: ${session.metadata.status}; verify recording completeness.`);
  return result;
}

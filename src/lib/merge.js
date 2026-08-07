import * as XLSX from "xlsx";

export const finalColumns = [
  "time", "location", "rr", "attention", "relaxation", "delta", "theta",
  "low_alpha", "high_alpha", "low_beta", "high_beta", "low_gamma",
  "mid_gamma", "pitch", "yaw", "roll", "sync_rate", "mental_effort",
  "familarity", "temperature", "heart_rate", "Mark"
];

const eegRows = {
  "Attention/注意力": "attention",
  "Relaxation/放松度": "relaxation",
  "Delta/δ波": "delta",
  "Theta/θ波": "theta",
  "Low-Alpha/低α波": "low_alpha",
  "High-Alpha/高α波": "high_alpha",
  "Low-Beta/低β波": "low_beta",
  "High-Beta/高β波": "high_beta",
  "Low-Gamma/低γ波": "low_gamma",
  "Mid-Gamma/高γ波": "mid_gamma",
  "Pitch/俯仰角": "pitch",
  "Yaw/偏航角": "yaw",
  "Roll/滚转角": "roll",
  "SyncRate/同步率": "sync_rate",
  "MentalEffort/用脑度": "mental_effort",
  "Familarity/熟练度": "familarity",
  "temperature/体温": "temperature"
};

function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

// CSV exports from Chinese Windows Excel are often GBK encoded; fall back
// to GBK when strict UTF-8 decoding fails so Chinese headers stay intact.
async function readTextSmart(file) {
  const buffer = await readArrayBuffer(file);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gbk").decode(buffer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => String(item).trim() !== ""));
}

function rowsToObjects(rows) {
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((row) => {
    const out = {};
    headers.forEach((h, i) => {
      out[h] = row[i] ?? "";
    });
    return out;
  });
}

function parseLocalDateTime(value) {
  const text = String(value).trim().replace("T", " ").replace(/\.\d+$/, "");
  const [datePart, timePart = "00:00:00"] = text.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTime(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + " " + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":");
}

function toSecond(date) {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function parseDurationSeconds(value) {
  const parts = String(value).trim().split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(value) || 0;
}

function splitSeries(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").filter((item) => item !== "");
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

/**
 * Reinterpret wall-clock components of `date` as `fromTimeZone`, return a
 * Date whose local getters match the wall clock in `toTimeZone`.
 */
export function convertWallClock(date, fromTimeZone, toTimeZone) {
  if (!date || Number.isNaN(date.getTime())) return date;
  if (!fromTimeZone || !toTimeZone || fromTimeZone === toTimeZone) return date;

  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  const hh = date.getHours();
  const mi = date.getMinutes();
  const ss = date.getSeconds();
  const wall = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mi)}:${pad(ss)}`;

  // Asia/Shanghai is fixed UTC+8 — attach offset so Date parses an absolute instant.
  let instant;
  if (fromTimeZone === "Asia/Shanghai") {
    instant = new Date(`${wall}+08:00`);
  } else {
    // Generic path: guess UTC then refine with Intl (rare for this app).
    instant = new Date(`${wall}Z`);
    const probe = new Intl.DateTimeFormat("en-US", {
      timeZone: fromTimeZone,
      timeZoneName: "shortOffset"
    });
    // Fall through with Z guess; Chicago←Beijing is the supported path.
    void probe;
  }
  if (Number.isNaN(instant.getTime())) return date;

  const bag = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: toTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(instant)
    .forEach((p) => {
      if (p.type !== "literal") bag[p.type] = p.value;
    });

  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return new Date(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    hour,
    Number(bag.minute),
    Number(bag.second),
    0
  );
}

export const EEG_TIMEZONE_OPTIONS = {
  // Chicago: EEG Date wall clock is Beijing → convert to Chicago for alignment.
  chicago: {
    id: "chicago",
    label: "Chicago",
    from: "Asia/Shanghai",
    to: "America/Chicago"
  },
  // Beijing: keep EEG Date wall clock as written (no conversion).
  beijing: { id: "beijing", label: "Beijing", from: null, to: null }
};

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : "";
}

/** Exact stage labels used in Mark 备注 (A/B/C/D). */
export const STAGE_WINDOWS = {
  ab: { start: "A", end: "B", label: "baseline AB", kind: "baseline_ab" },
  cd: { start: "C", end: "D", label: "experiment CD", kind: "experiment_cd" }
};

function normalizeMark(value) {
  return String(value ?? "").trim();
}

function findExactMark(marks, label) {
  const target = normalizeMark(label);
  return marks.find((m) => normalizeMark(m.mark) === target) || null;
}

/**
 * Resolve a time window from Mark rows.
 * Preferred: exact A/B (baseline) or C/D (experiment merge).
 * Legacy fallback for CD only: 备注 containing 开始 / 结束.
 */
function resolveWindow(marks, windowKey) {
  const spec = STAGE_WINDOWS[windowKey];
  if (!spec) {
    throw new Error(`Unknown window "${windowKey}". Use "ab" or "cd".`);
  }

  let start = findExactMark(marks, spec.start);
  let end = [...marks].reverse().find((m) => normalizeMark(m.mark) === spec.end) || null;

  if ((!start || !end) && windowKey === "cd") {
    start = marks.find((m) => normalizeMark(m.mark).includes("开始")) || start;
    end = [...marks].reverse().find((m) => normalizeMark(m.mark).includes("结束")) || end;
  }

  if (!start || !end) {
    const seen = marks.map((m) => m.mark).filter(Boolean).slice(0, 12).join(" | ") || "(empty)";
    const needed =
      windowKey === "cd"
        ? "C and D (or legacy 开始/结束)"
        : "A and B";
    throw new Error(`Mark CSV must contain ${needed} in the notes column (备注) for ${spec.label}. Found notes: ${seen}`);
  }
  if (start.time > end.time) {
    throw new Error(`${spec.label} window is inverted: ${start.time} > ${end.time}`);
  }

  return buildWindowFromRange(start.time, end.time, marks, {
    window: windowKey,
    kind: spec.kind,
    label: spec.label
  });
}

/**
 * Normalize a typed / datetime-local string to `YYYY-MM-DD HH:mm:ss`.
 */
export function normalizeTimestampInput(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("Timestamp is empty.");
  }
  const date = toSecond(parseLocalDateTime(text));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: "${text}". Use YYYY-MM-DD HH:mm:ss`);
  }
  return formatTime(date);
}

function buildWindowFromRange(start, end, marks = [], meta = {}) {
  if (start > end) {
    throw new Error(`Window is inverted: ${start} > ${end}`);
  }
  const clipped = marks.filter((m) => m.time >= start && m.time <= end);
  const map = new Map();
  clipped.forEach((m) => {
    map.set(m.time, map.has(m.time) ? `${map.get(m.time)} | ${m.mark}` : m.mark);
  });
  return {
    start,
    end,
    map,
    window: meta.window || "cd",
    kind: meta.kind || "experiment_cd",
    label: meta.label || "manual window"
  };
}

async function loadAllMarks(file) {
  const rows = parseCsv(await readTextSmart(file));
  const headers = rows.length ? rows[0].map((h) => String(h).trim()) : [];
  if (!headers.includes("展示时间") || !headers.includes("备注")) {
    throw new Error(`Mark CSV missing required columns 展示时间 / 备注. Found headers: ${headers.join(" | ") || "(none)"}. Check the file uses commas as delimiters.`);
  }
  const objects = rowsToObjects(rows);
  return objects.map((row) => ({
    time: formatTime(toSecond(parseLocalDateTime(row["展示时间"]))),
    mark: row["备注"] || ""
  })).sort((a, b) => a.time.localeCompare(b.time));
}

async function loadRR(file) {
  const objects = rowsToObjects(parseCsv(await readTextSmart(file)));
  const groups = new Map();
  objects.forEach((row) => {
    const key = formatTime(toSecond(parseLocalDateTime(row.timestamp)));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(parseNumber(row.rr_ms));
  });
  const map = new Map();
  groups.forEach((values, key) => map.set(key, Math.round(mean(values) * 1000) / 1000));
  return map;
}

async function loadGPX(file) {
  const text = await readText(file);
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const points = [...xml.getElementsByTagName("trkpt")].map((node) => {
    const timeNode = node.getElementsByTagName("time")[0];
    const time = timeNode ? formatTime(toSecond(new Date(timeNode.textContent))) : "";
    return {
      time,
      ms: time ? parseLocalDateTime(time).getTime() : NaN,
      lat: Number(node.getAttribute("lat")),
      lon: Number(node.getAttribute("lon"))
    };
  }).filter((p) => p.time && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  points.sort((a, b) => a.ms - b.ms);
  return points;
}

async function loadEEG(file, options = {}) {
  const buffer = await readArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
  const dict = {};
  rows.forEach((row) => {
    if (row[0] !== undefined && row[0] !== null) dict[String(row[0]).trim()] = row[1] ?? "";
  });
  let recordEnd = parseLocalDateTime(dict["Date/日期"]);
  const tz = EEG_TIMEZONE_OPTIONS[options.eegTimezone] || EEG_TIMEZONE_OPTIONS.chicago;
  if (tz.from && tz.to) {
    const before = formatTime(recordEnd);
    recordEnd = convertWallClock(recordEnd, tz.from, tz.to);
    if (typeof options.onTimezoneConvert === "function") {
      options.onTimezoneConvert({
        before,
        after: formatTime(recordEnd),
        from: tz.from,
        to: tz.to
      });
    }
  }
  const duration = Number(dict["时长(Duration)/秒(ss)"]);
  const eegStart = new Date(recordEnd.getTime() - duration * 1000);
  const offsets = splitSeries(dict["Time-set/时间集合"]).map((item) => Number(item));
  const map = new Map();
  Object.entries(eegRows).forEach(([sourceName, finalName]) => {
    const values = splitSeries(dict[sourceName]);
    values.slice(0, offsets.length).forEach((value, index) => {
      const sample = formatTime(toSecond(new Date(eegStart.getTime() + offsets[index] * 1000)));
      const row = map.get(sample) || {};
      row[finalName] = parseNumber(value);
      map.set(sample, row);
    });
  });
  return map;
}

async function loadHeartRate(file) {
  const rows = parseCsv(await readTextSmart(file));
  const meta = {};
  rows[0].forEach((key, index) => {
    meta[key] = rows[1][index] ?? "";
  });
  const start = parseLocalDateTime(`${meta.Date} ${meta["Start time"]}`);
  const sampleObjects = rowsToObjects(rows.slice(2));
  const map = new Map();
  sampleObjects.forEach((row) => {
    const seconds = parseDurationSeconds(row.Time);
    const key = formatTime(toSecond(new Date(start.getTime() + seconds * 1000)));
    map.set(key, parseNumber(row["HR (bpm)"]));
  });
  return map;
}

function buildTimeline(start, end) {
  const rows = [];
  const startMs = parseLocalDateTime(start).getTime();
  const endMs = parseLocalDateTime(end).getTime();
  for (let ms = startMs; ms <= endMs; ms += 1000) {
    rows.push({ time: formatTime(new Date(ms)) });
  }
  return rows;
}

function attachLocation(rows, points) {
  if (!points.length) return;
  let cursor = 0;
  rows.forEach((row) => {
    const ms = parseLocalDateTime(row.time).getTime();
    while (cursor < points.length - 2 && points[cursor + 1].ms < ms) cursor += 1;
    const before = points[cursor];
    const after = points[cursor + 1];
    if (!before || !after || ms < points[0].ms || ms > points[points.length - 1].ms) return;
    const span = after.ms - before.ms;
    const ratio = span ? (ms - before.ms) / span : 0;
    const lat = before.lat + (after.lat - before.lat) * ratio;
    const lon = before.lon + (after.lon - before.lon) * ratio;
    row.location = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  });
}

function toCsv(rows) {
  const escapeCell = (value) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [finalColumns.join(",")];
  rows.forEach((row) => {
    lines.push(finalColumns.map((column) => escapeCell(row[column])).join(","));
  });
  return "﻿" + lines.join("\n") + "\n";
}

export function safeFilePart(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    || "file";
}

function forwardFill(rows, key) {
  let last = "";
  rows.forEach((row) => {
    const value = row[key];
    if (value !== "" && value !== undefined && value !== null) {
      last = value;
    } else if (last !== "") {
      row[key] = last;
    }
  });
}

function assembleRows(timeline, { rr, eeg, gpx, heartRate, marks }) {
  const rows = timeline.map((row) => ({ ...row }));
  rows.forEach((row) => {
    row.rr = rr.get(row.time) ?? "";
    Object.assign(row, eeg.get(row.time) || {});
    row.heart_rate = heartRate.get(row.time) ?? "";
    row.Mark = marks.map.get(row.time) ?? "";
  });
  // RR samples are sparser than 1 Hz — carry the last known rr_ms forward.
  forwardFill(rows, "rr");
  attachLocation(rows, gpx);
  rows.forEach((row) => {
    finalColumns.forEach((column) => {
      if (row[column] === undefined || row[column] === null) row[column] = "";
    });
  });
  return {
    rows,
    csv: toCsv(rows),
    metrics: {
      rows: rows.length,
      gps: rows.filter((r) => r.location).length,
      rr: rows.filter((r) => r.rr !== "").length,
      eeg: rows.filter((r) => r.attention !== "").length,
      hr: rows.filter((r) => r.heart_rate !== "").length
    },
    range: rows.length ? `${rows[0].time} → ${rows[rows.length - 1].time}` : "",
    window: marks.window,
    kind: marks.kind,
    label: marks.label
  };
}

/**
 * Load an optional sensor file. Missing or unreadable files become empty maps/arrays;
 * merge continues with blank columns for that stream.
 */
async function loadOptionalSensor(label, file, emptyValue, loader, log) {
  if (!file) {
    log(`${label} skipped (not uploaded)`);
    return emptyValue;
  }
  try {
    const value = await loader(file);
    log(`${label} loaded`);
    return value;
  } catch (error) {
    log(`${label} skipped: ${error.message}`);
    return emptyValue;
  }
}

async function loadSensors(files, log, options = {}) {
  const eegTimezone = options.eegTimezone || "chicago";
  const rr = await loadOptionalSensor("RR", files.rr, new Map(), loadRR, log);
  const eeg = await loadOptionalSensor(
    "EEG",
    files.eeg,
    new Map(),
    (file) =>
      loadEEG(file, {
        eegTimezone,
        onTimezoneConvert: ({ before, after }) => {
          log(`EEG Date: ${before} (Beijing) → ${after} (Chicago)`);
        }
      }),
    log
  );
  const gpx = await loadOptionalSensor("GPX", files.gpx, [], loadGPX, log);
  const heartRate = await loadOptionalSensor("Heart Rate", files.hr, new Map(), loadHeartRate, log);
  return { rr, eeg, gpx, heartRate };
}

/**
 * Run the merge pipeline for one window.
 * Mark CSV or manualWindow start/end is required; RR/EEG/GPX/HR may be absent.
 * @param {"cd"|"ab"} [options.window="cd"]
 * @param {"chicago"|"beijing"} [options.eegTimezone="chicago"]
 * @param {{start:string,end:string}|null} [options.manualWindow]
 */
export async function runMerge(files, log = () => {}, options = {}) {
  const windowKey = options.window || "cd";
  const { experimentMarks, sensors } = await prepareMergeContext(files, log, {
    ...options,
    windowKey,
    requireBaseline: false
  });
  const rows = buildTimeline(experimentMarks.start, experimentMarks.end);
  log(`${experimentMarks.label}: ${experimentMarks.start} → ${experimentMarks.end} (${rows.length} seconds)`);
  return assembleRows(rows, { ...sensors, marks: experimentMarks });
}

async function prepareMergeContext(files, log, options = {}) {
  const manual = options.manualWindow;
  let allMarks = [];
  let experimentMarks;
  let baselineMarks = null;

  if (manual?.start && manual?.end) {
    const start = normalizeTimestampInput(manual.start);
    const end = normalizeTimestampInput(manual.end);

    if (files?.marks) {
      try {
        log("Reading Mark file (optional annotations)…");
        allMarks = await loadAllMarks(files.marks);
      } catch (error) {
        log(`Mark skipped: ${error.message}`);
      }
    } else {
      log("Mark CSV not uploaded — cutting by manual timestamps only.");
    }

    experimentMarks = buildWindowFromRange(start, end, allMarks, {
      window: "cd",
      kind: "experiment_cd",
      label: "manual window"
    });

    if (allMarks.length && options.requireBaseline !== false) {
      try {
        baselineMarks = resolveWindow(allMarks, "ab");
      } catch (error) {
        log(`Baseline AB skipped: ${error.message}`);
      }
    }
  } else {
    if (!files?.marks) {
      throw new Error("Mark CSV is required (needs start/end timestamps: C/D or 开始/结束), or switch to Manual time.");
    }
    log("Reading Mark file...");
    allMarks = await loadAllMarks(files.marks);
    experimentMarks = resolveWindow(allMarks, options.windowKey || "cd");

    if (options.requireBaseline !== false) {
      try {
        baselineMarks = resolveWindow(allMarks, "ab");
      } catch (error) {
        log(`Baseline AB skipped: ${error.message}`);
      }
    }
  }

  log("Reading optional RR / EEG / GPX / HR (missing streams stay blank)…");
  const sensors = await loadSensors(files, log, options);
  return { experimentMarks, baselineMarks, sensors };
}

/**
 * Generate experiment (CD) merge for download and baseline (AB) merge for archive.
 * Supports Mark C/D window or options.manualWindow { start, end }.
 * @param {"chicago"|"beijing"} [options.eegTimezone="chicago"]
 * @param {{start:string,end:string}|null} [options.manualWindow]
 */
export async function runMergeWithBaseline(files, log = () => {}, options = {}) {
  const { experimentMarks, baselineMarks, sensors } = await prepareMergeContext(files, log, {
    ...options,
    windowKey: "cd",
    requireBaseline: true
  });

  const experimentTimeline = buildTimeline(experimentMarks.start, experimentMarks.end);
  log(
    `${experimentMarks.label}: ${experimentMarks.start} → ${experimentMarks.end} (${experimentTimeline.length} seconds)`
  );

  const baselineTimeline = baselineMarks
    ? buildTimeline(baselineMarks.start, baselineMarks.end)
    : null;
  if (baselineTimeline) {
    log(
      `${baselineMarks.label}: ${baselineMarks.start} → ${baselineMarks.end} (${baselineTimeline.length} seconds)`
    );
  }

  const experiment = assembleRows(experimentTimeline, { ...sensors, marks: experimentMarks });
  const baseline = baselineMarks
    ? assembleRows(baselineTimeline, { ...sensors, marks: baselineMarks })
    : null;

  return { experiment, baseline };
}

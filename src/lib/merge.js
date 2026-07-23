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

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : "";
}

async function loadMarks(file) {
  const rows = parseCsv(await readTextSmart(file));
  const headers = rows.length ? rows[0].map((h) => String(h).trim()) : [];
  if (!headers.includes("展示时间") || !headers.includes("备注")) {
    throw new Error(`Mark CSV missing 展示时间/备注 columns. Found headers: ${headers.join(" | ") || "(none)"}. Check the file uses commas as delimiters.`);
  }
  const objects = rowsToObjects(rows);
  const marks = objects.map((row) => ({
    time: formatTime(toSecond(parseLocalDateTime(row["展示时间"]))),
    mark: row["备注"] || ""
  })).sort((a, b) => a.time.localeCompare(b.time));
  const start = marks.find((m) => m.mark.includes("开始"));
  const end = [...marks].reverse().find((m) => m.mark.includes("结束"));
  if (!start || !end) {
    const seen = marks.map((m) => m.mark).filter(Boolean).slice(0, 10).join(" | ") || "(empty)";
    throw new Error(`Mark CSV must contain 开始 and 结束 in 备注. Found 备注 values: ${seen}`);
  }
  const clipped = marks.filter((m) => m.time >= start.time && m.time <= end.time);
  const map = new Map();
  clipped.forEach((m) => {
    map.set(m.time, map.has(m.time) ? `${map.get(m.time)} | ${m.mark}` : m.mark);
  });
  return { start: start.time, end: end.time, map };
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

async function loadEEG(file) {
  const buffer = await readArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
  const dict = {};
  rows.forEach((row) => {
    if (row[0] !== undefined && row[0] !== null) dict[String(row[0]).trim()] = row[1] ?? "";
  });
  const recordEnd = parseLocalDateTime(dict["Date/日期"]);
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
  return String(s).replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * Run the full merge pipeline. `log` is called with progress messages.
 * Returns { rows, csv, metrics, range }.
 */
export async function runMerge(files, log) {
  log("Reading Mark file...");
  const marks = await loadMarks(files.marks);
  const rows = buildTimeline(marks.start, marks.end);
  log(`Time window: ${marks.start} → ${marks.end} (${rows.length} seconds)`);

  log("Reading RR file...");
  const rr = await loadRR(files.rr);
  log("Reading EEG file...");
  const eeg = await loadEEG(files.eeg);
  log("Reading GPX file...");
  const gpx = await loadGPX(files.gpx);
  log("Reading Heart Rate file...");
  const heartRate = await loadHeartRate(files.hr);

  rows.forEach((row) => {
    row.rr = rr.get(row.time) ?? "";
    Object.assign(row, eeg.get(row.time) || {});
    row.heart_rate = heartRate.get(row.time) ?? "";
    row.Mark = marks.map.get(row.time) ?? "";
  });
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
    range: `${rows[0].time} → ${rows[rows.length - 1].time}`
  };
}

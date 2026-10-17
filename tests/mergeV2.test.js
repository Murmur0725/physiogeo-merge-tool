import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import { alignSession, extractSession, formatZoned, parseEEGCsv, parseEEGFile, parseZoned, runMergeV2 } from "../src/lib/mergeV2.js";
import { archiveStorageKey, rawSlots } from "../src/lib/archivePaths.js";
import { finalColumns, parseCsv, runMergeWithBaseline } from "../src/lib/merge.js";

const origin = Date.parse("2026-10-17T10:00:00Z");
function session() {
  return {
    metadata: { id: "test-session", timeZoneIdentifier: "Asia/Shanghai", status: "finished" },
    marks: ["A", "B", "C", "D"].map((code, i) => ({ unix_ms: String(origin + [0, 2000, 4000, 22000][i]), "备注": code })),
    heart: [
      { received_unix_ms: origin + 4001, bpm: "0" },
      { received_unix_ms: origin + 4100, bpm: "70" },
      { received_unix_ms: origin + 4800, bpm: "74" }
    ],
    rr: [
      { received_unix_ms: origin + 4200, rr_ms: "800", valid: "Y" },
      { received_unix_ms: origin + 4300, rr_ms: "900", valid: "Y" },
      { received_unix_ms: origin + 4400, rr_ms: "1000", valid: "N" },
      { received_unix_ms: origin + 5100, rr_ms: "8000", valid: "Y" }
    ],
    gps: [{ sampled_unix_ms: origin + 4000, received_unix_ms: origin + 4050, latitude: "22.5", longitude: "114", accuracy_m: "5", usable: "Y" }]
  };
}
const eegMap = () => parseEEGCsv("time,attention,relaxation\n2026-10-17 18:00:00,50,\n2026-10-17 18:00:04.100,60,20\n2026-10-17 18:00:04.900,80,40\n", "Asia/Shanghai");
const csvText = (rows) => {
  const headers = [...new Set(rows.flatMap(Object.keys))];
  return [headers.join(","), ...rows.map((row) => headers.map((key) => row[key] ?? "").join(","))].join("\n");
};
function zipEntries(input = session()) {
  return Object.fromEntries(Object.entries({
    "metadata.json": JSON.stringify(input.metadata), "marks.csv": csvText(input.marks),
    "heart_rate_raw.csv": csvText(input.heart), "rr_raw.csv": csvText(input.rr), "gps_raw.csv": csvText(input.gps)
  }).map(([name, text]) => [`phone/${name}`, strToU8(text)]));
}

test("V2 converts absolute and wall-clock timestamps without relying on host timezone", () => {
  assert.equal(parseZoned("2026-10-17 18:00:00.123", "Asia/Shanghai"), origin + 123);
  assert.equal(parseZoned("2026-10-17T10:00:00Z", "America/Chicago"), origin);
  assert.equal(parseZoned("2026-10-17 05:00:00", "America/Chicago"), origin);
  assert.equal(formatZoned(origin, "Asia/Shanghai"), "2026-10-17 18:00:00");
  assert.throws(() => parseZoned("2026-02-30 00:00:00", "Asia/Shanghai"), /Invalid/);
  assert.throws(() => parseZoned("2026-11-01 01:30:00", "America/Chicago"), /ambiguous/);
  assert.throws(() => parseZoned("2026-03-08 02:30:00", "America/Chicago"), /Invalid/);
});

test("EEG CSV accepts timestamp rows and legacy horizontal series, preserving blanks", () => {
  assert.deepEqual(eegMap().get(origin + 4000), { attention: 70, relaxation: 30 });
  assert.deepEqual(eegMap().get(origin), { attention: 50 });
  const horizontal = 'Date/日期,2026-10-17 18:00:04\n时长(Duration)/秒(ss),4\nTime-set/时间集合,"0,4"\nAttention/注意力,"50,70"\n';
  assert.equal(parseEEGCsv(horizontal, "Asia/Shanghai").get(origin + 4000).attention, 70);
  assert.equal(parseEEGCsv(`unix_ms,delta\n${origin},0`, "Asia/Shanghai").get(origin).delta, 0);
  assert.throws(() => parseEEGCsv("time,attention\n,50", "Asia/Shanghai"), /timestamp/);
  assert.throws(() => parseEEGCsv("time,unknown\n2026-10-17 18:00:00,50", "Asia/Shanghai"), /recognized/);
});

test("V2 cuts both windows, averages valid samples, preserves output schema and leaves gaps blank", () => {
  const { baseline, experiment } = alignSession(session(), eegMap());
  assert.equal(baseline.rows.length, 3);
  assert.equal(experiment.rows.length, 19);
  assert.deepEqual(Object.keys(experiment.rows[0]), finalColumns);
  assert.deepEqual(parseCsv(experiment.csv)[0], finalColumns);
  assert.equal(experiment.rows[0].heart_rate, 72);
  assert.equal(experiment.rows[0].rr, 850);
  assert.equal(experiment.rows[0].attention, 70);
  assert.equal(experiment.rows[0].location, "22.500000,114.000000");
  assert.equal(experiment.rows[0].Mark, "C");
  assert.equal(experiment.rows.at(-1).Mark, "D");
  assert.equal(experiment.rows[1].rr, "");
  assert.equal(experiment.rows[1].attention, "");
  assert.equal(experiment.rows[1].heart_rate, "");
  assert.equal(experiment.rows[15].location, ""); // fix older than 15 s
  assert.equal(experiment.metrics.version, "v2");
});

test("V2 rejects missing, duplicate, inverted, overlapping windows and non-overlapping EEG", () => {
  const input = session();
  input.marks.pop();
  assert.throws(() => alignSession(input, eegMap()), /one C and D/);
  input.marks.push({ unix_ms: origin + 1000, "备注": "D" });
  assert.throws(() => alignSession(input, eegMap()), /after start/);
  const duplicate = session(); duplicate.marks.push(duplicate.marks[0]);
  assert.throws(() => alignSession(duplicate, eegMap()), /one A and B/);
  assert.throws(() => alignSession(session(), new Map([[origin - 1000, { attention: 1 }]])), /no samples/);
  assert.throws(() => alignSession(session(), eegMap(), {
    manualBaselineWindow: { start: "2026-10-17 18:00:00", end: "2026-10-17 18:00:05" }
  }), /before the experiment/);
  const manual = alignSession({ ...session(), marks: [] }, eegMap(), {
    manualBaselineWindow: { start: "2026-10-17 18:00:00", end: "2026-10-17 18:00:02" },
    manualWindow: { start: "2026-10-17 18:00:04", end: "2026-10-17 18:00:06" }
  });
  assert.equal(manual.experiment.rows.length, 3);
});

test("GPS does not use future, inaccurate, unusable or late-received fixes", () => {
  const input = session();
  input.gps[0].received_unix_ms = origin + 6000;
  input.gps.push({ ...input.gps[0], latitude: "50", accuracy_m: "100", received_unix_ms: origin + 5000 });
  const result = alignSession(input, eegMap());
  assert.equal(result.experiment.rows[0].location, "");
  assert.equal(result.experiment.rows[1].location, "");
  assert.equal(result.experiment.rows[2].location, "22.500000,114.000000");
});

test("ZIP import accepts a containing folder and rejects missing or multiple sessions", () => {
  const entries = zipEntries();
  assert.equal(extractSession(zipSync(entries)).metadata.id, "test-session");
  delete entries["phone/rr_raw.csv"];
  assert.throws(() => extractSession(zipSync(entries)), /rr_raw.csv/);
  entries["other/metadata.json"] = entries["phone/metadata.json"];
  assert.throws(() => extractSession(zipSync(entries)), /exactly one metadata/);
});

test("V2 file entry point processes ZIP plus CSV and requires both uploads", async () => {
  const result = await runMergeV2({
    zip: new File([zipSync(zipEntries())], "session.zip"),
    eeg: new File(["time,attention\n2026-10-17 18:00:00,50\n2026-10-17 18:00:04,60\n"], "eeg.csv")
  });
  assert.equal(result.baseline.metrics.eeg, 1);
  assert.equal(result.experiment.metrics.eeg, 1);
  await assert.rejects(runMergeV2({}), /Upload/);
});

test("Native EEG Excel reconstructs split numbers before aligning series and keeps short-series gaps", async () => {
  const values = Array.from({ length: 5000 }, (_, i) => 100000 + i);
  const series = values.join(",");
  const rows = [
    ["Date/日期", "2026-10-17 18:00:00"], ["时长(Duration)/秒(ss)", "5000"],
    ["Delta/δ波", series.slice(0, 30000)], ["Delta/δ波", series.slice(30000)],
    ["High-Alpha/高α波", series.slice(0, 30000)], ["High-Alpha/高α波", series.slice(30000)],
    ["MentalEffort/用脑度", "1,2"], ["Time-set/时间集合", Array.from({ length: 5000 }, (_, i) => i + 1).join(",")]
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const file = new File([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], "native-eeg.xlsx");
  const { samples, info } = await parseEEGFile(file, "Asia/Shanghai");
  assert.equal(samples.size, 5000);
  const keys = [...samples.keys()];
  for (const i of [0, 4284, 4285, 4286, 4999]) assert.equal(samples.get(keys[i]).delta, values[i]);
  assert.equal(samples.get(keys[0]).mental_effort, 1);
  assert.equal(samples.get(keys[1]).mental_effort, 2);
  assert.equal(samples.get(keys[2]).mental_effort, undefined);
  assert.deepEqual(info.reconstructed_series, ["Delta/δ波", "High-Alpha/高α波"]);
  assert.equal(info.field_sample_counts.delta, 5000);
  assert.equal(info.field_sample_counts.mental_effort, 2);
  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets.Sheet1);
  assert.deepEqual([...parseEEGCsv(csv, "Asia/Shanghai")], [...samples]);
});

test("V2 directly merges an Excel EEG upload and rejects ambiguous repeated series", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Date/日期", "2026-10-17 18:00:04"], ["时长(Duration)/秒(ss)", 4],
    ["Attention/注意力", "50,60"], ["Time-set/时间集合", "0,4"]
  ]), "EEG");
  const result = await runMergeV2({
    zip: new File([zipSync(zipEntries())], "session.zip"),
    eeg: new File([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], "eeg.xlsx")
  });
  assert.equal(result.baseline.rows[0].attention, 50);
  assert.equal(result.experiment.rows[0].attention, 60);
  assert.equal(result.experiment.metrics.eeg_source.sheet, "EEG");
  assert.throws(() => parseEEGCsv('Date/日期,2026-10-17 18:00:04\n时长(Duration)/秒(ss),4\nTime-set/时间集合,"0,4"\nAttention/注意力,"50,60"\nAttention/注意力,70', "Asia/Shanghai"), /not a recognized continuation/);
});

test("Both versions share archive structure while V2 subjects and sessions never collide with V1", () => {
  const v1 = archiveStorageKey("11", "Harsha");
  const v2 = archiveStorageKey("11", "Harsha", { version: "v2", sessionId: "session-one" });
  assert.equal(v1, "11-Harsha");
  assert.equal(v2, "11-Harsha-v2-session-one");
  assert.notEqual(v2, archiveStorageKey("11", "Harsha", { version: "v2", sessionId: "session-two" }));
  assert.throws(() => archiveStorageKey("11", "Harsha", { version: "v2" }), /session ID/);
  assert.equal(rawSlots().length, 5);
  assert.deepEqual(rawSlots({ version: "v2" }).map((s) => s.key), ["zip", "eeg"]);
});

test("V1 still merges legacy five-file slots with the original RR forward-fill behavior", async () => {
  // Browser-only FileReader shim; this regression does not call V2 code.
  globalThis.FileReader = class {
    readAsArrayBuffer(file) { file.arrayBuffer().then((result) => { this.result = result; this.onload(); }); }
  };
  const result = await runMergeWithBaseline({
    marks: new File(["展示时间,备注\n2026-10-17 18:00:00,A\n2026-10-17 18:00:02,B\n2026-10-17 18:00:04,C\n2026-10-17 18:00:06,D"], "marks.csv"),
    rr: new File(["timestamp,rr_ms\n2026-10-17 18:00:04,800"], "rr.csv")
  });
  assert.deepEqual(result.experiment.rows.map((r) => r.rr), [800, 800, 800]);
  assert.equal(result.baseline.rows.length, 3);
  assert.deepEqual(parseCsv(result.baseline.csv)[0], finalColumns);
});

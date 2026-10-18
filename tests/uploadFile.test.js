import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { captureUpload } from "../src/lib/uploadFile.js";
import { parseEEGFile, runMergeV2 } from "../src/lib/mergeV2.js";

test("Captured uploads remain usable for merging and archiving after disk access is lost", async () => {
  const entries = {
    "metadata.json": JSON.stringify({ id: "snapshot-session", timeZoneIdentifier: "Asia/Shanghai", status: "finished" }),
    "marks.csv": "unix_ms,备注\n1792231200000,A\n1792231201000,B\n1792231202000,C\n1792231203000,D",
    "heart_rate_raw.csv": "received_unix_ms,bpm",
    "rr_raw.csv": "received_unix_ms,rr_ms,valid",
    "gps_raw.csv": "sampled_unix_ms,received_unix_ms,latitude,longitude,accuracy_m,usable"
  };
  const zip = new File([zipSync(Object.fromEntries(Object.entries(entries).map(([k,v]) => [k,strToU8(v)])))], "phone.zip");
  const eeg = new File(["unix_ms,attention\n1792231200000,50\n1792231202000,60"], "eeg.csv", { type: "text/csv", lastModified: 123456 });
  const captured = { zip: await captureUpload(zip), eeg: await captureUpload(eeg) };
  for (const source of [zip, eeg]) source.arrayBuffer = async () => { throw new DOMException("Access lost", "NotReadableError"); };
  const result = await runMergeV2(captured);
  assert.equal(result.baseline.metrics.eeg, 1);
  assert.equal(result.experiment.metrics.eeg, 1);
  assert.equal(captured.eeg.name, "eeg.csv");
  assert.equal(captured.eeg.type, "text/csv");
  assert.equal(captured.eeg.lastModified, 123456);
  assert.equal(await captured.eeg.text(), "unix_ms,attention\n1792231200000,50\n1792231202000,60");
});

test("Unreadable uploads identify the filename and explain how to reselect it", async () => {
  const cause = new DOMException("Access lost", "NotReadableError");
  const file = { name: "murmur.xlsx", arrayBuffer: async () => { throw cause; } };
  const check = (error) => error.cause === cause && /murmur\.xlsx/.test(error.message) && /Select the file again/.test(error.message);
  await assert.rejects(captureUpload(file), check);
  await assert.rejects(parseEEGFile(file, "Asia/Shanghai"), check);
  await assert.rejects(runMergeV2({ zip: { ...file, name: "phone.zip", size: 10 }, eeg: file }), /Cannot read "phone\.zip"/);
});

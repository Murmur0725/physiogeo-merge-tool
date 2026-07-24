/**
 * Private archive for merge + raw files.
 *
 * Website may INSERT artifacts (baseline AB, experiment CD, raw inputs) when
 * Supabase is configured, but RLS denies public SELECT/download. Researchers
 * retrieve files from the Supabase dashboard / service-role scripts only.
 */

import { createClient } from "@supabase/supabase-js";
import { safeFilePart } from "./merge";

const BUCKET = "merge-private";

const RAW_SLOTS = [
  { key: "marks", label: "marks" },
  { key: "rr", label: "rr" },
  { key: "eeg", label: "eeg" },
  { key: "gpx", label: "gpx" },
  { key: "hr", label: "hr" }
];

function getClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function isArchiveConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function notConfigured(what) {
  return {
    ok: false,
    skipped: true,
    reason: `Supabase 未配置（缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。${what}已在内存生成但未入库。`
  };
}

function contentTypeForName(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".gpx") || lower.endsWith(".xml")) return "application/gpx+xml";
  if (lower.endsWith(".csv")) return "text/csv;charset=utf-8";
  return "application/octet-stream";
}

async function uploadAndRegister(client, {
  subjectId,
  subjectName,
  kind,
  folder,
  fileName,
  body,
  contentType,
  windowLabel,
  metrics,
  range
}) {
  const idPart = safeFilePart(subjectId);
  const storagePath = `${folder}/${idPart}/${fileName}`;

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType, upsert: false });

  if (uploadError) {
    return { ok: false, skipped: false, reason: `Storage upload failed (${kind}): ${uploadError.message}` };
  }

  // Do not .select() after insert: anon has INSERT-only RLS (no SELECT).
  const { error: insertError } = await client
    .from("merge_artifacts")
    .insert({
      subject_id: subjectId,
      subject_name: subjectName,
      kind,
      window_label: windowLabel || null,
      storage_path: storagePath,
      row_count: metrics?.rows ?? null,
      time_range: range || null,
      metrics: metrics || null,
      downloadable_on_web: false
    });

  if (insertError) {
    await client.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, skipped: false, reason: `DB insert failed (${kind}): ${insertError.message}` };
  }

  return { ok: true, skipped: false, storagePath, kind };
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Upload baseline (AB) CSV to private storage and register a DB row.
 */
export async function archiveBaseline({
  subjectId,
  subjectName,
  csv,
  metrics,
  range,
  windowLabel = "baseline AB"
}) {
  const client = getClient();
  if (!client) return notConfigured("baseline ");

  const idPart = safeFilePart(subjectId);
  const namePart = safeFilePart(subjectName);
  const result = await uploadAndRegister(client, {
    subjectId,
    subjectName,
    kind: "baseline_ab",
    folder: "baseline",
    fileName: `${idPart}${namePart}-baseline-ab-${stampNow()}.csv`,
    body: new TextEncoder().encode(csv),
    contentType: "text/csv;charset=utf-8",
    windowLabel,
    metrics,
    range
  });

  if (result.ok) {
    result.reason = "baseline 已写入私有库（网站不可下载，仅后台可调取）";
  }
  return result;
}

/**
 * Upload experiment (CD) merge CSV to private storage (website can still
 * download a local copy; this is the backend archive copy).
 */
export async function archiveExperiment({
  subjectId,
  subjectName,
  csv,
  metrics,
  range,
  windowLabel = "experiment CD"
}) {
  const client = getClient();
  if (!client) return notConfigured("CD merge ");

  const idPart = safeFilePart(subjectId);
  const namePart = safeFilePart(subjectName);
  const result = await uploadAndRegister(client, {
    subjectId,
    subjectName,
    kind: "experiment_cd",
    folder: "experiment",
    fileName: `${idPart}${namePart}-merge-cd-${stampNow()}.csv`,
    body: new TextEncoder().encode(csv),
    contentType: "text/csv;charset=utf-8",
    windowLabel,
    metrics,
    range
  });

  if (result.ok) {
    result.reason = "CD merge 已写入私有库（网站仍可本地下载，后台可调取）";
  }
  return result;
}

/**
 * Upload the five raw input files to private storage.
 * @param {Record<string, File>} files — { marks, rr, eeg, gpx, hr }
 */
export async function archiveRawFiles({ subjectId, subjectName, files }) {
  const client = getClient();
  if (!client) return notConfigured("原始文件");

  const idPart = safeFilePart(subjectId);
  const stamp = stampNow();
  const results = [];

  for (const slot of RAW_SLOTS) {
    const file = files?.[slot.key];
    if (!file) {
      results.push({ ok: false, skipped: true, key: slot.key, reason: `缺少原始文件: ${slot.label}` });
      continue;
    }
    const original = safeFilePart(file.name || `${slot.label}.bin`);
    const result = await uploadAndRegister(client, {
      subjectId,
      subjectName,
      kind: "raw",
      folder: "raw",
      fileName: `${stamp}_${slot.label}_${original}`,
      body: file,
      contentType: contentTypeForName(file.name),
      windowLabel: slot.label,
      metrics: { bytes: file.size, original_name: file.name, slot: slot.key },
      range: null
    });
    results.push({ ...result, key: slot.key, label: slot.label });
  }

  const okCount = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok && !r.skipped);
  return {
    ok: fail.length === 0 && okCount > 0,
    skipped: okCount === 0 && results.every((r) => r.skipped),
    results,
    reason:
      fail.length === 0
        ? `原始文件已写入私有库（${okCount}/5；网站不可下载）`
        : `原始文件部分失败：${fail.map((f) => f.reason).join(" | ")}`
  };
}

/**
 * Archive CD merge + AB baseline + raw inputs in one pass.
 * Website download remains CD-only; nothing here becomes a public URL.
 */
export async function archiveSession({
  subjectId,
  subjectName,
  experiment,
  baseline,
  files
}) {
  if (!isArchiveConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "Supabase 未配置。CD/AB/原始数据未入库。",
      experiment: notConfigured("CD merge "),
      baseline: baseline ? notConfigured("baseline ") : null,
      raw: notConfigured("原始文件")
    };
  }

  const experimentResult = experiment
    ? await archiveExperiment({
        subjectId,
        subjectName,
        csv: experiment.csv,
        metrics: experiment.metrics,
        range: experiment.range,
        windowLabel: experiment.label
      })
    : { ok: false, skipped: true, reason: "无 CD merge" };

  const baselineResult = baseline
    ? await archiveBaseline({
        subjectId,
        subjectName,
        csv: baseline.csv,
        metrics: baseline.metrics,
        range: baseline.range,
        windowLabel: baseline.label
      })
    : { ok: false, skipped: true, reason: "无 AB baseline（Mark 缺少 A/B）" };

  const rawResult = await archiveRawFiles({ subjectId, subjectName, files });

  const parts = [
    experimentResult.ok ? "CD" : null,
    baselineResult.ok ? "AB" : null,
    rawResult.ok ? "raw" : null
  ].filter(Boolean);

  return {
    ok: experimentResult.ok || baselineResult.ok || rawResult.ok,
    skipped: false,
    experiment: experimentResult,
    baseline: baselineResult,
    raw: rawResult,
    reason: parts.length
      ? `私有库已归档：${parts.join(" + ")}（网站不可从库下载；CD 仍可本地下载）`
      : `归档失败：${[experimentResult.reason, baselineResult.reason, rawResult.reason].filter(Boolean).join(" | ")}`
  };
}

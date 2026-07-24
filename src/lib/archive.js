/**
 * Private archive for baseline (AB) merge files.
 *
 * Website clients may INSERT baseline artifacts when Supabase is configured,
 * but RLS denies public SELECT/download. Researchers retrieve files from the
 * Supabase dashboard / service-role scripts only.
 */

import { createClient } from "@supabase/supabase-js";
import { safeFilePart } from "./merge";

const BUCKET = "merge-private";

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

/**
 * Upload baseline CSV to private storage and register a DB row.
 * Never returns a public download URL — storage is private + RLS blocks SELECT for anon.
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
  if (!client) {
    return {
      ok: false,
      skipped: true,
      reason: "Supabase 未配置（缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。baseline 已在内存生成但未入库。"
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const idPart = safeFilePart(subjectId);
  const namePart = safeFilePart(subjectName);
  const fileName = `${idPart}${namePart}-baseline-ab-${stamp}.csv`;
  const storagePath = `baseline/${idPart}/${fileName}`;
  const bytes = new TextEncoder().encode(csv);

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: "text/csv;charset=utf-8",
      upsert: false
    });

  if (uploadError) {
    return { ok: false, skipped: false, reason: `Storage upload failed: ${uploadError.message}` };
  }

  // Do not .select() after insert: anon has INSERT-only RLS (no SELECT),
  // so RETURNING would make a successful write look like a failure.
  const { error: insertError } = await client
    .from("merge_artifacts")
    .insert({
      subject_id: subjectId,
      subject_name: subjectName,
      kind: "baseline_ab",
      window_label: windowLabel,
      storage_path: storagePath,
      row_count: metrics?.rows ?? null,
      time_range: range || null,
      metrics: metrics || null,
      downloadable_on_web: false
    });

  if (insertError) {
    // Best-effort cleanup (anon may lack DELETE; ignore cleanup errors).
    await client.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, skipped: false, reason: `DB insert failed: ${insertError.message}` };
  }

  return {
    ok: true,
    skipped: false,
    storagePath,
    reason: "baseline 已写入私有库（网站不可下载，仅后台可调取）"
  };
}

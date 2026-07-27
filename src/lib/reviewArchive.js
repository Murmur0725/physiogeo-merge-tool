/**
 * Insert-only review archive (sessions / segments / street points / survey answers).
 * Website never SELECTs private rows for download.
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

export function isReviewArchiveConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function notConfigured(what) {
  return {
    ok: false,
    skipped: true,
    reason: `Supabase is not configured. ${what} was not saved.`
  };
}

/**
 * Ensure a review session + segment rows exist, then insert survey response.
 * Uses RPC-free inserts; session id is client-generated UUID so we never need SELECT.
 */
export async function saveReviewSurvey({
  subjectId,
  subjectName,
  routeConfigId,
  routeName,
  instrumentId,
  segments,
  segmentId,
  answers,
  scores
}) {
  const client = getClient();
  if (!client) return notConfigured("Survey");

  const sessionId = crypto.randomUUID();
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) {
    return { ok: false, reason: "Unknown segment" };
  }

  const { error: sessionErr } = await client.from("review_sessions").insert({
    id: sessionId,
    subject_id: subjectId,
    subject_name: subjectName,
    route_config_id: routeConfigId,
    route_name: routeName || null,
    instrument_id: instrumentId
  });

  if (sessionErr) {
    return { ok: false, reason: sessionErr.message };
  }

  // Insert all segments for this session (idempotent within one save call)
  const segmentRows = segments.map((s) => ({
    id: crypto.randomUUID(),
    session_id: sessionId,
    segment_key: s.id,
    label: s.label,
    sort_order: s.order,
    geometry: s.geometry,
    start_waypoint_id: s.startWaypointId || null,
    end_waypoint_id: s.endWaypointId || null
  }));

  const { error: segErr } = await client.from("review_segments").insert(segmentRows);
  if (segErr) {
    return { ok: false, reason: segErr.message, sessionId };
  }

  const keyToRowId = Object.fromEntries(
    segmentRows.map((r) => [r.segment_key, r.id])
  );

  const streetRows = [];
  segments.forEach((s) => {
    const rowId = keyToRowId[s.id];
    (s.samplePoints || []).forEach((p, i) => {
      streetRows.push({
        segment_id: rowId,
        point_key: p.id,
        lng: p.lng,
        lat: p.lat,
        progress: p.progress ?? null,
        label: p.label || null,
        mapillary_image_id: p.mapillaryImageId || null,
        sort_order: i
      });
    });
  });

  if (streetRows.length) {
    const { error: ptErr } = await client.from("segment_street_points").insert(streetRows);
    if (ptErr) {
      return { ok: false, reason: ptErr.message, sessionId };
    }
  }

  const dbSegmentId = keyToRowId[segmentId];
  const { error: ansErr } = await client.from("survey_responses").insert({
    session_id: sessionId,
    segment_id: dbSegmentId,
    instrument_id: instrumentId,
    answers,
    scores: scores || null
  });

  if (ansErr) {
    return { ok: false, reason: ansErr.message, sessionId };
  }

  // Optional JSON snapshot under review/ (insert-only; replace via delete+upload)
  const subjectKey = `${safeFilePart(subjectId)}-${safeFilePart(subjectName)}`;
  const snapshotPath = `review/${subjectKey}/${sessionId}-${segmentId}.json`;
  const body = JSON.stringify(
    {
      sessionId,
      subjectId,
      subjectName,
      routeConfigId,
      instrumentId,
      segmentId,
      answers,
      scores,
      savedAt: new Date().toISOString()
    },
    null,
    2
  );

  let { error: upErr } = await client.storage
    .from(BUCKET)
    .upload(snapshotPath, body, {
      contentType: "application/json",
      upsert: false
    });

  if (upErr) {
    const msg = String(upErr.message || "").toLowerCase();
    if (msg.includes("already exists") || upErr.statusCode === "409" || upErr.status === 409) {
      await client.storage.from(BUCKET).remove([snapshotPath]);
      ({ error: upErr } = await client.storage.from(BUCKET).upload(snapshotPath, body, {
        contentType: "application/json",
        upsert: false
      }));
    }
  }

  // Storage failure is non-fatal if DB rows succeeded
  return {
    ok: true,
    sessionId,
    storageWarning: upErr ? upErr.message : null
  };
}

/**
 * One session for the whole route: insert all segments + all survey responses.
 * @param {object} opts
 * @param {Array<{ segmentId: string, answers: object, scores?: object }>} opts.responses
 */
export async function saveReviewSession({
  subjectId,
  subjectName,
  routeConfigId,
  routeName,
  instrumentId,
  segments,
  responses
}) {
  const client = getClient();
  if (!client) return notConfigured("Survey");

  if (!responses?.length) {
    return { ok: false, reason: "No surveys to submit" };
  }

  const sessionId = crypto.randomUUID();

  const { error: sessionErr } = await client.from("review_sessions").insert({
    id: sessionId,
    subject_id: subjectId,
    subject_name: subjectName,
    route_config_id: routeConfigId,
    route_name: routeName || null,
    instrument_id: instrumentId
  });
  if (sessionErr) return { ok: false, reason: sessionErr.message };

  const segmentRows = segments.map((s) => ({
    id: crypto.randomUUID(),
    session_id: sessionId,
    segment_key: s.id,
    label: s.label,
    sort_order: s.order,
    geometry: s.geometry,
    start_waypoint_id: s.startWaypointId || null,
    end_waypoint_id: s.endWaypointId || null
  }));

  const { error: segErr } = await client.from("review_segments").insert(segmentRows);
  if (segErr) return { ok: false, reason: segErr.message, sessionId };

  const keyToRowId = Object.fromEntries(
    segmentRows.map((r) => [r.segment_key, r.id])
  );

  const streetRows = [];
  segments.forEach((s) => {
    const rowId = keyToRowId[s.id];
    (s.samplePoints || []).forEach((p, i) => {
      streetRows.push({
        segment_id: rowId,
        point_key: p.id,
        lng: p.lng,
        lat: p.lat,
        progress: p.progress ?? null,
        label: p.label || null,
        mapillary_image_id: p.mapillaryImageId || null,
        sort_order: i
      });
    });
  });

  if (streetRows.length) {
    const { error: ptErr } = await client.from("segment_street_points").insert(streetRows);
    if (ptErr) return { ok: false, reason: ptErr.message, sessionId };
  }

  const answerRows = responses.map((r) => ({
    session_id: sessionId,
    segment_id: keyToRowId[r.segmentId],
    instrument_id: instrumentId,
    answers: r.answers,
    scores: r.scores || null
  }));

  if (answerRows.some((r) => !r.segment_id)) {
    return { ok: false, reason: "Segment and response mismatch", sessionId };
  }

  const { error: ansErr } = await client.from("survey_responses").insert(answerRows);
  if (ansErr) return { ok: false, reason: ansErr.message, sessionId };

  const subjectKey = `${safeFilePart(subjectId)}-${safeFilePart(subjectName)}`;
  const snapshotPath = `review/${subjectKey}/${sessionId}-all.json`;
  const body = JSON.stringify(
    {
      sessionId,
      subjectId,
      subjectName,
      routeConfigId,
      instrumentId,
      responses,
      savedAt: new Date().toISOString()
    },
    null,
    2
  );

  let { error: upErr } = await client.storage.from(BUCKET).upload(snapshotPath, body, {
    contentType: "application/json",
    upsert: false
  });

  if (upErr) {
    const msg = String(upErr.message || "").toLowerCase();
    if (msg.includes("already exists") || upErr.statusCode === "409" || upErr.status === 409) {
      await client.storage.from(BUCKET).remove([snapshotPath]);
      ({ error: upErr } = await client.storage.from(BUCKET).upload(snapshotPath, body, {
        contentType: "application/json",
        upsert: false
      }));
    }
  }

  return {
    ok: true,
    sessionId,
    responseCount: answerRows.length,
    storageWarning: upErr ? upErr.message : null
  };
}

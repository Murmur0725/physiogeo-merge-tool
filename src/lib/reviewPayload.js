import { isInstrumentComplete } from "./surveyComplete.js";
import { isUmuxComplete, scoreUmux, umuxAnswersFromDraft, UMUX_VERSION } from "./umux.js";
import { walkingOrderMetadata } from "./walkingOrder.js";

export function requireReviewSubjectId(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Please enter Subjector ID before submitting.");
  return value.trim();
}

export function isPosttestComplete(segments, confirmed, platformAnswers) {
  return segments.length > 0 && segments.every((segment) =>
    isInstrumentComplete("posttest", confirmed[segment.id]?.answers)) && isUmuxComplete(platformAnswers);
}

/** Build and validate the entire submission before the first database write. */
export function buildReviewPayload({ sessionId, instrumentId, segments, responses, platformEvaluation, walkingOrder }, makeId = () => crypto.randomUUID()) {
  // Older callers remain supported; new Review submissions include an explicit experimental condition.
  const sessionContext = walkingOrder === undefined ? {} : walkingOrderMetadata(walkingOrder);
  const keys = new Set(segments.map((segment) => segment.id));
  if (!responses?.length || new Set(responses.map((response) => response.segmentId)).size !== responses.length ||
      responses.some((response) => !keys.has(response.segmentId))) {
    throw new Error("Segment and response mismatch");
  }
  let evaluation = null;
  if (instrumentId === "posttest") {
    if (!segments.length || responses.length !== segments.length ||
        !responses.every((response) => isInstrumentComplete("posttest", response.answers))) {
      throw new Error("Please confirm every route segment before submitting.");
    }
    if (!isUmuxComplete(platformEvaluation?.answers)) {
      throw new Error("Please answer all four UX/UI evaluation questions before submitting.");
    }
    evaluation = {
      instrumentId: "umux",
      scope: "platform",
      version: UMUX_VERSION,
      answers: umuxAnswersFromDraft(platformEvaluation.answers),
      scores: scoreUmux(platformEvaluation.answers)
    };
  }

  const segmentRows = segments.map((segment) => ({
    id: makeId(), session_id: sessionId, segment_key: segment.id, label: segment.label,
    sort_order: segment.order, geometry: segment.geometry,
    start_waypoint_id: segment.startWaypointId || null, end_waypoint_id: segment.endWaypointId || null
  }));
  const keyToRowId = Object.fromEntries(segmentRows.map((row) => [row.segment_key, row.id]));
  const streetRows = segments.flatMap((segment) => (segment.samplePoints || []).map((point, index) => ({
    segment_id: keyToRowId[segment.id], point_key: point.id, lng: point.lng, lat: point.lat,
    progress: point.progress ?? null, label: point.label || null,
    mapillary_image_id: point.mapillaryImageId || null, sort_order: index
  })));
  const answerRows = responses.map((response) => ({
    session_id: sessionId, segment_id: keyToRowId[response.segmentId], instrument_id: instrumentId,
    answers: { ...response.answers, ...sessionContext }, scores: response.scores || null
  }));

  if (evaluation) {
    // The existing schema requires a scope row for every response (as for pre-test).
    // An empty geometry keeps this platform-wide evaluation separate from both route sections.
    const scopeId = makeId();
    segmentRows.push({
      id: scopeId, session_id: sessionId, segment_key: "__platform_umux__",
      label: "Platform UX/UI evaluation (UMUX)", sort_order: Math.max(...segments.map((segment) => segment.order ?? 0)) + 1,
      geometry: [], start_waypoint_id: null, end_waypoint_id: null
    });
    answerRows.push({
      session_id: sessionId, segment_id: scopeId, instrument_id: "umux",
      answers: { ...evaluation.answers, scope: evaluation.scope, version: evaluation.version, ...sessionContext }, scores: evaluation.scores
    });
  }
  return { segmentRows, streetRows, answerRows, platformEvaluation: evaluation, sessionContext };
}

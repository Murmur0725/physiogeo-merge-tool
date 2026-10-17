import { test } from "node:test";
import assert from "node:assert/strict";
import { isUmuxComplete, scoreUmux, umuxAnswersFromDraft, umuxAnsweredCount } from "../src/lib/umux.js";
import { buildReviewPayload, isPosttestComplete, requireReviewSubjectId } from "../src/lib/reviewPayload.js";
import { WALKING_ORDER_OPTIONS } from "../src/lib/walkingOrder.js";

const validUmux = { u1: 6, u2: 2, u3: 5, u4: 3 };
const moodAnswers = { ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`m${index}`, 2])), openFeeling: "A calm walk." };
const segments = [
  { id: "park", label: "Park", order: 0, geometry: [{ lng: 114, lat: 22.5 }], samplePoints: [{ id: "photo", lng: 114, lat: 22.5 }] },
  { id: "street", label: "Street", order: 1, geometry: [{ lng: 114.1, lat: 22.6 }] }
];
const responses = segments.map((segment) => ({ segmentId: segment.id, answers: { ...moodAnswers } }));
const submission = () => ({ sessionId: "test-session", instrumentId: "posttest", segments, responses, platformEvaluation: { answers: validUmux } });

test("Review identity rejects missing IDs before archive and preserves the participant key used by Merge", () => {
  for (const value of [undefined, null, "", "  ", 1]) assert.throws(() => requireReviewSubjectId(value), /Subjector ID/);
  assert.equal(requireReviewSubjectId(" 001 "), "001");
  assert.equal(requireReviewSubjectId("sub——001"), "sub——001");
});

test("UMUX uses all four seven-point answers and rejects missing or invalid choices", () => {
  assert.equal(isUmuxComplete(validUmux), true);
  assert.equal(umuxAnsweredCount({ u1: 1, u3: 7 }), 2);
  for (const value of [undefined, null, "4", 0, 8, 3.5, NaN, Infinity]) {
    assert.equal(isUmuxComplete({ ...validUmux, u4: value }), false);
    assert.equal(scoreUmux({ ...validUmux, u4: value }), null);
  }
  assert.deepEqual(umuxAnswersFromDraft({ ...validUmux, extra: 999 }), validUmux);
});

test("UMUX reverse scoring has correct minimum, midpoint, maximum and mixed score", () => {
  assert.deepEqual(scoreUmux({ u1: 1, u2: 7, u3: 1, u4: 7 }), { umuxTotal: 0, umuxScore: 0 });
  assert.deepEqual(scoreUmux({ u1: 7, u2: 1, u3: 7, u4: 1 }), { umuxTotal: 24, umuxScore: 100 });
  assert.deepEqual(scoreUmux({ u1: 4, u2: 4, u3: 4, u4: 4 }), { umuxTotal: 12, umuxScore: 50 });
  assert.deepEqual(scoreUmux(validUmux), { umuxTotal: 18, umuxScore: 75 });
});

test("Final submission requires both confirmed route surveys and all four UMUX answers", () => {
  const confirmed = Object.fromEntries(responses.map((response) => [response.segmentId, response]));
  assert.equal(isPosttestComplete(segments, confirmed, validUmux), true);
  assert.equal(isPosttestComplete(segments, { park: confirmed.park }, validUmux), false);
  assert.equal(isPosttestComplete(segments, confirmed, { u1: 6, u2: 2, u3: 5 }), false);
  assert.equal(isPosttestComplete([], confirmed, validUmux), false);
  assert.equal(isPosttestComplete(segments, { ...confirmed, park: { answers: { ...moodAnswers, openFeeling: " " } } }, validUmux), false);
});

test("An incomplete or mismatched post-test is rejected before preparing database rows", () => {
  let generated = 0;
  const id = () => `id-${generated++}`;
  for (const change of [
    { platformEvaluation: undefined },
    { platformEvaluation: { answers: { u1: 7, u2: 1, u3: 7 } } },
    { responses: responses.slice(0, 1) },
    { responses: [responses[0], responses[0]] },
    { responses: [responses[0], { ...responses[1], segmentId: "unknown" }] },
    { responses: [responses[0], { ...responses[1], answers: {} }] }
  ]) assert.throws(() => buildReviewPayload({ ...submission(), ...change }, id));
  assert.equal(generated, 0);
});

test("Archive keeps both route surveys and exactly one platform-wide UMUX response in the same session", () => {
  let count = 0;
  const request = submission();
  request.platformEvaluation.scores = { umuxScore: 999 }; // Raw answers are authoritative.
  const payload = buildReviewPayload(request, () => `row-${count++}`);
  assert.equal(payload.answerRows.length, 3);
  assert.equal(payload.answerRows.filter((row) => row.instrument_id === "posttest").length, 2);
  const umuxRows = payload.answerRows.filter((row) => row.instrument_id === "umux");
  assert.equal(umuxRows.length, 1);
  const [evaluation] = umuxRows;
  assert.equal(evaluation.session_id, "test-session");
  assert.deepEqual(evaluation.scores, { umuxTotal: 18, umuxScore: 75 });
  assert.deepEqual(evaluation.answers, { ...validUmux, scope: "platform", version: "UMUX-4-7point-v1" });
  const scope = payload.segmentRows.find((row) => row.id === evaluation.segment_id);
  assert.equal(scope.segment_key, "__platform_umux__");
  assert.deepEqual(scope.geometry, []);
  assert.notEqual(evaluation.segment_id, payload.answerRows[0].segment_id);
  assert.deepEqual(payload.segmentRows.slice(0, 2).map((row) => row.geometry), segments.map((segment) => segment.geometry));
  assert.equal(payload.streetRows.length, 1);
  assert.equal(payload.streetRows[0].segment_id, payload.answerRows[0].segment_id);
  assert.deepEqual(payload.platformEvaluation.answers, validUmux);
  assert.deepEqual(payload.platformEvaluation.scores, { umuxTotal: 18, umuxScore: 75 });
});

test("Pre-test submissions retain their existing archive format without requiring UMUX", () => {
  const payload = buildReviewPayload({
    sessionId: "pre-session", instrumentId: "pretest",
    segments: [{ id: "pretest", label: "Pre-test", order: 0, geometry: [] }],
    responses: [{ segmentId: "pretest", answers: { age: "22" }, scores: { gad7Total: 3 } }]
  });
  assert.equal(payload.segmentRows.length, 1);
  assert.equal(payload.answerRows.length, 1);
  assert.equal(payload.answerRows[0].instrument_id, "pretest");
  assert.deepEqual(payload.answerRows[0].answers, { age: "22" });
  assert.equal(payload.platformEvaluation, null);
});

test("Both walking orders are archived with every response and the JSON context in both phases", () => {
  assert.equal(WALKING_ORDER_OPTIONS.length, 2);
  for (const option of WALKING_ORDER_OPTIONS) {
    const post = buildReviewPayload({ ...submission(), walkingOrder: option.value });
    const expected = { walkingOrder: option.value, walkingOrderLabel: option.label };
    assert.deepEqual(post.sessionContext, expected);
    assert.equal(post.answerRows.length, 3);
    for (const row of post.answerRows) {
      assert.equal(row.answers.walkingOrder, option.value);
      assert.equal(row.answers.walkingOrderLabel, option.label);
    }
    assert.deepEqual(post.platformEvaluation.scores, scoreUmux(validUmux));
    const pre = buildReviewPayload({
      sessionId: "pre-session", instrumentId: "pretest", walkingOrder: option.value,
      segments: [{ id: "pretest", label: "Pre-test", order: 0, geometry: [] }],
      responses: [{ segmentId: "pretest", answers: { age: "22" } }]
    });
    assert.deepEqual(pre.sessionContext, expected);
    assert.deepEqual(pre.answerRows[0].answers, { age: "22", ...expected });
  }
});

test("Unknown walking orders are rejected before preparing database rows", () => {
  let generated = 0;
  for (const value of ["", "other", null, "clockwise", 1]) {
    assert.throws(() => buildReviewPayload({ ...submission(), walkingOrder: value }, () => `row-${generated++}`), /walking order/);
  }
  assert.equal(generated, 0);
});

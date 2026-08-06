/** Per-instrument draft completeness + score helpers (no time fields). */

import {
  gad7AnswersFromDraft,
  isGad7Complete,
  scoreGad7
} from "./gad7";
import {
  isPoms30Complete,
  poms30AnswersFromDraft,
  scorePoms30
} from "./poms30";

const PSS_ITEMS = 10;
const PSS_REVERSE = new Set([3, 4, 6, 7]);
const ROS_ITEMS = 6;
const CUSTOM_FIELDS = ["pleasant", "safety", "interest", "walkability"];

export function isInstrumentComplete(instrumentId, draft = {}) {
  switch (instrumentId) {
    case "gad7":
      return isGad7Complete(draft);
    case "pomsSf":
      return isPoms30Complete(draft);
    case "posttest":
      return (
        isPoms30Complete(draft) &&
        String(draft.openFeeling || "").trim().length > 0
      );
    case "pretest":
      return isGad7Complete(draft) && isPoms30Complete(draft);
    case "pss":
      return Array.from({ length: PSS_ITEMS }, (_, i) => i).every((i) =>
        Number.isFinite(draft[`q${i}`])
      );
    case "ros":
      return Array.from({ length: ROS_ITEMS }, (_, i) => i).every((i) =>
        Number.isFinite(draft[`r${i}`])
      );
    case "customEval":
    default:
      return CUSTOM_FIELDS.every((k) => Number.isFinite(draft[k]));
  }
}

export function buildScores(instrumentId, draft = {}) {
  switch (instrumentId) {
    case "gad7":
      return scoreGad7(draft);
    case "pomsSf":
    case "posttest":
      return scorePoms30(draft);
    case "pretest":
      return { ...scoreGad7(draft), ...scorePoms30(draft) };
    case "pss": {
      let total = 0;
      for (let i = 0; i < PSS_ITEMS; i += 1) {
        const raw = Number(draft[`q${i}`]);
        total += PSS_REVERSE.has(i) ? 4 - raw : raw;
      }
      return { pssTotal: total };
    }
    case "ros": {
      const vals = Array.from({ length: ROS_ITEMS }, (_, i) => Number(draft[`r${i}`]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { rosMean: Number(mean.toFixed(2)) };
    }
    case "customEval":
    default: {
      const scores = {};
      CUSTOM_FIELDS.forEach((k) => {
        scores[k] = Number(draft[k]);
      });
      return scores;
    }
  }
}

export function normalizeAnswers(instrumentId, draft = {}) {
  if (instrumentId === "pretest") {
    return {
      ...gad7AnswersFromDraft(draft),
      ...poms30AnswersFromDraft(draft)
    };
  }
  if (instrumentId === "posttest") {
    return {
      ...poms30AnswersFromDraft(draft),
      openFeeling: String(draft.openFeeling || "").trim()
    };
  }
  if (instrumentId === "pomsSf") {
    return poms30AnswersFromDraft(draft);
  }
  if (instrumentId === "gad7") {
    return gad7AnswersFromDraft(draft);
  }
  if (instrumentId === "customEval" || !["pss", "ros"].includes(instrumentId)) {
    return { ...draft, note: draft.note || "" };
  }
  return { ...draft };
}

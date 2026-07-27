/** Per-instrument draft completeness + score helpers (no time fields). */

const PSS_ITEMS = 10;
const PSS_REVERSE = new Set([3, 4, 6, 7]);

const POMS_ITEMS = 10;
const ROS_ITEMS = 6;

const CUSTOM_FIELDS = ["pleasant", "safety", "interest", "walkability"];

export function isInstrumentComplete(instrumentId, draft = {}) {
  switch (instrumentId) {
    case "pss":
      return Array.from({ length: PSS_ITEMS }, (_, i) => i).every((i) =>
        Number.isFinite(draft[`q${i}`])
      );
    case "pomsSf":
      return Array.from({ length: POMS_ITEMS }, (_, i) => i).every((i) =>
        Number.isFinite(draft[`m${i}`])
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
    case "pss": {
      let total = 0;
      for (let i = 0; i < PSS_ITEMS; i += 1) {
        const raw = Number(draft[`q${i}`]);
        total += PSS_REVERSE.has(i) ? 4 - raw : raw;
      }
      return { pssTotal: total };
    }
    case "pomsSf": {
      const vals = Array.from({ length: POMS_ITEMS }, (_, i) => Number(draft[`m${i}`]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { pomsSfMean: Number(mean.toFixed(2)) };
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
  if (instrumentId === "customEval" || !["pss", "pomsSf", "ros"].includes(instrumentId)) {
    return { ...draft, note: draft.note || "" };
  }
  return { ...draft };
}

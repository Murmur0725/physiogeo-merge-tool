/** GAD-7 (Generalized Anxiety Disorder-7) standard English items. */

export const GAD7_ITEMS = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid as if something awful might happen"
];

export const GAD7_COUNT = GAD7_ITEMS.length;

export const GAD7_SCALE = [
  { v: 0, label: "Not at all" },
  { v: 1, label: "Several days" },
  { v: 2, label: "More than half the days" },
  { v: 3, label: "Nearly every day" }
];

export function isGad7Complete(draft = {}) {
  return Array.from({ length: GAD7_COUNT }, (_, i) => i).every((i) =>
    Number.isFinite(draft[`g${i}`])
  );
}

export function scoreGad7(draft = {}) {
  let total = 0;
  for (let i = 0; i < GAD7_COUNT; i += 1) {
    total += Number(draft[`g${i}`]) || 0;
  }
  return { gad7Total: total };
}

export function gad7AnswersFromDraft(draft = {}) {
  const out = {};
  for (let i = 0; i < GAD7_COUNT; i += 1) {
    if (Number.isFinite(draft[`g${i}`])) out[`g${i}`] = Number(draft[`g${i}`]);
  }
  return out;
}

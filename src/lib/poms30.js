/** 30-item POMS-style mood adjective checklist (user-specified order). */

export const POMS30_ITEMS = [
  "Tense",
  "Angry",
  "Worn out",
  "Lively",
  "Confused",
  "Shaky",
  "Sad",
  "Active",
  "Grouchy",
  "Energetic",
  "Unworthy",
  "Uneasy",
  "Fatigued",
  "Annoyed",
  "Discouraged",
  "Nervous",
  "Lonely",
  "Muddled",
  "Exhausted",
  "Anxious",
  "Gloomy",
  "Sluggish",
  "Weary",
  "Bewildered",
  "Furious",
  "Efficient",
  "Full of pep",
  "Bad-tempered",
  "Forgetful",
  "Vigorous"
];

export const POMS30_COUNT = POMS30_ITEMS.length;

/** 0-based item indices per subscale. Efficient (25) is reverse-scored in Confusion. */
const SUBSCALES = {
  tension: [0, 5, 11, 15, 19],
  anger: [1, 8, 13, 24, 27],
  fatigue: [2, 12, 18, 21, 22],
  vigor: [3, 7, 9, 26, 29],
  confusion: [4, 17, 23, 25, 28],
  depression: [6, 10, 14, 16, 20]
};

const CONFUSION_REVERSE = new Set([25]);

export function isPoms30Complete(draft = {}) {
  return Array.from({ length: POMS30_COUNT }, (_, i) => i).every((i) =>
    Number.isFinite(draft[`m${i}`])
  );
}

export function scorePoms30(draft = {}) {
  const scored = (indices, reverseSet = null) =>
    indices.reduce((sum, i) => {
      const raw = Number(draft[`m${i}`]);
      if (!Number.isFinite(raw)) return sum;
      if (reverseSet?.has(i)) return sum + (4 - raw);
      return sum + raw;
    }, 0);

  const tension = scored(SUBSCALES.tension);
  const anger = scored(SUBSCALES.anger);
  const fatigue = scored(SUBSCALES.fatigue);
  const vigor = scored(SUBSCALES.vigor);
  const confusion = scored(SUBSCALES.confusion, CONFUSION_REVERSE);
  const depression = scored(SUBSCALES.depression);
  const tmd = tension + anger + fatigue + confusion + depression - vigor;

  return { tension, anger, fatigue, vigor, confusion, depression, tmd };
}

export function poms30AnswersFromDraft(draft = {}) {
  const out = {};
  for (let i = 0; i < POMS30_COUNT; i += 1) {
    if (Number.isFinite(draft[`m${i}`])) out[`m${i}`] = Number(draft[`m${i}`]);
  }
  return out;
}

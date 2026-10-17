/** UMUX, Finstad (2010), four items on the original seven-point scale.
 * Items: https://www.uxtesttools.com/tools/umux
 * Scoring: https://doi.org/10.1016/j.intcom.2010.04.004 (section 4.2).
 */
export const UMUX_VERSION = "UMUX-4-7point-v1";
export const UMUX_ITEMS = [
  { key: "u1", text: "This system’s capabilities meet my requirements." },
  { key: "u2", text: "Using this system is a frustrating experience." },
  { key: "u3", text: "This system is easy to use." },
  { key: "u4", text: "I have to spend too much time correcting things with this system." }
];

export function umuxAnsweredCount(draft = {}) {
  return UMUX_ITEMS.filter(({ key }) => Number.isInteger(draft[key]) && draft[key] >= 1 && draft[key] <= 7).length;
}

export function isUmuxComplete(draft = {}) {
  return umuxAnsweredCount(draft) === UMUX_ITEMS.length;
}

export function umuxAnswersFromDraft(draft = {}) {
  return Object.fromEntries(UMUX_ITEMS
    .filter(({ key }) => Number.isInteger(draft[key]) && draft[key] >= 1 && draft[key] <= 7)
    .map(({ key }) => [key, draft[key]]));
}

export function scoreUmux(draft = {}) {
  if (!isUmuxComplete(draft)) return null;
  const total = (draft.u1 - 1) + (7 - draft.u2) + (draft.u3 - 1) + (7 - draft.u4);
  return { umuxTotal: total, umuxScore: Number((total / 24 * 100).toFixed(2)) };
}

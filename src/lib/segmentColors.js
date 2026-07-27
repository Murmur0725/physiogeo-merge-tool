/** Stable palette for path segments — map lines & progress dots share these. */
export const SEGMENT_COLORS = [
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#4ade80", // green
  "#fb7185", // rose
  "#38bdf8", // sky
  "#f97316", // orange
  "#e879f9" // fuchsia
];

export function colorForSegmentOrder(order) {
  const i = Number.isFinite(order) ? Math.max(0, Math.floor(order)) : 0;
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length];
}

/** Attach `color` onto each segment (does not mutate original if mapped fresh). */
export function withSegmentColors(segments = []) {
  return segments.map((seg, i) => ({
    ...seg,
    color: seg.color || colorForSegmentOrder(seg.order ?? i)
  }));
}

export function mapboxColorMatch(segments) {
  if (!segments?.length) return "#64748b";
  const expr = ["match", ["get", "id"]];
  segments.forEach((seg) => {
    expr.push(seg.id, seg.color || colorForSegmentOrder(seg.order));
  });
  expr.push("#64748b");
  return expr;
}

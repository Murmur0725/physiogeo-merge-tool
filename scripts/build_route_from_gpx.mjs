import fs from "node:fs";
import path from "node:path";

/**
 * Build a Post-test route JSON from Marks (C→D) + GPX.
 *
 * Usage:
 *   node scripts/build_route_from_gpx.mjs \
 *     <marks.csv> <track.gpx> <out.json> [mode] [param] [marksTimezone]
 *
 * mode:
 *   street (default) — keep CD GPS along streets (Mapbox match when token exists),
 *                      close loop with walking directions; param = simplify m (3)
 *   keypoints        — Mark notes only as vertices (can cut corners)
 *   simplify         — Douglas–Peucker only (no map match)
 *
 * marksTimezone: used only when 时间戳 is missing (chicago | beijing | ±HH:MM)
 *
 * Mapbox: reads VITE_MAPBOX_TOKEN / MAPBOX_TOKEN from env or .env.local
 */

const marksPath = process.argv[2] || "../raw——data/jojo/时间戳记录_20260717_133032.csv";
const gpxPath = process.argv[3] || "../raw——data/jojo/2026-07-17 12 54 43.gpx";
const outputPath =
  process.argv[4] || "src/config/routes/chicago-ricky-2026-08-05-cd.json";

const modeArg = String(process.argv[5] || "street").toLowerCase();
const mode = Number.isFinite(Number(modeArg)) ? "simplify" : modeArg;
const defaultParam = mode === "keypoints" ? 40 : 3;
const param = Number(
  Number.isFinite(Number(modeArg)) ? modeArg : process.argv[6] || defaultParam
);
const marksTimezone = String(
  (Number.isFinite(Number(modeArg)) ? process.argv[6] : process.argv[7]) || "chicago"
).toLowerCase();

/** Optional fixed end: lat,lng via argv or ROUTE_END=lat,lng */
function parseFixedEnd() {
  const fromArg = Number.isFinite(Number(modeArg))
    ? process.argv[7]
    : process.argv[8];
  const raw = fromArg || process.env.ROUTE_END || "";
  const match = String(raw)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const fixedEnd = parseFixedEnd();

function loadMapboxToken() {
  if (process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN) {
    return process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN;
  }
  for (const rel of [".env.local", ".env"]) {
    const file = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const hit = text.match(/^(?:VITE_)?MAPBOX_TOKEN=(.+)$/m);
    if (hit) return hit[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function parseLocalMarkTime(value, timezone) {
  const wall = value.trim().replace(" ", "T");
  if (timezone === "beijing" || timezone === "shanghai" || timezone === "+08:00") {
    return Date.parse(`${wall}+08:00`);
  }
  if (timezone === "chicago" || timezone === "cdt" || timezone === "-05:00") {
    return Date.parse(`${wall}-05:00`);
  }
  if (timezone === "cst" || timezone === "-06:00") {
    return Date.parse(`${wall}-06:00`);
  }
  if (/^[+-]\d{2}:\d{2}$/.test(timezone)) {
    return Date.parse(`${wall}${timezone}`);
  }
  throw new Error(`Unsupported marksTimezone: ${timezone}`);
}

function cleanNote(note) {
  return String(note || "")
    .replace(/\s+/g, " ")
    .trim();
}

function readMarks() {
  const text = fs.readFileSync(marksPath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const timeIndex = headers.indexOf("展示时间");
  const noteIndex = headers.indexOf("备注");
  const stampIndex = headers.indexOf("时间戳");

  if (timeIndex < 0 || noteIndex < 0) {
    throw new Error("Marks CSV must contain 展示时间 and 备注 columns");
  }

  const rows = lines
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      const displayTime = (values[timeIndex] || "").trim();
      const note = cleanNote(values[noteIndex] || "");
      const stampRaw = stampIndex >= 0 ? Number(values[stampIndex]) : NaN;
      const ms = Number.isFinite(stampRaw)
        ? stampRaw
        : parseLocalMarkTime(displayTime, marksTimezone);
      return { note, displayTime, ms };
    })
    .filter((row) => row.note && Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms);

  const start = rows.find((row) => row.note === "C");
  const end = rows.find((row) => row.note === "D");

  if (!start || !end) {
    throw new Error("Could not resolve a valid C → D experiment window");
  }
  if (end.ms <= start.ms) {
    throw new Error("Mark D must be after mark C");
  }

  const keyMarks = rows.filter(
    (row) => row.ms >= start.ms && row.ms <= end.ms
  );

  return {
    start,
    end,
    keyMarks,
    usedTimestamp: stampIndex >= 0
  };
}

function readGpxPoints() {
  const text = fs.readFileSync(gpxPath, "utf8");
  return [
    ...text.matchAll(
      /<trkpt lat="([^"]+)" lon="([^"]+)">[\s\S]*?<time>([^<]+)<\/time>[\s\S]*?<\/trkpt>/g
    )
  ]
    .map((match) => ({
      lat: Number(match[1]),
      lng: Number(match[2]),
      time: match[3],
      ms: Date.parse(match[3])
    }))
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Number.isFinite(point.ms)
    )
    .sort((a, b) => a.ms - b.ms);
}

function interpolateAt(points, ms) {
  const exact = points.find((point) => point.ms === ms);
  if (exact) return { ...exact };

  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1];
    const after = points[i];
    if (before.ms <= ms && after.ms >= ms) {
      const ratio = (ms - before.ms) / Math.max(1, after.ms - before.ms);
      return {
        lat: before.lat + (after.lat - before.lat) * ratio,
        lng: before.lng + (after.lng - before.lng) * ratio,
        time: new Date(ms).toISOString(),
        ms
      };
    }
  }
  throw new Error(`GPX does not cover ${new Date(ms).toISOString()}`);
}

function project(point, latitude) {
  const radians = (latitude * Math.PI) / 180;
  return {
    x: point.lng * 111320 * Math.cos(radians),
    y: point.lat * 110540
  };
}

function distanceToSegment(point, start, end) {
  const latitude = (point.lat + start.lat + end.lat) / 3;
  const p = project(point, latitude);
  const a = project(start, latitude);
  const b = project(end, latitude);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (!lengthSquared) return Math.hypot(p.x - a.x, p.y - a.y);
  const ratio = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)
  );
  return Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy));
}

function simplify(points, toleranceMeters) {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let splitIndex = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToSegment(points[i], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= toleranceMeters) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0, splitIndex + 1), toleranceMeters);
  const right = simplify(points.slice(splitIndex), toleranceMeters);
  return [...left.slice(0, -1), ...right];
}

/** Douglas–Peucker between forced anchors (C / D / CLOSE), fewer zig-zag vertices. */
function simplifyPreservingAnchors(points, toleranceMeters) {
  if (points.length <= 2) return points;
  const anchorIdx = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (
      i === 0 ||
      i === points.length - 1 ||
      p.note === "C" ||
      p.note === "D" ||
      p.note === "CLOSE" ||
      p.closedLoop ||
      p.fixed
    ) {
      anchorIdx.push(i);
    }
  }
  if (anchorIdx.length < 2) return simplify(points, toleranceMeters);

  const out = [];
  for (let s = 0; s < anchorIdx.length - 1; s += 1) {
    const chunk = points.slice(anchorIdx[s], anchorIdx[s + 1] + 1);
    const simplified = simplify(chunk, toleranceMeters);
    if (s === 0) out.push(...simplified);
    else out.push(...simplified.slice(1));
  }
  return out;
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(q));
}

function splitIndexes(points, count) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative.at(-1) + haversineMeters(points[i - 1], points[i]));
  }
  const total = cumulative.at(-1);
  const indexes = [0];

  for (let segment = 1; segment < count; segment += 1) {
    const target = (total * segment) / count;
    let best = 1;
    for (let i = 1; i < cumulative.length - 1; i += 1) {
      if (
        Math.abs(cumulative[i] - target) <
        Math.abs(cumulative[best] - target)
      ) {
        best = i;
      }
    }
    indexes.push(best);
  }
  return { indexes: [...new Set(indexes)].sort((a, b) => a - b), total };
}

function labelForMark(note, index, total) {
  if (index === 0 || note === "C") return "C · Experiment start";
  if (index === total - 1 || note === "CLOSE") return "Return · close loop";
  if (note === "D") return "D · Experiment end";
  if (!note) return `Street ${index + 1}`;
  return note.length > 36 ? `${note.slice(0, 34)}…` : note;
}

function dedupeByDistance(points, minMeters) {
  if (!points.length) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = kept.at(-1);
    const cur = points[i];
    const isAnchor = cur.note === "C" || cur.note === "D" || cur.forceKeep;
    if (isAnchor || haversineMeters(prev, cur) >= minMeters) {
      kept.push(cur);
    }
  }
  return kept;
}

function clipCdTrack(gpxPoints, marks) {
  return [
    interpolateAt(gpxPoints, marks.start.ms),
    ...gpxPoints.filter(
      (point) => point.ms > marks.start.ms && point.ms < marks.end.ms
    ),
    interpolateAt(gpxPoints, marks.end.ms)
  ];
}

function subsampleByDistance(points, maxCount) {
  if (points.length <= maxCount) return points;
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative.at(-1) + haversineMeters(points[i - 1], points[i]));
  }
  const total = cumulative.at(-1) || 1;
  const picked = [points[0]];
  for (let step = 1; step < maxCount - 1; step += 1) {
    const target = (total * step) / (maxCount - 1);
    let best = 1;
    for (let i = 1; i < cumulative.length - 1; i += 1) {
      if (Math.abs(cumulative[i] - target) < Math.abs(cumulative[best] - target)) {
        best = i;
      }
    }
    const point = points[best];
    if (picked.at(-1) !== point) picked.push(point);
  }
  picked.push(points.at(-1));
  return picked;
}

async function mapboxMatchWalking(points, token) {
  const samples = subsampleByDistance(points, 100);
  const coords = samples.map((p) => `${p.lng},${p.lat}`).join(";");
  // Tight radius at ends so matching cannot jump to the opposite sidewalk.
  const radiuses = samples
    .map((_, i) => (i === 0 || i === samples.length - 1 ? 8 : 18))
    .join(";");
  const url =
    `https://api.mapbox.com/matching/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}` +
    `&access_token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Map Matching HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  if (data.code !== "Ok" || !data.matchings?.[0]?.geometry?.coordinates?.length) {
    throw new Error(`Map Matching failed: ${data.code || "no matchings"}`);
  }
  return data.matchings[0].geometry.coordinates.map(([lng, lat]) => ({
    lng,
    lat,
    note: null
  }));
}

/** Keep GPS sidewalk side near C/D; use matched streets only in the middle. */
function reanchorEndsToGps(
  matched,
  clipped,
  simplifyMeters,
  headAnchorMeters = 70,
  tailAnchorMeters = 150
) {
  const gpsPath = simplify(clipped, simplifyMeters).map((p) => ({
    ...p,
    note: null,
    fromGps: true
  }));
  if (gpsPath.length < 2) return matched;

  // Exact GPX end (D) always terminates the CD path.
  const rawEnd = clipped.at(-1);
  gpsPath[gpsPath.length - 1] = {
    ...gpsPath[gpsPath.length - 1],
    lat: rawEnd.lat,
    lng: rawEnd.lng,
    time: rawEnd.time,
    ms: rawEnd.ms,
    note: "D",
    fromGps: true
  };

  const cum = [0];
  for (let i = 1; i < gpsPath.length; i += 1) {
    cum.push(cum.at(-1) + haversineMeters(gpsPath[i - 1], gpsPath[i]));
  }
  const total = cum.at(-1) || 1;

  let headEnd = 0;
  for (let i = 0; i < cum.length; i += 1) {
    if (cum[i] <= headAnchorMeters) headEnd = i;
  }
  headEnd = Math.max(1, headEnd);

  let tailStart = gpsPath.length - 1;
  for (let i = gpsPath.length - 1; i >= 0; i -= 1) {
    if (total - cum[i] <= tailAnchorMeters) tailStart = i;
  }
  tailStart = Math.min(gpsPath.length - 2, Math.max(headEnd + 1, tailStart));

  const head = gpsPath.slice(0, headEnd + 1);
  const tail = gpsPath.slice(tailStart);
  const headJoin = head.at(-1);
  const tailJoin = tail[0];

  let matchFrom = 0;
  let best = Infinity;
  for (let i = 0; i < matched.length; i += 1) {
    const d = haversineMeters(matched[i], headJoin);
    if (d < best) {
      best = d;
      matchFrom = i;
    }
  }

  let matchTo = matched.length - 1;
  best = Infinity;
  for (let i = matchFrom; i < matched.length; i += 1) {
    const d = haversineMeters(matched[i], tailJoin);
    if (d < best) {
      best = d;
      matchTo = i;
    }
  }
  if (matchTo <= matchFrom) matchTo = Math.min(matched.length - 1, matchFrom + 1);

  const middle = matched.slice(matchFrom, matchTo + 1).map((p) => ({
    ...p,
    fromGps: false
  }));

  const merged = [...head, ...middle.slice(1, -1), ...tail];
  // Guarantee CD path ends on original GPX D.
  merged[merged.length - 1] = {
    ...merged[merged.length - 1],
    lat: rawEnd.lat,
    lng: rawEnd.lng,
    time: rawEnd.time,
    ms: rawEnd.ms,
    note: "D",
    fromGps: true
  };
  return merged;
}

/** Truncate path so it ends at the vertex nearest raw D, then pin that vertex to GPX D. */
function endPathAtRawGpx(path, rawEnd) {
  if (!path.length) return path;
  const hit = nearestIndex(path, rawEnd, Math.floor(path.length * 0.2), path.length - 1);
  const trimmed = path.slice(0, hit.index + 1);
  trimmed[trimmed.length - 1] = {
    ...trimmed[trimmed.length - 1],
    lat: rawEnd.lat,
    lng: rawEnd.lng,
    time: rawEnd.time,
    ms: rawEnd.ms,
    note: "D",
    fromGps: true
  };
  return trimmed;
}

async function mapboxWalkingClose(from, to, token) {
  if (haversineMeters(from, to) < 3) {
    return [{ ...to, note: "CLOSE", closedLoop: true }];
  }
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Directions HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const coords = data.routes?.[0]?.geometry?.coordinates;
  if (!coords?.length) {
    throw new Error(`Directions failed: ${data.code || "no route"}`);
  }
  return coords.slice(1).map(([lng, lat], index, arr) => ({
    lng,
    lat,
    note: index === arr.length - 1 ? "CLOSE" : null,
    closedLoop: index === arr.length - 1
  }));
}

function nearestIndex(pathPoints, target, from = 0, to = Infinity) {
  let best = Math.min(Math.max(0, from), pathPoints.length - 1);
  let bestDist = Infinity;
  const end = Math.min(pathPoints.length - 1, to);
  for (let i = from; i <= end; i += 1) {
    if (pathPoints[i].closedLoop) continue;
    const dist = haversineMeters(pathPoints[i], target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return { index: best, dist: bestDist };
}

function annotateKeyMarks(pathPoints, gpxPoints, marks, endOverride = null) {
  const annotated = pathPoints.map((p) => ({ ...p, note: p.note || null }));
  if (!annotated.length) return annotated;

  const rawC = interpolateAt(gpxPoints, marks.start.ms);
  const gpxD = interpolateAt(gpxPoints, marks.end.ms);
  const rawD = endOverride
    ? { ...gpxD, lat: endOverride.lat, lng: endOverride.lng }
    : gpxD;

  // Prefer an existing D vertex (already pinned); else nearest to target end.
  let dIndex = annotated.findIndex((p) => p.note === "D" && !p.closedLoop);
  if (dIndex < 0) {
    dIndex = nearestIndex(
      annotated,
      rawD,
      Math.floor(annotated.length * 0.35),
      annotated.length - 1
    ).index;
  }

  const cHit = nearestIndex(annotated, rawC, 0, Math.floor(annotated.length * 0.25));

  annotated[cHit.index] = {
    ...annotated[cHit.index],
    lat: rawC.lat,
    lng: rawC.lng,
    note: "C",
    time: rawC.time
  };
  annotated[dIndex] = {
    ...annotated[dIndex],
    lat: rawD.lat,
    lng: rawD.lng,
    note: "D",
    time: rawD.time,
    fixed: Boolean(endOverride)
  };

  // Rotate so path starts at C if needed.
  let rotated = annotated;
  if (cHit.index > 0 && !annotated[0].closedLoop) {
    // Keep order; only ensure index 0 is C by moving C vertex to front when it is near start.
    if (cHit.index <= 3) {
      rotated = [
        annotated[cHit.index],
        ...annotated.slice(0, cHit.index),
        ...annotated.slice(cHit.index + 1)
      ];
    }
  }
  rotated[0] = { ...rotated[0], note: "C", lat: rawC.lat, lng: rawC.lng };

  // Clear duplicate D notes; keep the pinned end only.
  let sawD = false;
  for (let i = 0; i < rotated.length; i += 1) {
    if (rotated[i].note !== "D" || rotated[i].closedLoop) continue;
    if (!sawD) {
      sawD = true;
      rotated[i] = {
        ...rotated[i],
        lat: rawD.lat,
        lng: rawD.lng,
        note: "D"
      };
    } else {
      rotated[i] = { ...rotated[i], note: null };
    }
  }

  const keySamples = marks.keyMarks
    .filter((m) => m.note !== "C" && m.note !== "D")
    .map((mark) => ({
      mark,
      at: interpolateAt(gpxPoints, mark.ms)
    }));

  for (const { mark, at } of keySamples) {
    let best = 1;
    let bestDist = Infinity;
    for (let i = 1; i < rotated.length - 1; i += 1) {
      if (rotated[i].note === "C" || rotated[i].note === "D" || rotated[i].closedLoop) {
        continue;
      }
      if (rotated[i].note) continue;
      const dist = haversineMeters(rotated[i], at);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (bestDist <= 45) {
      rotated[best] = { ...rotated[best], note: mark.note };
    }
  }

  return rotated;
}

async function buildStreetPath(gpxPoints, marks, simplifyMeters) {
  const clipped = clipCdTrack(gpxPoints, marks);
  const rawStart = { ...clipped[0], note: "C" };
  const gpxEnd = { ...clipped.at(-1), note: "D" };
  // Optional manual end override (lat,lng); otherwise use GPX D.
  const rawEnd = fixedEnd
    ? {
        lat: fixedEnd.lat,
        lng: fixedEnd.lng,
        time: gpxEnd.time,
        ms: gpxEnd.ms,
        note: "D",
        fixed: true
      }
    : gpxEnd;
  const token = loadMapboxToken();
  let alongStreets;
  let matched = false;

  if (token) {
    try {
      const matchedRaw = await mapboxMatchWalking(clipped, token);
      matched = true;
      console.log(`Map matched ${clipped.length} GPS → ${matchedRaw.length} street vertices`);
      const streetTol = Math.max(8, simplifyMeters);
      const cleaned = simplify(matchedRaw, streetTol);
      const gpsLen = (() => {
        let t = 0;
        for (let i = 1; i < clipped.length; i += 1) {
          t += haversineMeters(clipped[i - 1], clipped[i]);
        }
        return t;
      })();
      // Street-matched middle; force GPX start/end so C/D follow original track.
      let candidate = cleaned.map((p) => ({ ...p, note: null }));
      const gpsSimplified = simplify(clipped, Math.max(6, streetTol * 0.75)).map(
        (p) => ({ ...p, fromGps: true })
      );
      // Splice short GPX head/tail so sidewalk side matches recording.
      const head = gpsSimplified.slice(0, Math.min(4, gpsSimplified.length));
      const tail = gpsSimplified.slice(Math.max(0, gpsSimplified.length - 4));
      let matchFrom = 0;
      let best = Infinity;
      for (let i = 0; i < candidate.length; i += 1) {
        const d = haversineMeters(candidate[i], head.at(-1));
        if (d < best) {
          best = d;
          matchFrom = i;
        }
      }
      let matchTo = candidate.length - 1;
      best = Infinity;
      for (let i = matchFrom; i < candidate.length; i += 1) {
        const d = haversineMeters(candidate[i], tail[0]);
        if (d < best) {
          best = d;
          matchTo = i;
        }
      }
      if (matchTo <= matchFrom) {
        matchTo = Math.min(candidate.length - 1, matchFrom + 1);
      }
      candidate = [
        ...head,
        ...candidate.slice(matchFrom + 1, matchTo),
        ...tail
      ];
      candidate = simplify(candidate, streetTol);
      const candLen = (() => {
        let t = 0;
        for (let i = 1; i < candidate.length; i += 1) {
          t += haversineMeters(candidate[i - 1], candidate[i]);
        }
        return t;
      })();
      if (candLen < gpsLen * 0.45) {
        console.warn(
          `Street path too short (${candLen.toFixed(0)} m vs GPS ${gpsLen.toFixed(0)} m); using matched simplify only`
        );
        alongStreets = cleaned;
      } else {
        alongStreets = candidate;
      }
      console.log(
        `Street path → ${alongStreets.length} vertices, ~${candLen.toFixed(0)} m`
      );
    } catch (err) {
      console.warn(`Map Matching fallback to GPS simplify: ${err.message}`);
    }
  } else {
    console.warn("No Mapbox token; using GPS simplify along recorded track");
  }

  if (!alongStreets) {
    alongStreets = simplify(clipped, simplifyMeters).map((p) => ({
      ...p,
      note: null,
      fromGps: true
    }));
  }

  // Always pin CD ends to original GPX C / D (no manual override unless provided).
  alongStreets[0] = {
    ...alongStreets[0],
    lat: rawStart.lat,
    lng: rawStart.lng,
    time: rawStart.time,
    ms: rawStart.ms,
    note: "C",
    fromGps: true
  };
  alongStreets = endPathAtRawGpx(alongStreets, rawEnd);
  alongStreets[alongStreets.length - 1] = {
    ...rawEnd,
    note: "D",
    fromGps: true,
    fixed: Boolean(fixedEnd)
  };
  console.log(
    `GPX C: (${rawStart.lng.toFixed(6)}, ${rawStart.lat.toFixed(6)})`
  );
  console.log(
    `GPX D: (${rawEnd.lng.toFixed(6)}, ${rawEnd.lat.toFixed(6)})`
  );

  // Final CD simplify: keep C/D anchors.
  alongStreets = simplifyPreservingAnchors(alongStreets, simplifyMeters);
  alongStreets[0] = {
    ...alongStreets[0],
    lat: rawStart.lat,
    lng: rawStart.lng,
    time: rawStart.time,
    ms: rawStart.ms,
    note: "C",
    fromGps: true
  };
  alongStreets[alongStreets.length - 1] = {
    ...alongStreets[alongStreets.length - 1],
    lat: rawEnd.lat,
    lng: rawEnd.lng,
    time: rawEnd.time,
    ms: rawEnd.ms,
    note: "D",
    fromGps: true,
    fixed: Boolean(fixedEnd)
  };

  const start = {
    lat: rawStart.lat,
    lng: rawStart.lng
  };
  // Close loop from D → C (simplified along streets).
  let closing = [];
  if (token) {
    try {
      const rawClose = await mapboxWalkingClose(rawEnd, start, token);
      closing = simplifyPreservingAnchors(
        [
          { ...rawEnd, note: "D" },
          ...rawClose.map((p, i, arr) =>
            i === arr.length - 1 ? { ...p, note: "CLOSE", closedLoop: true } : p
          )
        ],
        simplifyMeters
      ).slice(1);
      console.log(`Closed loop D→C along streets with ${closing.length} vertices`);
    } catch (err) {
      console.warn(`Directions close-loop fallback: ${err.message}`);
      closing = [{ ...start, note: "CLOSE", closedLoop: true }];
    }
  } else {
    closing = [{ ...start, note: "CLOSE", closedLoop: true }];
  }

  const combined = [...alongStreets, ...closing];
  combined[combined.length - 1] = {
    ...combined[combined.length - 1],
    lat: start.lat,
    lng: start.lng,
    note: "CLOSE",
    closedLoop: true
  };
  combined[0] = {
    ...combined[0],
    lat: start.lat,
    lng: start.lng,
    note: "C",
    fromGps: true
  };

  const annotated = annotateKeyMarks(
    combined,
    gpxPoints,
    marks,
    fixedEnd ? rawEnd : null
  );

  // Re-pin: start = GPX C, experiment end = GPX D, loop close = GPX C (same as start).
  const dIdx = annotated.findIndex((p) => p.note === "D");
  if (dIdx >= 0) {
    annotated[dIdx] = {
      ...annotated[dIdx],
      lat: rawEnd.lat,
      lng: rawEnd.lng,
      time: rawEnd.time,
      ms: rawEnd.ms,
      note: "D",
      fromGps: true
    };
  }
  annotated[0] = {
    ...annotated[0],
    lat: rawStart.lat,
    lng: rawStart.lng,
    time: rawStart.time,
    ms: rawStart.ms,
    note: "C",
    fromGps: true
  };
  annotated[annotated.length - 1] = {
    ...annotated[annotated.length - 1],
    lat: rawStart.lat,
    lng: rawStart.lng,
    time: rawStart.time,
    ms: rawStart.ms,
    note: "CLOSE",
    closedLoop: true,
    fromGps: true
  };

  const startEndSame =
    annotated[0].lat === annotated.at(-1).lat &&
    annotated[0].lng === annotated.at(-1).lng;
  console.log(
    `Loop start/end identical (GPX C): ${startEndSame} @ (${rawStart.lng.toFixed(6)}, ${rawStart.lat.toFixed(6)})`
  );
  console.log(
    `Experiment D follows GPX: (${rawEnd.lng.toFixed(6)}, ${rawEnd.lat.toFixed(6)})`
  );

  return {
    path: annotated,
    rawPointCount: clipped.length,
    mapMatched: matched,
    closedAlongStreets: closing.length > 1,
    endFollowsGpx: !fixedEnd,
    fixedEnd: fixedEnd || null
  };
}

function buildKeypointPath(gpxPoints, marks, minSpacingMeters) {
  const sampled = marks.keyMarks.map((mark) => {
    const at = interpolateAt(gpxPoints, mark.ms);
    return {
      ...at,
      note: mark.note,
      displayTime: mark.displayTime
    };
  });

  const spaced = dedupeByDistance(sampled, minSpacingMeters);
  const start = spaced[0];
  if (!start) throw new Error("No keypoint GPS samples in C→D window");

  // Force closed loop: end coordinates identical to start.
  const closed = [...spaced];
  const last = closed.at(-1);
  if (haversineMeters(start, last) < 1) {
    closed[closed.length - 1] = {
      ...last,
      lat: start.lat,
      lng: start.lng,
      note: last.note === "D" ? "D" : last.note,
      forceKeep: true,
      closedLoop: true
    };
  } else {
    closed.push({
      ...start,
      ms: marks.end.ms,
      time: new Date(marks.end.ms).toISOString(),
      note: "CLOSE",
      displayTime: marks.end.displayTime,
      forceKeep: true,
      closedLoop: true
    });
  }

  return closed;
}

function buildSimplifiedPath(gpxPoints, marks, toleranceMeters) {
  const clipped = [
    interpolateAt(gpxPoints, marks.start.ms),
    ...gpxPoints.filter(
      (point) => point.ms > marks.start.ms && point.ms < marks.end.ms
    ),
    interpolateAt(gpxPoints, marks.end.ms)
  ];
  const simplified = simplify(clipped, toleranceMeters).map((point, index, arr) => ({
    ...point,
    note: index === 0 ? "C" : index === arr.length - 1 ? "D" : `GPS ${index + 1}`
  }));

  // Close loop
  const start = simplified[0];
  const last = simplified.at(-1);
  if (haversineMeters(start, last) >= 1) {
    simplified.push({
      ...start,
      ms: marks.end.ms,
      time: new Date(marks.end.ms).toISOString(),
      note: "CLOSE",
      closedLoop: true
    });
  } else {
    simplified[simplified.length - 1] = {
      ...last,
      lat: start.lat,
      lng: start.lng,
      closedLoop: true
    };
  }
  return { path: simplified, rawPointCount: clipped.length };
}

function routeIdFromOutput(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

async function main() {
  const marks = readMarks();
  const allPoints = readGpxPoints();

  let pathPoints;
  let rawPointCount;
  let modeMeta;

  if (mode === "street") {
    const built = await buildStreetPath(allPoints, marks, param);
    pathPoints = built.path;
    rawPointCount = built.rawPointCount;
    modeMeta = {
      mode: "street",
      simplifyToleranceMeters: param,
      mapMatched: built.mapMatched,
      closedAlongStreets: built.closedAlongStreets,
      endFollowsGpx: built.endFollowsGpx,
      fixedEnd: built.fixedEnd
    };
  } else if (mode === "keypoints") {
    pathPoints = buildKeypointPath(allPoints, marks, param);
    rawPointCount = marks.keyMarks.length;
    modeMeta = { mode: "keypoints", minSpacingMeters: param };
  } else if (mode === "simplify") {
    const built = buildSimplifiedPath(allPoints, marks, param);
    pathPoints = built.path;
    rawPointCount = built.rawPointCount;
    modeMeta = { mode: "simplify", simplifyToleranceMeters: param };
  } else {
    throw new Error(`Unknown mode: ${mode} (use street, keypoints, or simplify)`);
  }

  const { indexes, total } = splitIndexes(pathPoints, 3);
  const routeId = routeIdFromOutput(outputPath);

  const waypoints = pathPoints.map((point, index) => ({
    id: `w${index}`,
    lng: Number(point.lng.toFixed(6)),
    lat: Number(point.lat.toFixed(6)),
    label: labelForMark(point.note, index, pathPoints.length),
    time: point.time || null,
    mark: point.note || null
  }));

  // Ensure numeric identity of first/last coords in JSON
  waypoints[waypoints.length - 1].lng = waypoints[0].lng;
  waypoints[waypoints.length - 1].lat = waypoints[0].lat;
  waypoints[waypoints.length - 1].label = "Return · close loop";

  const routeConfig = {
    id: routeId,
    name: "Chicago Loop · Ricky CD",
    instrumentId: "customEval",
    streetViewSampleCount: 5,
    source: {
      gpx: path.basename(gpxPath),
      marks: path.basename(marksPath),
      startLocal: marks.start.displayTime,
      endLocal: marks.end.displayTime,
      startUtc: new Date(marks.start.ms).toISOString(),
      endUtc: new Date(marks.end.ms).toISOString(),
      marksTimezone: marks.usedTimestamp ? "timestamp-column" : marksTimezone,
      rawPointCount,
      simplifiedPointCount: waypoints.length,
      closedLoop: true,
      distanceMeters: Number(total.toFixed(1)),
      ...modeMeta
    },
    waypoints,
    splits: indexes.map((index, order) => ({
      afterWaypointId: `w${index}`,
      segmentLabel: `Section ${order + 1}`
    }))
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(routeConfig, null, 2)}\n`);

  console.log(
    `Wrote ${outputPath}: ${rawPointCount} GPS → ${waypoints.length} street vertices, ${total.toFixed(1)} m (closed loop)`
  );
  console.log(
    `Window C→D: ${marks.start.displayTime} → ${marks.end.displayTime}`
  );
  console.log(
    `Start/end: (${waypoints[0].lng}, ${waypoints[0].lat}) = (${waypoints.at(-1).lng}, ${waypoints.at(-1).lat})`
  );
  const labeled = waypoints.filter(
    (w) => !w.label.startsWith("Street ") || w.mark
  );
  console.log("Key labels:");
  for (const w of labeled) {
    console.log(`  ${w.id}  ${w.label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

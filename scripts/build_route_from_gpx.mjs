import fs from "node:fs";
import path from "node:path";

const marksPath = process.argv[2] || "../raw——data/时间戳记录_20260717_133032.csv";
const gpxPath = process.argv[3] || "../raw——data/2026-07-17 12 54 43.gpx";
const outputPath =
  process.argv[4] || "src/config/routes/shenzhen-2026-07-17-cd.json";
const simplifyToleranceMeters = Number(process.argv[5] || 3);

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

function parseShanghaiTime(value) {
  return Date.parse(`${value.trim().replace(" ", "T")}+08:00`);
}

function readWindow() {
  const text = fs.readFileSync(marksPath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const timeIndex = headers.indexOf("展示时间");
  const noteIndex = headers.indexOf("备注");

  if (timeIndex < 0 || noteIndex < 0) {
    throw new Error("Marks CSV must contain 展示时间 and 备注 columns");
  }

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return {
      note: (values[noteIndex] || "").trim(),
      displayTime: (values[timeIndex] || "").trim(),
      ms: parseShanghaiTime(values[timeIndex] || "")
    };
  });
  const start = rows.find((row) => row.note === "C");
  const end = rows.find((row) => row.note === "D");

  if (!start || !end || !Number.isFinite(start.ms) || !Number.isFinite(end.ms)) {
    throw new Error("Could not resolve a valid C → D experiment window");
  }
  return { start, end };
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

const window = readWindow();
const allPoints = readGpxPoints();
const clipped = [
  interpolateAt(allPoints, window.start.ms),
  ...allPoints.filter(
    (point) => point.ms > window.start.ms && point.ms < window.end.ms
  ),
  interpolateAt(allPoints, window.end.ms)
];
const simplified = simplify(clipped, simplifyToleranceMeters);
const { indexes, total } = splitIndexes(simplified, 3);

const waypoints = simplified.map((point, index) => ({
  id: `w${index}`,
  lng: Number(point.lng.toFixed(6)),
  lat: Number(point.lat.toFixed(6)),
  label:
    index === 0
      ? "C · Experiment start"
      : index === simplified.length - 1
        ? "D · Experiment end"
        : `GPS ${index + 1}`,
  time: point.time
}));

const routeConfig = {
  id: "shenzhen-2026-07-17-cd",
  name: "Chicago Loop Demo (Wabash)",
  instrumentId: "customEval",
  streetViewSampleCount: 5,
  source: {
    gpx: path.basename(gpxPath),
    marks: path.basename(marksPath),
    startLocal: window.start.displayTime,
    endLocal: window.end.displayTime,
    rawPointCount: clipped.length,
    simplifiedPointCount: simplified.length,
    simplifyToleranceMeters,
    distanceMeters: Number(total.toFixed(1))
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
  `Wrote ${outputPath}: ${clipped.length} raw points → ${simplified.length} waypoints, ${total.toFixed(1)} m`
);

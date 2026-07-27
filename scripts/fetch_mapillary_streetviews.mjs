import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  haversineMeters,
  parseRouteConfig
} from "../src/lib/parseRouteConfig.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const defaultRoutePath = path.join(
  projectRoot,
  "src/config/routes/shenzhen-2026-07-17-cd.json"
);

function parseArgs(args) {
  const options = {
    routePath: defaultRoutePath,
    radius: 50,
    limit: 10
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--route" && args[i + 1]) {
      options.routePath = path.resolve(projectRoot, args[++i]);
    } else if (arg === "--radius" && args[i + 1]) {
      options.radius = Math.min(50, Math.max(1, Number(args[++i]) || 50));
    } else if (arg === "--limit" && args[i + 1]) {
      options.limit = Math.min(100, Math.max(1, Number(args[++i]) || 10));
    }
  }

  return options;
}

async function loadEnvFile(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator < 1) return;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

async function loadLocalEnvironment() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));
}

function candidatePoint(candidate) {
  const coordinates =
    candidate.computed_geometry?.coordinates || candidate.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return {
    lng: Number(coordinates[0]),
    lat: Number(coordinates[1])
  };
}

function selectClosestCandidate(point, candidates) {
  return candidates
    .map((candidate) => {
      const location = candidatePoint(candidate);
      if (!location) return null;
      return {
        candidate,
        location,
        distanceMeters: haversineMeters(point, location)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;
}

async function fetchNearbyImages(point, token, options) {
  const url = new URL("https://graph.mapillary.com/images");
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lng", String(point.lng));
  url.searchParams.set("radius", String(options.radius));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set(
    "fields",
    [
      "id",
      "computed_geometry",
      "captured_at",
      "compass_angle",
      "thumb_1024_url",
      "is_pano"
    ].join(",")
  );
  url.searchParams.set("access_token", token);

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Mapillary request failed (${response.status}): ${body.slice(0, 240)}`
    );
  }

  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

function toStoredSample(point, match) {
  const base = {
    id: point.id,
    lng: Number(point.lng.toFixed(6)),
    lat: Number(point.lat.toFixed(6)),
    label: point.label
  };

  if (!match) return base;
  const image = match.candidate;
  return {
    ...base,
    mapillaryImageId: String(image.id),
    thumbUrl: image.thumb_1024_url || null,
    capturedAt: image.captured_at
      ? new Date(Number(image.captured_at)).toISOString()
      : null,
    compassAngle: Number.isFinite(Number(image.compass_angle))
      ? Number(image.compass_angle)
      : null,
    imageDistanceMeters: Number(match.distanceMeters.toFixed(1))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnvironment();
  const token =
    process.env.MAPILLARY_TOKEN || process.env.VITE_MAPILLARY_TOKEN || "";

  if (!token) {
    throw new Error(
      "Missing Mapillary token. Add VITE_MAPILLARY_TOKEN=MLY|... to .env.local, then run npm run streetviews:fetch."
    );
  }

  const routeConfig = JSON.parse(
    await fs.readFile(options.routePath, "utf8")
  );
  const parsed = parseRouteConfig(routeConfig);
  const segmentSamples = {};
  let matchedCount = 0;
  let totalCount = 0;

  for (const segment of parsed.segments) {
    const storedPoints = [];
    for (const point of segment.samplePoints) {
      totalCount += 1;
      const candidates = await fetchNearbyImages(point, token, options);
      const match = selectClosestCandidate(point, candidates);
      if (match) matchedCount += 1;
      storedPoints.push(toStoredSample(point, match));

      const status = match
        ? `${match.distanceMeters.toFixed(1)} m · image ${match.candidate.id}`
        : `no image within ${options.radius} m`;
      console.log(`${segment.label} / ${point.label}: ${status}`);
    }
    segmentSamples[segment.label] = storedPoints;
  }

  routeConfig.segmentSamples = segmentSamples;
  await fs.writeFile(
    options.routePath,
    `${JSON.stringify(routeConfig, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `Updated ${path.relative(projectRoot, options.routePath)}: ${matchedCount}/${totalCount} GPS points matched.`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

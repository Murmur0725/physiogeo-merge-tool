/**
 * Parse a route config (waypoints + splits) into a polyline path and segments.
 * No time fields required.
 */

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cumulativeLengths(points) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
    lengths.push(total);
  }
  return { lengths, total };
}

function interpolateAlong(points, lengths, total, progress) {
  if (!points.length) return null;
  if (points.length === 1 || total <= 0) return { ...points[0], progress: 0 };
  const target = Math.min(1, Math.max(0, progress)) * total;
  for (let i = 1; i < lengths.length; i += 1) {
    if (target <= lengths[i]) {
      const span = lengths[i] - lengths[i - 1] || 1;
      const t = (target - lengths[i - 1]) / span;
      return {
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t,
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
        progress
      };
    }
  }
  const last = points[points.length - 1];
  return { lng: last.lng, lat: last.lat, progress: 1 };
}

function samplePointsOnGeometry(geometry, count) {
  const n = Math.max(1, Number(count) || 1);
  const { lengths, total } = cumulativeLengths(geometry);
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const progress = n === 1 ? 0.5 : i / (n - 1);
    const sample = interpolateAlong(geometry, lengths, total, progress);
    points.push({
      id: `p${i}`,
      lng: sample.lng,
      lat: sample.lat,
      progress: sample.progress,
      label: `Point ${i + 1}`
    });
  }
  return points;
}

function resolveSplitIndexes(waypoints, splits) {
  if (!splits?.length) {
    return waypoints.length > 1 ? [0, waypoints.length - 1] : [0];
  }
  const indexes = new Set([0, waypoints.length - 1]);
  splits.forEach((split) => {
    if (split.afterWaypointId) {
      const idx = waypoints.findIndex((w) => w.id === split.afterWaypointId);
      if (idx >= 0 && idx < waypoints.length - 1) indexes.add(idx);
    } else if (Number.isFinite(split.atIndex)) {
      const idx = Math.min(waypoints.length - 2, Math.max(0, Number(split.atIndex)));
      indexes.add(idx);
    } else if (Number.isFinite(split.atProgress)) {
      const { lengths, total } = cumulativeLengths(waypoints);
      const target = Math.min(1, Math.max(0, split.atProgress)) * total;
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < lengths.length - 1; i += 1) {
        const diff = Math.abs(lengths[i] - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      indexes.add(best);
    }
  });
  return [...indexes].sort((a, b) => a - b);
}

function labelForSplit(splits, endWaypointId, order) {
  const hit = splits?.find((s) => s.afterWaypointId === endWaypointId);
  return hit?.segmentLabel || `Segment ${order + 1}`;
}

/**
 * @param {object} config RouteConfig JSON
 * @returns {{ path, segments, instrumentId, meta }}
 */
export function parseRouteConfig(config) {
  if (!config?.waypoints?.length) {
    throw new Error("Route config must include waypoints[]");
  }
  const waypoints = config.waypoints.map((w, i) => ({
    id: w.id || `w${i}`,
    lng: Number(w.lng),
    lat: Number(w.lat),
    label: w.label || `W${i}`
  }));
  if (waypoints.some((w) => !Number.isFinite(w.lng) || !Number.isFinite(w.lat))) {
    throw new Error("Each waypoint needs numeric lng/lat");
  }

  const path = waypoints.map((w) => ({ lng: w.lng, lat: w.lat, id: w.id, label: w.label }));
  const splitIdx = resolveSplitIndexes(waypoints, config.splits || []);
  const sampleCount = config.streetViewSampleCount ?? 5;
  const segments = [];

  for (let s = 0; s < splitIdx.length - 1; s += 1) {
    const start = splitIdx[s];
    const end = splitIdx[s + 1];
    const geometry = waypoints.slice(start, end + 1).map((w) => ({ lng: w.lng, lat: w.lat }));
    const explicit =
      config.segmentSamples?.[labelForSplit(config.splits, waypoints[start].id, s)] ||
      config.segmentSamples?.[`Segment ${s + 1}`];
    const samples = explicit?.length
      ? explicit.map((p, i) => ({
          id: p.id || `p${i}`,
          lng: Number(p.lng),
          lat: Number(p.lat),
          progress: i / Math.max(1, explicit.length - 1),
          label: p.label || `Point ${i + 1}`,
          mapillaryImageId: p.mapillaryImageId || null,
          thumbUrl: p.thumbUrl || null,
          capturedAt: p.capturedAt || null,
          compassAngle: Number.isFinite(Number(p.compassAngle))
            ? Number(p.compassAngle)
            : null,
          imageDistanceMeters: Number.isFinite(Number(p.imageDistanceMeters))
            ? Number(p.imageDistanceMeters)
            : null
        }))
      : samplePointsOnGeometry(geometry, sampleCount);

    segments.push({
      id: `seg-${s}`,
      label: labelForSplit(config.splits, waypoints[start].id, s),
      order: s,
      startWaypointId: waypoints[start].id,
      endWaypointId: waypoints[end].id,
      geometry,
      samplePoints: samples
    });
  }

  // If only one waypoint pair and no valid splits, one full segment
  if (!segments.length && waypoints.length >= 2) {
    const geometry = waypoints.map((w) => ({ lng: w.lng, lat: w.lat }));
    segments.push({
      id: "seg-0",
      label: "Segment 1",
      order: 0,
      startWaypointId: waypoints[0].id,
      endWaypointId: waypoints[waypoints.length - 1].id,
      geometry,
      samplePoints: samplePointsOnGeometry(geometry, sampleCount)
    });
  }

  return {
    meta: {
      id: config.id || "route",
      name: config.name || "Route",
      streetViewSampleCount: sampleCount
    },
    instrumentId: config.instrumentId || "customEval",
    path,
    segments
  };
}

export { samplePointsOnGeometry, haversineMeters };

<script setup>
import { nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const ASSET_BASE = `${import.meta.env.BASE_URL}biometric-demo/`;
const GEOJSON_URL = `${ASSET_BASE}biometric_multi_metric_extracted_frames_with_spectrogram_10s.geojson`;

const pillarRadiusMeters = 2;
const extrusionOpacity = 0.86;
const BATCH_SIZE = 3;
const STEP_DELAY = 70;
const GROW_DURATION = 700;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 75;

const initialView = {
  center: [113.999715, 22.597309],
  zoom: 15,
  pitch: 55,
  bearing: 20
};

const METRICS = {
  heart_rate: { label: "Heart Rate", unit: "bpm", decimals: 0 },
  rr: { label: "RR Interval", unit: "ms", decimals: 1 },
  temperature: { label: "Temperature", unit: "°C", decimals: 1 },
  attention: { label: "Attention", unit: "score", decimals: 0 },
  relaxation: { label: "Relaxation", unit: "score", decimals: 0 },
  sync_rate: { label: "Sync Rate", unit: "%", decimals: 0 },
  mental_effort: { label: "Mental Effort", unit: "score", decimals: 0 },
  familarity: { label: "Familiarity", unit: "score", decimals: 0 },
  alpha: { label: "Alpha Power", unit: "power", decimals: 0 },
  beta: { label: "Beta Power", unit: "power", decimals: 0 },
  gamma: { label: "Gamma Power", unit: "power", decimals: 0 },
  delta: { label: "Delta Power", unit: "power", decimals: 0 },
  theta: { label: "Theta Power", unit: "power", decimals: 0 },
  low_alpha: { label: "Low Alpha", unit: "power", decimals: 0 },
  high_alpha: { label: "High Alpha", unit: "power", decimals: 0 },
  low_beta: { label: "Low Beta", unit: "power", decimals: 0 },
  high_beta: { label: "High Beta", unit: "power", decimals: 0 },
  low_gamma: { label: "Low Gamma", unit: "power", decimals: 0 },
  mid_gamma: { label: "Mid Gamma", unit: "power", decimals: 0 },
  pitch: { label: "Pitch", unit: "°", decimals: 0 },
  yaw: { label: "Yaw", unit: "°", decimals: 0 },
  roll: { label: "Roll", unit: "°", decimals: 0 }
};

const METRIC_GROUPS = [
  {
    label: "Cardiovascular and body",
    options: ["heart_rate", "rr", "temperature"]
  },
  {
    label: "Cognitive indicators",
    options: ["attention", "relaxation", "sync_rate", "mental_effort", "familarity"]
  },
  {
    label: "EEG combined bands",
    options: ["alpha", "beta", "gamma", "delta", "theta"]
  },
  {
    label: "EEG sub-bands",
    options: ["low_alpha", "high_alpha", "low_beta", "high_beta", "low_gamma", "mid_gamma"]
  },
  {
    label: "Head orientation",
    options: ["pitch", "yaw", "roll"]
  }
];

const rainbowStops = [
  [0.0, "#2E86FF"],
  [0.2, "#00C2FF"],
  [0.4, "#00E676"],
  [0.6, "#FFEB3B"],
  [0.8, "#FF9800"],
  [1.0, "#FF1744"]
];

const R = 6378137;
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

const mapEl = ref(null);
const currentMetric = ref("heart_rate");
const loadError = ref("");
const legend = reactive({
  title: "Heart Rate (bpm)",
  min: "--",
  max: "--",
  note: "Color and height use a robust display range.",
  gradient: ""
});

const panel = reactive({
  hasSelection: false,
  title: "No pillar selected",
  valueLabel: "Heart Rate",
  value: "--",
  unit: "value",
  event: "No recorded event at this point.",
  time: "--",
  coord: "--",
  imageUrl: "",
  imageVisible: false,
  imageEmpty: false,
  imageEmptyText: "No corresponding image was found for this timestamp.",
  spectrogramUrl: "",
  spectrogramVisible: false,
  spectrogramEmpty: false,
  audioUrl: "",
  audioVisible: false
});

let map = null;
let pillarData = null;
let selectedFeatureId = null;
let selectedFeature = null;
let growTimer = null;

function resolveAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  if (path.startsWith("/")) {
    return path;
  }
  return `${ASSET_BASE}${path.replace(/^\.\//, "")}`;
}

function lonLatToMeters(lng, lat) {
  const x = R * ((lng * Math.PI) / 180);
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

function metersToLonLat(x, y) {
  const lng = ((x / R) * 180) / Math.PI;
  const lat = ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI;
  return [lng, lat];
}

function firstAvailable(p, keys, fallback = "") {
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null && String(p[key]).trim() !== "") {
      return String(p[key]);
    }
  }
  return fallback;
}

function getMetricValue(feature, metricKey = currentMetric.value) {
  const p = feature && feature.properties ? feature.properties : {};
  const value = Number(p[metricKey]);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function circlePolygon(lngLat, radiusMeters = 8, steps = 24) {
  const [lng, lat] = lngLat;
  const [cx, cy] = lonLatToMeters(lng, lat);
  const coords = [];

  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = cx + radiusMeters * Math.cos(a);
    const y = cy + radiusMeters * Math.sin(a);
    coords.push(metersToLonLat(x, y));
  }
  return coords;
}

function buildPillarsFromPoints(pointsGeoJSON, radiusMeters) {
  const out = [];
  const feats = pointsGeoJSON && pointsGeoJSON.features ? pointsGeoJSON.features : [];

  for (let i = 0; i < feats.length; i++) {
    const f = feats[i];
    if (!f || !f.geometry || f.geometry.type !== "Point") continue;

    const coords = circlePolygon(f.geometry.coordinates, radiusMeters, 24);
    out.push({
      type: "Feature",
      id: i,
      properties: {
        seq: i,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        ...(f.properties || {})
      },
      geometry: {
        type: "Polygon",
        coordinates: [coords]
      }
    });
  }

  return { type: "FeatureCollection", features: out };
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function getRobustRange(metricKey) {
  const values = pillarData.features
    .map((feature) => getMetricValue(feature, metricKey))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!values.length) return { min: 0, max: 1, rawMin: 0, rawMax: 1 };

  const rawMin = values[0];
  const rawMax = values[values.length - 1];
  let min = values.length >= 20 ? percentile(values, 0.05) : rawMin;
  let max = values.length >= 20 ? percentile(values, 0.95) : rawMax;

  if (min === max) {
    const padding = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 1;
    min -= padding;
    max += padding;
  }

  return { min, max, rawMin, rawMax };
}

function updateLegend(metricKey, range) {
  const config = METRICS[metricKey];
  legend.title = `${config.label} (${config.unit})`;
  legend.min = formatNumber(range.min, config.decimals);
  legend.max = formatNumber(range.max, config.decimals);
  legend.gradient = `linear-gradient(90deg, ${rainbowStops
    .map(([t, color]) => `${color} ${Math.round(t * 100)}%`)
    .join(", ")})`;

  const clipped = range.min > range.rawMin || range.max < range.rawMax;
  legend.note = clipped
    ? "Color and height use the 5th–95th percentile range; extreme values are visually clipped, but their true values remain in the panel."
    : "Color and height use the full observed range.";
}

function buildColorExpression(metricKey, minValue, maxValue) {
  const colorExpression = [
    "interpolate",
    ["linear"],
    ["get", metricKey],
    ...rainbowStops.flatMap(([t, color]) => [minValue + (maxValue - minValue) * t, color])
  ];

  return [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    "#FFFFFF",
    colorExpression
  ];
}

function buildHeightExpression(metricKey, minValue, maxValue) {
  const targetHeight = [
    "interpolate",
    ["linear"],
    ["get", metricKey],
    minValue,
    MIN_HEIGHT,
    maxValue,
    MAX_HEIGHT
  ];

  return ["case", ["boolean", ["feature-state", "visible"], false], targetHeight, 0];
}

function applyMetricVisualization(metricKey) {
  if (!METRICS[metricKey]) return;
  currentMetric.value = metricKey;
  if (!map || !pillarData || !map.getLayer("pillar-extrusion")) return;

  const range = getRobustRange(metricKey);
  const selectedColor = buildColorExpression(metricKey, range.min, range.max);
  const heightExpression = buildHeightExpression(metricKey, range.min, range.max);

  map.setPaintProperty("pillar-base", "fill-color", selectedColor);
  map.setPaintProperty("pillar-extrusion", "fill-extrusion-color", selectedColor);
  map.setPaintProperty("pillar-extrusion", "fill-extrusion-height", heightExpression);
  updateLegend(metricKey, range);

  if (selectedFeature) updateInfoPanel(selectedFeature);
}

function highlightSelectedPillar(id) {
  if (!map) return;
  if (selectedFeatureId !== null) {
    map.setFeatureState({ source: "pillars", id: selectedFeatureId }, { selected: false });
  }
  selectedFeatureId = id;
  map.setFeatureState({ source: "pillars", id }, { selected: true });
}

function updateInfoPanel(feature) {
  const p = feature.properties || {};
  const config = METRICS[currentMetric.value];
  const metricValue = getMetricValue(feature, currentMetric.value);

  const imageUrl = resolveAssetUrl(
    firstAvailable(p, [
      "image",
      "imageUrl",
      "image_url",
      "streetImage",
      "street_image",
      "photo",
      "photo_url"
    ])
  );
  const spectrogramUrl = resolveAssetUrl(
    firstAvailable(p, ["spectrogram", "spectrogramUrl", "spectrogram_url"], "")
  );
  const eventMark = firstAvailable(
    p,
    ["event_mark", "Mark", "mark"],
    "No recorded event at this time."
  );
  const audioUrl = resolveAssetUrl(
    firstAvailable(p, [
      "audio",
      "audioUrl",
      "audio_url",
      "streetAudio",
      "street_audio",
      "sound",
      "sound_url"
    ])
  );
  const timestamp = firstAvailable(p, ["timestamp", "time"], "");

  const lng = Number(p.lng);
  const lat = Number(p.lat);
  const coordText =
    Number.isFinite(lng) && Number.isFinite(lat)
      ? `${lng.toFixed(5)}, ${lat.toFixed(5)}`
      : "--";

  panel.hasSelection = true;
  panel.title = timestamp ? `Recorded ${timestamp}` : "Selected Record";
  panel.valueLabel = config.label;
  panel.value = formatNumber(metricValue, config.decimals);
  panel.unit = config.unit;
  panel.event = eventMark;
  panel.time = timestamp || "--";
  panel.coord = coordText;

  panel.imageUrl = "";
  panel.imageVisible = false;
  panel.imageEmpty = false;
  if (imageUrl) {
    panel.imageUrl = imageUrl;
  } else {
    panel.imageEmpty = true;
    panel.imageEmptyText = "No corresponding image was found for this timestamp.";
  }

  panel.spectrogramUrl = "";
  panel.spectrogramVisible = false;
  panel.spectrogramEmpty = false;
  if (spectrogramUrl) {
    panel.spectrogramUrl = spectrogramUrl;
  } else {
    panel.spectrogramEmpty = true;
  }

  if (audioUrl) {
    panel.audioUrl = audioUrl;
    panel.audioVisible = true;
  } else {
    panel.audioUrl = "";
    panel.audioVisible = false;
  }
}

function onImageLoad() {
  panel.imageVisible = true;
  panel.imageEmpty = false;
}

function onImageError() {
  panel.imageVisible = false;
  panel.imageEmpty = true;
  panel.imageEmptyText = "No corresponding image was found for this timestamp.";
}

function onSpectrogramLoad() {
  panel.spectrogramVisible = true;
  panel.spectrogramEmpty = false;
}

function onSpectrogramError() {
  panel.spectrogramVisible = false;
  panel.spectrogramEmpty = true;
}

async function loadAndRender() {
  const resp = await fetch(GEOJSON_URL);
  if (!resp.ok) {
    throw new Error(
      `Failed to load biometric demo data (${resp.status}). Expected ${GEOJSON_URL}`
    );
  }

  const points = await resp.json();
  pillarData = buildPillarsFromPoints(points, pillarRadiusMeters);
  const initialRange = getRobustRange(currentMetric.value);
  const initialColor = buildColorExpression(
    currentMetric.value,
    initialRange.min,
    initialRange.max
  );
  const initialHeight = buildHeightExpression(
    currentMetric.value,
    initialRange.min,
    initialRange.max
  );

  updateLegend(currentMetric.value, initialRange);

  map.addSource("pillars", {
    type: "geojson",
    data: pillarData,
    promoteId: "seq"
  });

  map.addLayer({
    id: "pillar-base",
    type: "fill",
    source: "pillars",
    paint: {
      "fill-color": initialColor,
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.42,
        0.18
      ]
    }
  });

  map.addLayer({
    id: "pillar-extrusion",
    type: "fill-extrusion",
    source: "pillars",
    paint: {
      "fill-extrusion-color": initialColor,
      "fill-extrusion-height": initialHeight,
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": extrusionOpacity,
      "fill-extrusion-height-transition": {
        duration: GROW_DURATION,
        delay: 0
      },
      "fill-extrusion-color-transition": {
        duration: 240,
        delay: 0
      }
    }
  });

  map.on("mousemove", "pillar-extrusion", (event) => {
    map.getCanvas().style.cursor = event.features && event.features.length ? "pointer" : "";
  });

  map.on("mouseleave", "pillar-extrusion", () => {
    map.getCanvas().style.cursor = "";
  });

  map.on("click", "pillar-extrusion", (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    selectedFeature = feature;
    highlightSelectedPillar(feature.id);
    updateInfoPanel(feature);
  });

  const layers = map.getStyle().layers || [];
  let labelLayerId = null;
  for (const layer of layers) {
    if (layer.type === "symbol" && layer.layout && layer.layout["text-field"]) {
      labelLayerId = layer.id;
      break;
    }
  }

  if (!map.getLayer("3d-buildings")) {
    map.addLayer(
      {
        id: "3d-buildings",
        source: "composite",
        "source-layer": "building",
        filter: ["==", "extrude", "true"],
        type: "fill-extrusion",
        minzoom: 15,
        paint: {
          "fill-extrusion-height": ["coalesce", ["get", "height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
          "fill-extrusion-opacity": 0.75
        }
      },
      labelLayerId
    );
  }

  for (const feature of pillarData.features) {
    map.setFeatureState(
      { source: "pillars", id: feature.properties.seq },
      { visible: false, selected: false }
    );
  }

  let index = 0;
  growTimer = setInterval(() => {
    if (!map || !pillarData) {
      clearInterval(growTimer);
      growTimer = null;
      return;
    }
    const end = Math.min(index + BATCH_SIZE, pillarData.features.length);
    for (let i = index; i < end; i++) {
      const feature = pillarData.features[i];
      map.setFeatureState({ source: "pillars", id: feature.properties.seq }, { visible: true });
    }
    index = end;
    if (index >= pillarData.features.length) {
      clearInterval(growTimer);
      growTimer = null;
    }
  }, STEP_DELAY);
}

function initMap() {
  if (!mapboxToken || !mapEl.value) return;

  mapboxgl.accessToken = mapboxToken;
  map = new mapboxgl.Map({
    container: mapEl.value,
    style: "mapbox://styles/mapbox/light-v11",
    center: initialView.center,
    zoom: initialView.zoom,
    pitch: initialView.pitch,
    bearing: initialView.bearing,
    antialias: true
  });

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");

  map.on("load", () => {
    loadAndRender().catch((error) => {
      console.error(error);
      loadError.value = error.message || String(error);
    });
  });
}

onMounted(async () => {
  await nextTick();
  initMap();
});

onUnmounted(() => {
  if (growTimer) {
    clearInterval(growTimer);
    growTimer = null;
  }
  if (map) {
    map.remove();
    map = null;
  }
  pillarData = null;
  selectedFeatureId = null;
  selectedFeature = null;
});
</script>

<template>
  <section class="biometric-demo">
    <div v-if="!mapboxToken" class="map-fallback">
      <p>Set <code>VITE_MAPBOX_TOKEN</code> to load the biometric demo map.</p>
    </div>

    <template v-else>
      <div class="demo-title">
        <h1>Biometric Live Tracking</h1>
        <h3>Select a physiological metric, then click a pillar to inspect its recorded data.</h3>
      </div>

      <div ref="mapEl" class="map" />

      <div v-if="loadError" class="load-error">{{ loadError }}</div>

      <div class="legend">
        <div class="metric-control">
          <label for="metric-select">Visualized physiological data</label>
          <select
            id="metric-select"
            class="metric-select"
            :value="currentMetric"
            @change="applyMetricVisualization(($event.target).value)"
          >
            <optgroup v-for="group in METRIC_GROUPS" :key="group.label" :label="group.label">
              <option v-for="key in group.options" :key="key" :value="key">
                {{ METRICS[key].label }}
              </option>
            </optgroup>
          </select>
        </div>
        <div class="legend-title">{{ legend.title }}</div>
        <div class="legend-scale-row">
          <div class="legend-scale-label">{{ legend.min }}</div>
          <div class="legend-gradient" :style="{ background: legend.gradient }" />
          <div class="legend-scale-label">{{ legend.max }}</div>
        </div>
        <div class="legend-range-note">{{ legend.note }}</div>
        <div class="note">Tip: changing the selector updates every pillar. Click a pillar to highlight it.</div>
      </div>

      <aside class="info-panel">
        <div class="panel-kicker">Selected Record</div>
        <h2 class="panel-title">{{ panel.title }}</h2>
        <p v-if="!panel.hasSelection" class="panel-empty">
          Please click one 3D pillar on the map. The selected physiological value, recorded event,
          timestamp-matched image, time, and coordinate will be shown here.
        </p>

        <div v-else class="panel-content">
          <div class="value-card">
            <div>
              <div class="value-label">{{ panel.valueLabel }}</div>
              <div class="value-number">{{ panel.value }}</div>
            </div>
            <div class="value-label">{{ panel.unit }}</div>
          </div>

          <div class="media-label">Street View Image</div>
          <img
            v-show="panel.imageVisible"
            class="street-image"
            :src="panel.imageUrl || undefined"
            alt="Selected street view image"
            @load="onImageLoad"
            @error="onImageError"
          />
          <div v-show="panel.imageEmpty" class="no-media">{{ panel.imageEmptyText }}</div>

          <div class="media-label">Spectrogram</div>
          <img
            v-show="panel.spectrogramVisible"
            class="street-image"
            :src="panel.spectrogramUrl || undefined"
            alt="Selected audio spectrogram"
            @load="onSpectrogramLoad"
            @error="onSpectrogramError"
          />
          <div v-show="panel.spectrogramEmpty" class="no-media">
            No corresponding spectrogram was found for this timestamp.
          </div>

          <div class="media-label">Recorded Event</div>
          <p class="event-box">{{ panel.event }}</p>

          <div v-if="panel.audioVisible" class="audio-section">
            <div class="media-label">Street Audio</div>
            <audio class="street-audio" :src="panel.audioUrl" controls />
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              Time
              <b>{{ panel.time }}</b>
            </div>
            <div class="meta-item">
              Coordinate
              <b>{{ panel.coord }}</b>
            </div>
          </div>
        </div>
      </aside>
    </template>
  </section>
</template>

<style scoped>
.biometric-demo {
  position: relative;
  width: 100%;
  height: calc(100vh - 58px);
  overflow: hidden;
  background: #0b0f18;
  font-family: Arial, Helvetica, sans-serif;
}

.map {
  width: 100%;
  height: 100%;
}

.map-fallback,
.load-error {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: 24px;
  color: rgba(245, 245, 250, 0.9);
  background: #0b0f18;
  text-align: center;
}

.load-error {
  inset: auto 24px 24px 24px;
  height: auto;
  place-items: start;
  background: rgba(120, 20, 20, 0.88);
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 13px;
}

.demo-title {
  position: absolute;
  top: 25px;
  left: 25px;
  z-index: 2;
  pointer-events: none;
}

.demo-title h1 {
  font-size: 28px;
  margin: 0;
  color: #111827;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.65);
}

.demo-title h3 {
  font-size: 15px;
  font-weight: normal;
  margin-top: 5px;
  color: #1f2937;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
}

.legend {
  position: absolute;
  left: 20px;
  bottom: 40px;
  z-index: 2;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 14px 16px;
  color: rgba(230, 230, 240, 0.94);
  font-size: 14px;
  line-height: 1.45;
  min-width: 240px;
  user-select: none;
}

.legend-title {
  font-size: 16px;
  margin-bottom: 10px;
}

.note {
  margin-top: 10px;
  opacity: 0.78;
  font-size: 12px;
}

.info-panel {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 3;
  width: 340px;
  max-height: calc(100% - 48px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 18px;
  color: rgba(245, 245, 250, 0.96);
  background: rgba(10, 14, 24, 0.78);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 18px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}

.panel-kicker {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(220, 220, 235, 0.62);
  margin-bottom: 8px;
}

.panel-title {
  font-size: 22px;
  line-height: 1.2;
  margin: 0 0 12px 0;
  color: #ffffff;
}

.panel-empty {
  color: rgba(240, 240, 250, 0.72);
  line-height: 1.55;
  font-size: 14px;
  margin-top: 8px;
}

.value-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 12px 14px;
  margin: 12px 0 14px 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.value-label {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.65);
}

.value-number {
  font-size: 30px;
  font-weight: 700;
  color: #ffffff;
}

.media-label {
  margin: 16px 0 8px 0;
  font-size: 13px;
  color: rgba(235, 235, 245, 0.72);
}

.street-image {
  display: block;
  width: 100%;
  height: 190px;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
}

.no-media {
  padding: 18px 14px;
  border-radius: 14px;
  color: rgba(235, 235, 245, 0.55);
  background: rgba(255, 255, 255, 0.06);
  border: 1px dashed rgba(255, 255, 255, 0.18);
  font-size: 13px;
  line-height: 1.45;
}

.street-audio {
  display: block;
  width: 100%;
  margin-top: 4px;
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 14px;
}

.meta-item {
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: rgba(235, 235, 245, 0.72);
  overflow-wrap: anywhere;
}

.meta-item b {
  display: block;
  color: rgba(255, 255, 255, 0.94);
  font-size: 13px;
  margin-top: 4px;
  font-weight: 600;
}

.metric-control {
  margin-bottom: 14px;
}

.metric-control label {
  display: block;
  margin-bottom: 7px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(230, 230, 240, 0.66);
}

.metric-select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 34px 10px 11px;
  color: rgba(250, 250, 255, 0.96);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  outline: none;
  font-size: 13px;
  cursor: pointer;
}

.metric-select option,
.metric-select optgroup {
  color: #111827;
  background: #ffffff;
}

.legend-scale-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 7px 0 8px 0;
}

.legend-scale-label {
  min-width: 42px;
  font-size: 12px;
  opacity: 0.9;
}

.legend-scale-label:last-child {
  text-align: right;
}

.legend-gradient {
  height: 10px;
  flex: 1 1 auto;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.legend-range-note {
  opacity: 0.72;
  font-size: 11px;
  line-height: 1.45;
}

.event-box {
  margin: 0;
  padding: 14px;
  border-radius: 14px;
  color: rgba(245, 245, 250, 0.92);
  background: rgba(255, 255, 255, 0.07);
  border-left: 3px solid rgba(77, 208, 225, 0.75);
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

@media (max-width: 760px) {
  .info-panel {
    top: auto;
    right: 12px;
    left: 12px;
    bottom: 20px;
    width: auto;
    max-height: 45vh;
  }

  .legend {
    display: none;
  }
}
</style>

<style>
.biometric-demo .mapboxgl-ctrl-bottom-right {
  right: 12px;
  bottom: 12px;
}
</style>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { colorForSegmentOrder } from "../../lib/segmentColors";

const props = defineProps({
  segments: { type: Array, default: () => [] },
  activeSegmentId: { type: String, default: null },
  hoverSegmentId: { type: String, default: null },
  activePointId: { type: String, default: null }
});

const emit = defineEmits(["hover", "select", "select-point", "leave"]);

const mapEl = ref(null);
const is3dView = ref(false);
let map = null;
let resizeObserver = null;
let routeMarkers = [];
let photoHitMarkers = [];

const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

const geojson = computed(() => ({
  type: "FeatureCollection",
  features: props.segments.map((seg, i) => ({
    type: "Feature",
    properties: {
      id: seg.id,
      label: seg.label,
      order: seg.order ?? i,
      color: seg.color || colorForSegmentOrder(seg.order ?? i)
    },
    geometry: {
      type: "LineString",
      coordinates: seg.geometry.map((p) => [p.lng, p.lat])
    }
  }))
}));

const photoPointGeojson = computed(() => ({
  type: "FeatureCollection",
  features: props.segments.flatMap((segment, segmentIndex) =>
    (segment.samplePoints || [])
      .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
      .map((point) => ({
        type: "Feature",
        properties: {
          id: point.id,
          label: point.label || "Street view",
          segmentId: segment.id,
          color: segment.color || colorForSegmentOrder(segment.order ?? segmentIndex)
        },
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat]
        }
      }))
  )
}));

function fitBounds() {
  if (!map || !props.segments.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  props.segments.forEach((seg) => {
    seg.geometry.forEach((p) => bounds.extend([p.lng, p.lat]));
  });
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: 104,
      maxZoom: 16,
      duration: 0,
      pitch: is3dView.value ? 52 : 0,
      bearing: is3dView.value ? -24 : 0
    });
  }
}

function clearRouteMarkers() {
  routeMarkers.forEach((marker) => marker.remove());
  routeMarkers = [];
}

function clearPhotoHitMarkers() {
  photoHitMarkers.forEach((marker) => marker.remove());
  photoHitMarkers = [];
}

function createFlagMarker(kind, point) {
  const element = document.createElement("div");
  const label = kind === "start" ? "Start" : "End";
  element.className = `route-flag-marker ${kind}`;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `Route ${label.toLowerCase()}`);
  element.innerHTML = `
    <span class="route-flag-symbol" aria-hidden="true">⚑</span>
    <span class="route-flag-label">${label}</span>
    <span class="route-flag-leader" aria-hidden="true"></span>
    <span class="route-flag-anchor" aria-hidden="true"></span>
  `;

  const marker = new mapboxgl.Marker({
    element,
    anchor: "center"
  })
    .setLngLat([point.lng, point.lat])
    .addTo(map);

  return marker;
}

function syncRouteMarkers() {
  clearRouteMarkers();
  if (!map || !props.segments.length) return;

  const start = props.segments[0]?.geometry?.[0];
  const lastSegment = props.segments[props.segments.length - 1];
  const end = lastSegment?.geometry?.[lastSegment.geometry.length - 1];
  if (!start || !end) return;

  routeMarkers = [
    createFlagMarker("start", start),
    createFlagMarker("end", end)
  ];
}

function syncPhotoHitMarkers() {
  clearPhotoHitMarkers();
  if (!map) return;

  props.segments.forEach((segment) => {
    (segment.samplePoints || []).forEach((point) => {
      if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return;

      const element = document.createElement("button");
      element.type = "button";
      element.className = "photo-point-hit-marker";
      element.setAttribute(
        "aria-label",
        `Select ${point.label || "street view"} on ${segment.label}`
      );
      element.title = point.label || "Street view";
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        emit("select-point", { pointId: point.id, segmentId: segment.id });
      });

      photoHitMarkers.push(
        new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([point.lng, point.lat])
          .addTo(map)
      );
    });
  });
}

function setData() {
  if (!map) return;
  map.getSource("segments")?.setData(geojson.value);
  map.getSource("photo-points")?.setData(photoPointGeojson.value);
  paintState();
  paintPhotoPoints();
  syncRouteMarkers();
  syncPhotoHitMarkers();
  fitBounds();
}

function paintState() {
  if (!map?.getLayer("segments-line")) return;
  // Color comes from each feature's `color` property (one hue per segment).
  map.setPaintProperty("segments-line", "line-color", ["get", "color"]);
  map.setPaintProperty("segments-line", "line-width", [
    "case",
    ["==", ["get", "id"], props.activeSegmentId || ""],
    7.5,
    ["==", ["get", "id"], props.hoverSegmentId || ""],
    6,
    5
  ]);
  map.setPaintProperty("segments-line", "line-opacity", [
    "case",
    ["==", ["get", "id"], props.activeSegmentId || ""],
    1,
    ["==", ["get", "id"], props.hoverSegmentId || ""],
    0.72,
    0.5
  ]);

  if (map.getLayer("segments-glow")) {
    map.setPaintProperty("segments-glow", "line-color", ["get", "color"]);
    map.setPaintProperty("segments-glow", "line-width", [
      "case",
      ["==", ["get", "id"], props.activeSegmentId || ""],
      20,
      ["==", ["get", "id"], props.hoverSegmentId || ""],
      12,
      0
    ]);
    map.setPaintProperty("segments-glow", "line-opacity", [
      "case",
      ["==", ["get", "id"], props.activeSegmentId || ""],
      0.82,
      ["==", ["get", "id"], props.hoverSegmentId || ""],
      0.28,
      0
    ]);
  }
}

function paintPhotoPoints() {
  if (!map?.getLayer("photo-points")) return;

  const pointMatch = ["==", ["get", "id"], props.activePointId || ""];
  const segmentMatch = ["==", ["get", "segmentId"], props.activeSegmentId || ""];
  const hasActiveSegment = Boolean(props.activeSegmentId);

  map.setPaintProperty("photo-points", "circle-radius", [
    "case",
    pointMatch,
    7,
    4.5
  ]);
  map.setPaintProperty("photo-points", "circle-stroke-width", [
    "case",
    pointMatch,
    3,
    2
  ]);
  map.setPaintProperty("photo-points", "circle-opacity", hasActiveSegment
    ? ["case", segmentMatch, 1, 0.5]
    : 0.88);
  map.setPaintProperty("photo-points", "circle-stroke-opacity", hasActiveSegment
    ? ["case", segmentMatch, 1, 0.62]
    : 0.92);

  if (map.getLayer("photo-points-glow")) {
    map.setPaintProperty("photo-points-glow", "circle-radius", [
      "case",
      pointMatch,
      14,
      8
    ]);
    map.setPaintProperty("photo-points-glow", "circle-opacity", [
      "case",
      pointMatch,
      0.34,
      hasActiveSegment ? ["case", segmentMatch, 0.14, 0.05] : 0.09
    ]);
  }
}

function lightenRoads() {
  if (!map) return;
  const layers = map.getStyle()?.layers || [];

  layers.forEach((layer) => {
    if (
      layer.type !== "line" ||
      !/(road|street|bridge|tunnel)/i.test(layer.id)
    ) {
      return;
    }

    const isCasing = /(case|casing|outline)/i.test(layer.id);
    map.setPaintProperty(
      layer.id,
      "line-color",
      isCasing ? "#737373" : "#b8b6b2"
    );
    map.setPaintProperty(layer.id, "line-opacity", isCasing ? 0.68 : 0.8);
  });
}

function tintWater() {
  if (!map) return;
  const layers = map.getStyle()?.layers || [];

  layers.forEach((layer) => {
    if (!/water/i.test(layer.id)) return;

    if (layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-color", "#79c7e3");
      map.setPaintProperty(layer.id, "fill-opacity", 0.48);
    }

    if (layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", "#a5d8eb");
      map.setPaintProperty(layer.id, "line-opacity", 0.65);
    }
  });
}

function tintGreenSpaces() {
  if (!map) return;
  const layers = map.getStyle()?.layers || [];

  layers.forEach((layer) => {
    if (!/(park|grass|green|wood|forest)/i.test(layer.id)) return;

    if (layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-color", "#9caf88");
      map.setPaintProperty(layer.id, "fill-opacity", 0.22);
    }

    if (layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", "#b8c9a8");
      map.setPaintProperty(layer.id, "line-opacity", 0.32);
    }
  });

  const firstSymbolLayer = layers.find((layer) => layer.type === "symbol")?.id;
  if (map.getSource("composite") && !map.getLayer("green-spaces-tint")) {
    const greenSpaceTypes = [
      "park",
      "grass",
      "pitch",
      "garden",
      "playground",
      "recreation_ground",
      "wood",
      "forest",
      "scrub"
    ];

    map.addLayer(
      {
        id: "green-spaces-tint",
        type: "fill",
        source: "composite",
        "source-layer": "landuse",
        filter: [
          "any",
          ["match", ["get", "class"], greenSpaceTypes, true, false],
          ["match", ["get", "type"], greenSpaceTypes, true, false]
        ],
        paint: {
          "fill-color": "#9caf88",
          "fill-opacity": 0.24
        }
      },
      firstSymbolLayer
    );
  }
}

function addSemiTransparentBuildings() {
  if (!map?.getSource("composite") || map.getLayer("route-3d-buildings")) return;

  const layers = map.getStyle()?.layers || [];
  const labelLayerId = layers.find(
    (layer) => layer.type === "symbol" && layer.layout?.["text-field"]
  )?.id;

  map.addLayer(
    {
      id: "route-3d-buildings",
      source: "composite",
      "source-layer": "building",
      filter: ["==", "extrude", "true"],
      type: "fill-extrusion",
      minzoom: 15,
      layout: {
        visibility: is3dView.value ? "visible" : "none"
      },
      paint: {
        "fill-extrusion-color": "#dbe3ea",
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          15.05,
          ["coalesce", ["get", "height"], 8]
        ],
        "fill-extrusion-base": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          15.05,
          ["coalesce", ["get", "min_height"], 0]
        ],
        "fill-extrusion-opacity": 0.42,
        "fill-extrusion-vertical-gradient": true
      }
    },
    labelLayerId
  );
}

function togglePerspective() {
  if (!map) return;
  is3dView.value = !is3dView.value;
  if (map.getLayer("route-3d-buildings")) {
    map.setLayoutProperty(
      "route-3d-buildings",
      "visibility",
      is3dView.value ? "visible" : "none"
    );
  }
  map.easeTo({
    pitch: is3dView.value ? 52 : 0,
    bearing: is3dView.value ? -24 : 0,
    duration: 650,
    essential: true
  });
}

function initMap() {
  if (!mapEl.value || map) return;
  if (!mapboxToken) return;

  mapboxgl.accessToken = mapboxToken;
  const first = props.segments[0]?.geometry?.[0];
  map = new mapboxgl.Map({
    container: mapEl.value,
    style: "mapbox://styles/mapbox/dark-v11",
    center: first ? [first.lng, first.lat] : [-87.625, 41.875],
    zoom: 14,
    antialias: true,
    attributionControl: true
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    tintWater();
    tintGreenSpaces();
    lightenRoads();
    addSemiTransparentBuildings();
    map.addSource("segments", {
      type: "geojson",
      data: geojson.value
    });
    map.addLayer({
      id: "segments-hit",
      type: "line",
      source: "segments",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#000",
        "line-width": 18,
        "line-opacity": 0
      }
    });
    map.addLayer({
      id: "segments-glow",
      type: "line",
      source: "segments",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 0,
        "line-opacity": 0,
        "line-blur": 6
      }
    });
    map.addLayer({
      id: "segments-line",
      type: "line",
      source: "segments",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 5,
        "line-opacity": 0.5
      }
    });
    map.addSource("photo-points", {
      type: "geojson",
      data: photoPointGeojson.value
    });
    map.addLayer({
      id: "photo-points-glow",
      type: "circle",
      source: "photo-points",
      paint: {
        "circle-radius": 8,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.09,
        "circle-blur": 0.35
      }
    });
    map.addLayer({
      id: "photo-points",
      type: "circle",
      source: "photo-points",
      paint: {
        "circle-radius": 4.5,
        "circle-color": "#f8fafc",
        "circle-opacity": 0.88,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.92
      }
    });
    paintState();
    paintPhotoPoints();
    syncRouteMarkers();
    syncPhotoHitMarkers();
    fitBounds();

    map.on("mouseenter", "photo-points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "photo-points", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mousemove", "segments-hit", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) {
        map.getCanvas().style.cursor = "pointer";
        emit("hover", id);
      }
    });
    map.on("mouseleave", "segments-hit", () => {
      map.getCanvas().style.cursor = "";
      emit("leave");
    });
    map.on("click", (e) => {
      const photoFeature = map.queryRenderedFeatures(e.point, {
        layers: ["photo-points"]
      })[0];
      if (photoFeature) {
        const pointId = photoFeature.properties?.id;
        const segmentId = photoFeature.properties?.segmentId;
        if (pointId && segmentId) {
          emit("select-point", { pointId, segmentId });
        }
        return;
      }

      const segmentFeature = map.queryRenderedFeatures(e.point, {
        layers: ["segments-hit"]
      })[0];
      const id = segmentFeature?.properties?.id;
      if (id) emit("select", id);
    });
  });

  resizeObserver = new ResizeObserver(() => {
    if (!map) return;
    map.resize();
    if (map.getSource("segments")) fitBounds();
  });
  resizeObserver.observe(mapEl.value);
}

onMounted(() => {
  initMap();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  clearRouteMarkers();
  clearPhotoHitMarkers();
  map?.remove();
  map = null;
});

watch(() => props.segments, setData, { deep: true });
watch(() => [props.activeSegmentId, props.hoverSegmentId], paintState);
watch(() => [props.activeSegmentId, props.activePointId], paintPhotoPoints);
</script>

<template>
  <div class="segment-map">
    <div class="map-guide">
      <span>Route map</span>
      <small>Select a coloured path to review that segment</small>
    </div>
    <label
      v-if="mapboxToken"
      class="view-switch switch"
      :title="is3dView ? 'Switch to 2D view' : 'Switch to 3D view'"
    >
      <span class="sr-only">Map perspective</span>
      <input
        class="cb"
        type="checkbox"
        :checked="is3dView"
        role="switch"
        :aria-checked="is3dView"
        aria-label="Toggle between 2D and 3D map views"
        @change="togglePerspective"
      />
      <span class="toggle" aria-hidden="true">
        <span class="left">2D</span>
        <span class="right">3D</span>
      </span>
    </label>
    <div v-if="!mapboxToken" class="map-fallback">
      <p>Set <code>VITE_MAPBOX_TOKEN</code> to load the Mapbox map.</p>
      <ul class="fallback-list">
        <li
          v-for="(seg, i) in segments"
          :key="seg.id"
          :class="{
            active: seg.id === activeSegmentId,
            hover: seg.id === hoverSegmentId
          }"
          :style="{
            borderColor: seg.color || colorForSegmentOrder(seg.order ?? i),
            boxShadow:
              seg.id === activeSegmentId
                ? `0 0 0 1px ${seg.color || colorForSegmentOrder(seg.order ?? i)}`
                : undefined
          }"
          @mouseenter="$emit('hover', seg.id)"
          @mouseleave="$emit('leave')"
          @click="$emit('select', seg.id)"
        >
          <span
            class="swatch"
            :style="{ background: seg.color || colorForSegmentOrder(seg.order ?? i) }"
          />
          {{ seg.label }}
        </li>
      </ul>
    </div>
    <div v-else ref="mapEl" class="map-canvas" />
  </div>
</template>

<style scoped>
.segment-map {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #0a0e14;
  border-radius: 0;
  overflow: hidden;
}

.map-guide {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 2;
  display: grid;
  gap: 2px;
  max-width: calc(100% - 90px);
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 10px;
  background: rgba(7, 9, 13, 0.82);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px);
  pointer-events: none !important;
}

.map-guide span {
  color: var(--ink);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.map-guide small {
  color: var(--muted);
  font-size: 11px;
}

.view-switch.switch {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 4;
}

.switch {
  position: relative;
  display: inline-block;
  width: 5em;
  height: 2.5em;
  font-size: 13px;
  user-select: none;
}

.switch .cb {
  position: absolute;
  z-index: 2;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.toggle {
  position: absolute;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 0.1em;
  background-color: #373737;
  box-shadow:
    -0.3em 0 0 0 #373737,
    -0.3em 0.3em 0 0 #373737,
    0.3em 0 0 0 #373737,
    0.3em 0.3em 0 0 #373737,
    0 0.3em 0 0 #373737,
    0 8px 22px rgba(0, 0, 0, 0.32);
  cursor: pointer;
  font-weight: 700;
  text-transform: uppercase;
  transition: 0.4s;
}

.toggle > .left {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  width: 50%;
  height: 88%;
  align-items: center;
  justify-content: center;
  color: #373737;
  background-color: #f3f3f3;
  transform: rotateX(10deg);
  transform-origin: right;
  transform-style: preserve-3d;
  transition: all 150ms;
}

.left::before {
  position: absolute;
  width: 100%;
  height: 100%;
  content: "";
  background-color: rgb(206, 206, 206);
  transform: rotateY(90deg);
  transform-origin: center left;
}

.left::after {
  position: absolute;
  width: 100%;
  height: 100%;
  content: "";
  background-color: rgb(112, 112, 112);
  transform: rotateX(90deg);
  transform-origin: center bottom;
}

.toggle > .right {
  position: absolute;
  right: 1px;
  bottom: 0;
  display: flex;
  width: 50%;
  height: 88%;
  align-items: center;
  justify-content: center;
  color: rgb(206, 206, 206);
  background-color: #f3f3f3;
  transform: rotateX(10deg) rotateY(-45deg);
  transform-origin: left;
  transform-style: preserve-3d;
  transition: all 150ms;
}

.right::before {
  position: absolute;
  width: 100%;
  height: 100%;
  content: "";
  background-color: rgb(206, 206, 206);
  transform: rotateY(-90deg);
  transform-origin: center right;
}

.right::after {
  position: absolute;
  width: 100%;
  height: 100%;
  content: "";
  background-color: rgb(112, 112, 112);
  transform: rotateX(90deg);
  transform-origin: center bottom;
}

.switch input:checked + .toggle > .left {
  color: rgb(206, 206, 206);
  transform: rotateX(10deg) rotateY(45deg);
}

.switch input:checked + .toggle > .right {
  color: #487bdb;
  transform: rotateX(10deg) rotateY(0deg);
}

.switch input:focus-visible + .toggle {
  outline: 3px solid rgba(34, 211, 238, 0.82);
  outline-offset: 3px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.map-canvas {
  width: 100%;
  height: 100%;
}

:global(.segment-map .mapboxgl-ctrl-top-right) {
  top: 62px;
  right: 4px;
}

:global(.photo-point-hit-marker) {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

:global(.photo-point-hit-marker:focus-visible) {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

:global(.route-flag-marker) {
  --flag-color: #4ade80;
  position: relative;
  width: 10px;
  height: 10px;
  color: var(--flag-color);
  filter: drop-shadow(0 5px 8px rgba(0, 0, 0, 0.55));
  transform-origin: center;
  pointer-events: none;
}

:global(.route-flag-marker.end) {
  --flag-color: #fb7185;
}

:global(.route-flag-symbol) {
  position: absolute;
  bottom: 63px;
  left: 50%;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 2px solid currentColor;
  border-radius: 11px;
  background: rgba(7, 9, 13, 0.92);
  box-shadow:
    0 0 0 3px color-mix(in srgb, currentColor 20%, transparent),
    0 8px 20px rgba(0, 0, 0, 0.35);
  font-family: Arial, sans-serif;
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
  transform: translateX(-50%);
}

:global(.route-flag-label) {
  position: absolute;
  bottom: 39px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 9, 13, 0.9);
  font-family: var(--sans);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.9px;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
}

:global(.route-flag-leader) {
  position: absolute;
  bottom: 9px;
  left: 50%;
  height: 27px;
  border-left: 2px dashed currentColor;
  opacity: 0.9;
  transform: translateX(-1px);
}

:global(.route-flag-anchor) {
  position: absolute;
  inset: 0;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(7, 9, 13, 0.95);
  border-radius: 50%;
  background: currentColor;
  box-shadow:
    0 0 0 2px color-mix(in srgb, currentColor 30%, transparent),
    0 2px 7px rgba(0, 0, 0, 0.45);
}

.map-fallback {
  padding: 78px 20px 20px;
  color: var(--muted);
}

.map-fallback code {
  color: var(--accent);
  font-family: var(--mono);
  font-size: 12px;
}

.fallback-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.fallback-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  color: var(--ink);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.fallback-list li.hover,
.fallback-list li.active {
  background: rgba(255, 255, 255, 0.04);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
</style>

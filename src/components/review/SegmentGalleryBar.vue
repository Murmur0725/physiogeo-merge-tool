<script setup>
import { computed, nextTick, watch } from "vue";

const props = defineProps({
  points: { type: Array, default: () => [] },
  activePointId: { type: String, default: null },
  segmentLabel: { type: String, default: "" },
  empty: { type: Boolean, default: false }
});

const emit = defineEmits(["open"]);
const thumbElements = new Map();

const mapillaryToken = import.meta.env.VITE_MAPILLARY_TOKEN || "";

function resolveAssetUrl(value) {
  if (!value || /^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
  return `${import.meta.env.BASE_URL}${value.replace(/^\.\//, "")}`;
}

function thumbUrl(point) {
  if (point.thumbUrl) return resolveAssetUrl(point.thumbUrl);
  if (point.mapillaryImageId && mapillaryToken) {
    return `https://graph.mapillary.com/${point.mapillaryImageId}/thumb?width=640&access_token=${mapillaryToken}`;
  }
  // Static OSM tile as visual placeholder when no Mapillary id
  const z = 17;
  const n = 2 ** z;
  const x = Math.floor(((point.lng + 180) / 360) * n);
  const latRad = (point.lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

const items = computed(() =>
  props.points.map((p, i) => ({
    ...p,
    displayLabel: p.label || `Point ${i + 1}`,
    src: thumbUrl(p)
  }))
);

function setThumbElement(id, element) {
  if (element) thumbElements.set(id, element);
  else thumbElements.delete(id);
}

watch(
  () => props.activePointId,
  async (pointId) => {
    if (!pointId) return;
    await nextTick();
    thumbElements.get(pointId)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }
);
</script>

<template>
  <div class="gallery-bar">
    <div class="gallery-meta">
      <span class="gallery-kicker">Street views</span>
      <span v-if="!empty && segmentLabel" class="gallery-seg">{{ segmentLabel }}</span>
      <span v-else class="gallery-hint">Select a path segment on the map</span>
    </div>
    <div v-if="empty || !items.length" class="gallery-empty">
      <span class="ghost-slot" /><span class="ghost-slot" /><span class="ghost-slot" />
    </div>
    <div v-else class="gallery-scroll" role="list">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="gallery-thumb"
        :class="{ active: item.id === activePointId }"
        :ref="(element) => setThumbElement(item.id, element)"
        role="listitem"
        :aria-current="item.id === activePointId ? 'true' : undefined"
        :title="item.displayLabel"
        @click="emit('open', item.id)"
      >
        <img :src="item.src" :alt="item.displayLabel" loading="lazy" />
        <span class="thumb-cap">{{ item.displayLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.gallery-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  box-sizing: border-box;
  padding: 14px 18px 16px;
  border-bottom: 0;
  background: transparent;
}

.gallery-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-height: 18px;
  flex: none;
}

.gallery-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--accent);
}

.gallery-seg {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ink);
}

.gallery-hint {
  font-size: 13px;
  color: var(--faint);
}

.gallery-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  min-height: 0;
  align-items: flex-start;
  padding: 5px 12px 9px;
  scroll-padding-inline: 12px;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.28) transparent;
}

.gallery-scroll::-webkit-scrollbar {
  height: 4px;
}

.gallery-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.gallery-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
}

.gallery-scroll:hover::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.46);
}

.gallery-thumb {
  position: relative;
  flex: 0 0 auto;
  width: min(240px, 36vw);
  height: auto;
  min-height: 0;
  max-height: none;
  aspect-ratio: 4 / 3;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: #111;
  opacity: 0.82;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  scroll-snap-align: start;
  transition:
    opacity 0.18s,
    border-color 0.18s,
    transform 0.22s ease,
    box-shadow 0.22s ease;
}

.gallery-thumb:hover {
  opacity: 1;
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.gallery-thumb.active {
  z-index: 1;
  opacity: 1;
  border-color: var(--accent);
  transform: scale(1.06);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
    0 14px 32px rgba(0, 0, 0, 0.32);
}

.gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 22px 10px 7px;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
  text-align: left;
}

.gallery-empty {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}

.ghost-slot {
  width: min(240px, 36vw);
  min-height: 150px;
  max-height: 220px;
  height: 100%;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--line);
}
</style>

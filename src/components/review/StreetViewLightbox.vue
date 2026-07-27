<script setup>
import { computed, onMounted, onUnmounted, watch } from "vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  points: { type: Array, default: () => [] },
  currentId: { type: String, default: null }
});

const emit = defineEmits(["close", "navigate"]);

const mapillaryToken = import.meta.env.VITE_MAPILLARY_TOKEN || "";

const index = computed(() =>
  Math.max(
    0,
    props.points.findIndex((p) => p.id === props.currentId)
  )
);

const current = computed(() => props.points[index.value] || null);

const canPrev = computed(() => index.value > 0);
const canNext = computed(() => index.value < props.points.length - 1);

function resolveAssetUrl(value) {
  if (!value || /^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
  return `${import.meta.env.BASE_URL}${value.replace(/^\.\//, "")}`;
}

function thumbUrl(point) {
  if (!point) return "";
  if (point.thumbUrl) return resolveAssetUrl(point.thumbUrl);
  if (point.mapillaryImageId && mapillaryToken) {
    return `https://graph.mapillary.com/${point.mapillaryImageId}/thumb?width=2048&access_token=${mapillaryToken}`;
  }
  const z = 18;
  const n = 2 ** z;
  const x = Math.floor(((point.lng + 180) / 360) * n);
  const latRad = (point.lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

const viewerSrc = computed(() => {
  const p = current.value;
  if (!p) return "";
  if (p.mapillaryImageId && mapillaryToken) {
    return `https://www.mapillary.com/embed?image_key=${p.mapillaryImageId}&style=photo`;
  }
  return thumbUrl(p);
});

const useEmbed = computed(
  () => Boolean(current.value?.mapillaryImageId && mapillaryToken)
);
const isFieldPhoto = computed(
  () => Boolean(current.value?.thumbUrl && !current.value?.mapillaryImageId)
);

function prev() {
  if (!canPrev.value) return;
  emit("navigate", props.points[index.value - 1].id);
}

function next() {
  if (!canNext.value) return;
  emit("navigate", props.points[index.value + 1].id);
}

function onKey(e) {
  if (!props.open) return;
  if (e.key === "Escape") emit("close");
  if (e.key === "ArrowLeft") prev();
  if (e.key === "ArrowRight") next();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

watch(
  () => props.open,
  (v) => {
    document.body.style.overflow = v ? "hidden" : "";
  }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open && current" class="lightbox" role="dialog" aria-modal="true">
      <button type="button" class="lb-backdrop" aria-label="Close" @click="emit('close')" />
      <div class="lb-panel">
        <header class="lb-head">
          <div>
            <strong>{{ current.label || `Point ${index + 1}` }}</strong>
            <span class="lb-coord">
              {{ current.lat.toFixed(5) }}, {{ current.lng.toFixed(5) }}
            </span>
          </div>
          <button type="button" class="lb-close" @click="emit('close')">✕</button>
        </header>
        <div class="lb-stage">
          <button
            type="button"
            class="lb-nav prev"
            :disabled="!canPrev"
            @click="prev"
          >
            ‹
          </button>
          <iframe
            v-if="useEmbed"
            class="lb-frame"
            :src="viewerSrc"
            title="Mapillary street view"
            allowfullscreen
          />
          <img v-else class="lb-img" :src="viewerSrc" :alt="current.label || 'Street view'" />
          <button
            type="button"
            class="lb-nav next"
            :disabled="!canNext"
            @click="next"
          >
            ›
          </button>
        </div>
        <footer class="lb-foot">
          {{ index + 1 }} / {{ points.length }}
          <span v-if="isFieldPhoto" class="lb-note">
            · Field photo
            <template v-if="current.capturedAt"> · {{ current.capturedAt }}</template>
          </span>
          <span v-else-if="!useEmbed" class="lb-note">
            · Map tile placeholder (set Mapillary token for street view)
          </span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
}

.lb-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.72);
  cursor: pointer;
}

.lb-panel {
  position: relative;
  z-index: 1;
  width: min(960px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: #0c1016;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

.lb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.lb-head strong {
  display: block;
  font-size: 15px;
}

.lb-coord {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
  font-family: var(--mono);
}

.lb-close {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.lb-stage {
  position: relative;
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  min-height: 360px;
  background: #000;
}

.lb-frame,
.lb-img {
  width: 100%;
  height: min(62vh, 520px);
  border: 0;
  object-fit: contain;
  background: #000;
}

.lb-nav {
  height: 100%;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 32px;
  cursor: pointer;
  opacity: 0.7;
}

.lb-nav:disabled {
  opacity: 0.2;
  cursor: default;
}

.lb-nav:not(:disabled):hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.04);
}

.lb-foot {
  padding: 10px 16px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--line);
}

.lb-note {
  color: var(--faint);
}
</style>

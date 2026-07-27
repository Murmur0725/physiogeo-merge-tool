<script setup>
import { computed, reactive, ref, watch } from "vue";
import decodedRoute from "../config/routes/shenzhen-2026-07-17-cd.json";
import { parseRouteConfig } from "../lib/parseRouteConfig";
import { saveReviewSession } from "../lib/reviewArchive";
import {
  buildScores,
  isInstrumentComplete,
  normalizeAnswers
} from "../lib/surveyComplete";
import SegmentMap from "../components/review/SegmentMap.vue";
import SegmentGalleryBar from "../components/review/SegmentGalleryBar.vue";
import StreetViewLightbox from "../components/review/StreetViewLightbox.vue";
import SurveyHost from "../components/surveys/SurveyHost.vue";
import { SURVEY_REGISTRY } from "../components/surveys/registry";
import { withSegmentColors } from "../lib/segmentColors";

const parsed = parseRouteConfig(decodedRoute);

const subjectId = ref("");
const subjectName = ref("");
const instrumentId = ref(parsed.instrumentId);

const hoverSegmentId = ref(null);
const activeSegmentId = ref(null);
const lightboxOpen = ref(false);
const lightboxPointId = ref(null);
const activePointId = ref(null);

/** drafts keyed by segmentId */
const drafts = reactive({});
/** confirmed payload keyed by segmentId: { answers, scores } */
const confirmed = reactive({});

const saveStatus = ref(null);
const saving = ref(false);

const segments = computed(() => withSegmentColors(parsed.segments));
const routeMeta = computed(() => parsed.meta);

const activeSegment = computed(
  () => segments.value.find((s) => s.id === activeSegmentId.value) || null
);

const galleryPoints = computed(() => activeSegment.value?.samplePoints || []);

const completedCount = computed(
  () => segments.value.filter((s) => confirmed[s.id]).length
);

const allSegmentsComplete = computed(
  () =>
    segments.value.length > 0 &&
    segments.value.every((s) => Boolean(confirmed[s.id]))
);

function onHover(id) {
  hoverSegmentId.value = id;
}

function onLeave() {
  hoverSegmentId.value = null;
}

function onSelect(id) {
  activeSegmentId.value = id;
  activePointId.value = null;
  lightboxOpen.value = false;
  if (!drafts[id]) drafts[id] = {};
  saveStatus.value = null;
}

function onSelectPhotoPoint({ segmentId, pointId }) {
  if (!segmentId || !pointId) return;
  activeSegmentId.value = segmentId;
  activePointId.value = pointId;
  lightboxPointId.value = pointId;
  lightboxOpen.value = false;
  if (!drafts[segmentId]) drafts[segmentId] = {};
  saveStatus.value = null;
}

function openLightbox(pointId) {
  activePointId.value = pointId;
  lightboxPointId.value = pointId;
  lightboxOpen.value = true;
}

function navigateLightbox(pointId) {
  activePointId.value = pointId;
  lightboxPointId.value = pointId;
}

watch(activeSegmentId, (id) => {
  if (id && !drafts[id]) drafts[id] = {};
});

watch(instrumentId, () => {
  Object.keys(confirmed).forEach((k) => {
    delete confirmed[k];
  });
  saveStatus.value = null;
});

/** Local confirm for current segment (does not upload yet). */
function onSegmentConfirm(payload) {
  const segId = payload.segmentId || activeSegmentId.value;
  if (!segId) return;
  const answers = payload.answers || drafts[segId] || {};
  if (!isInstrumentComplete(instrumentId.value, answers)) {
    saveStatus.value = { ok: false, message: "Please complete all items for this segment first." };
    return;
  }
  confirmed[segId] = {
    answers: normalizeAnswers(instrumentId.value, answers),
    scores: payload.scores || buildScores(instrumentId.value, answers)
  };
  saveStatus.value = {
    ok: true,
    message: `Confirmed “${activeSegment.value?.label || segId}” (${completedCount.value}/${segments.value.length})`
  };
}

async function submitAll() {
  if (!allSegmentsComplete.value || saving.value) return;
  saving.value = true;
  saveStatus.value = null;
  try {
    const responses = segments.value.map((s) => ({
      segmentId: s.id,
      answers: confirmed[s.id].answers,
      scores: confirmed[s.id].scores
    }));
    const result = await saveReviewSession({
      subjectId: subjectId.value.trim() || "anonymous",
      subjectName: subjectName.value.trim() || "anonymous",
      routeConfigId: routeMeta.value.id,
      routeName: routeMeta.value.name,
      instrumentId: instrumentId.value,
      segments: segments.value,
      responses
    });
    if (result.ok) {
      saveStatus.value = {
        ok: true,
        message: result.skipped
          ? result.reason
          : `All ${result.responseCount} segment surveys submitted (session ${String(result.sessionId).slice(0, 8)}…)`
      };
    } else {
      saveStatus.value = { ok: false, message: result.reason || "Submit failed" };
    }
  } catch (err) {
    saveStatus.value = { ok: false, message: err?.message || String(err) };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="review-page">
    <section class="review-toolbar">
      <div class="route-info">
        <span class="toolbar-kicker">Route review</span>
        <strong>{{ routeMeta.name }}</strong>
      </div>

      <div class="toolbar-fields" aria-label="Review setup">
        <label>
          Instrument
          <select v-model="instrumentId">
            <option v-for="s in SURVEY_REGISTRY" :key="s.id" :value="s.id">
              {{ s.label }}
            </option>
          </select>
        </label>
        <label>
          Subject ID
          <input v-model="subjectId" type="text" placeholder="e.g. 001" autocomplete="off" />
        </label>
        <label>
          Name
          <input v-model="subjectName" type="text" placeholder="e.g. Alex" autocomplete="off" />
        </label>
      </div>

      <div class="archive-block">
        <p v-if="!allSegmentsComplete" class="submit-hint">
          Complete all {{ segments.length }} segments before submitting
        </p>
        <button
          type="button"
          class="btn-submit-all"
          :class="{ ready: allSegmentsComplete }"
          :disabled="!allSegmentsComplete || saving"
          @click="submitAll"
        >
          <span v-if="!allSegmentsComplete" class="button-progress">
            <span>Progress {{ completedCount }} / {{ segments.length }}</span>
            <span class="button-dots" aria-hidden="true">
              <i
              v-for="seg in segments"
              :key="seg.id"
              :class="{
                done: confirmed[seg.id],
                current: seg.id === activeSegmentId
              }"
              :title="seg.label"
              :style="{
                '--seg': seg.color,
                background: confirmed[seg.id]
                  ? seg.color
                  : `color-mix(in srgb, ${seg.color} 35%, transparent)`,
                  borderColor: seg.color
                }"
              />
            </span>
          </span>
          <span v-else>{{ saving ? "Submitting…" : "Submit all segment surveys" }}</span>
        </button>
        <p v-if="saveStatus" class="save-msg" :class="saveStatus.ok ? 'ok' : 'err'">
          {{ saveStatus.message }}
        </p>
      </div>
    </section>

    <div class="review-body">
      <div class="gallery-pane" aria-label="Street view gallery">
        <SegmentGalleryBar
          :empty="!activeSegment"
          :segment-label="activeSegment?.label || ''"
          :points="galleryPoints"
          :active-point-id="activePointId"
          @open="openLightbox"
        />
      </div>

      <div class="map-pane">
        <SegmentMap
          :segments="segments"
          :active-segment-id="activeSegmentId"
          :hover-segment-id="hoverSegmentId"
          :active-point-id="activePointId"
          @hover="onHover"
          @leave="onLeave"
          @select="onSelect"
          @select-point="onSelectPhotoPoint"
        />
      </div>

      <aside class="survey-pane" aria-label="Segment questionnaire">
        <div class="survey-pane-inner">
          <div v-if="!activeSegment" class="survey-empty">
            <span class="empty-step">Step 2</span>
            <p class="empty-title">No segment selected</p>
            <p class="empty-copy">
              Click a path segment on the map to fill its survey. Confirm every segment, then submit above.
            </p>
          </div>
          <SurveyHost
            v-else
            :instrument-id="instrumentId"
            :segment-meta="{
              id: activeSegment.id,
              label: activeSegment.label,
              order: activeSegment.order
            }"
            v-model="drafts[activeSegment.id]"
            @submit="onSegmentConfirm"
          />
        </div>
      </aside>
    </div>

    <StreetViewLightbox
      :open="lightboxOpen"
      :points="galleryPoints"
      :current-id="lightboxPointId"
      @close="lightboxOpen = false"
      @navigate="navigateLightbox"
    />
  </main>
</template>

<style scoped>
.review-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: calc(100dvh - 58px);
  max-height: calc(100dvh - 58px);
  overflow: hidden;
}

.review-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1.15fr) repeat(4, minmax(170px, 1fr));
  align-items: center;
  gap: 18px 28px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(12, 16, 22, 0.92);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  flex: none;
  z-index: 3;
}

.route-info {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.toolbar-kicker {
  color: var(--accent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.35px;
  text-transform: uppercase;
}

.route-info strong {
  font-size: 16px;
  line-height: 1.25;
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

.toolbar-fields {
  display: contents;
}

.toolbar-fields label {
  display: grid;
  gap: 5px;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
}

.toolbar-fields input,
.toolbar-fields select {
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 8px 11px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.34);
  color: var(--ink);
  font: inherit;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.toolbar-fields input:focus,
.toolbar-fields select:focus {
  border-color: rgba(34, 211, 238, 0.7);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
}

.toolbar-fields input::placeholder {
  color: var(--faint);
}

.archive-block {
  display: grid;
  gap: 5px;
  min-width: 0;
  min-height: 58px;
  width: 100%;
  justify-self: stretch;
  align-content: end;
}

.button-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
}

.button-dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.button-dots i {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid var(--line);
  box-sizing: border-box;
}

.button-dots i.done {
  border-color: transparent;
}

.button-dots i.current {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--seg) 55%, transparent);
  transform: scale(1.15);
}

.btn-submit-all {
  width: 100%;
  height: 38px;
  min-height: 38px;
  padding: 9px 14px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.065);
  color: var(--ink);
  font: inherit;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.15s, box-shadow 0.18s, opacity 0.15s;
}

.btn-submit-all:disabled {
  cursor: not-allowed;
  opacity: 1;
  color: var(--muted);
}

.btn-submit-all.ready {
  border-color: transparent;
  background: var(--rainbow);
  color: #041016;
  box-shadow: 0 5px 22px rgba(34, 211, 238, 0.24);
}

.btn-submit-all.ready:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 28px rgba(34, 211, 238, 0.34);
}

.btn-submit-all.ready:disabled {
  cursor: wait;
  opacity: 0.72;
  color: #041016;
}

.submit-hint {
  margin: 0;
  font-size: 10px;
  line-height: 15.5px;
  color: var(--muted);
  text-align: left;
}

.save-msg {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.save-msg.ok {
  color: #4ade80;
}

.save-msg.err {
  color: #f87171;
}

/* Left: visual route context; right: focused questionnaire */
.review-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 520px;
  grid-template-rows: clamp(220px, 27vh, 290px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}

.gallery-pane {
  grid-column: 1;
  grid-row: 1;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: rgba(148, 163, 184, 0.055);
}

.map-pane {
  grid-column: 1;
  grid-row: 2;
  min-height: 0;
  border-right: 1px solid var(--line);
  background: #0a0e14;
}

.survey-pane {
  grid-column: 2;
  grid-row: 1 / -1;
  width: 520px;
  min-height: 0;
  overflow: hidden;
  background: #0e131a;
  border-left: 1px solid var(--line);
  box-shadow: -18px 0 42px rgba(0, 0, 0, 0.16);
}

.survey-pane-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 20px 22px 18px;
}

.survey-empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  color: var(--muted);
  padding: 12px;
}

.empty-step {
  justify-self: center;
  margin-bottom: 12px;
  padding: 5px 10px;
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 999px;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.08);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 17px;
  color: var(--ink);
  font-weight: 650;
}

.empty-copy {
  margin: 0;
  max-width: 280px;
  font-size: 13px;
  line-height: 1.55;
  justify-self: center;
}

.survey-pane-inner :deep(.survey-host) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 900px) {
  .review-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .review-body {
    grid-template-columns: 1fr;
    grid-template-rows: 260px 420px auto;
  }

  .gallery-pane {
    grid-column: 1;
    grid-row: 1;
    border-right: 0;
  }

  .map-pane {
    grid-column: 1;
    grid-row: 2;
    border-right: 0;
  }

  .survey-pane {
    grid-column: 1;
    grid-row: 3;
    min-height: 420px;
  }
}

@media (max-width: 1180px) {
  .review-toolbar {
    grid-template-columns: minmax(190px, 0.65fr) minmax(400px, 1.35fr);
  }

  .toolbar-fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-column: 2;
    gap: 12px;
    min-width: 0;
  }

  .archive-block {
    grid-column: 1 / -1;
    width: min(100%, 360px);
    justify-self: end;
  }

  .review-body {
    grid-template-columns: minmax(0, 1fr) 460px;
  }

  .survey-pane {
    width: 460px;
  }
}

@media (max-width: 900px) {
  .review-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-fields {
    grid-column: auto;
    grid-template-columns: minmax(180px, 1.2fr) 1fr 1fr;
  }

  .archive-block {
    grid-column: auto;
    width: 100%;
  }

  .review-body {
    grid-template-columns: 1fr;
  }

  .survey-pane {
    width: 100%;
  }
}

@media (max-width: 620px) {
  .review-toolbar {
    padding: 14px;
  }

  .toolbar-fields {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import decodedRoute from "../config/routes/shenzhen-zhiyuan-cuigu-posttest.json";
import { parseRouteConfig } from "../lib/parseRouteConfig";
import { savePretestSession, saveReviewSession } from "../lib/reviewArchive";
import {
  buildScores,
  isInstrumentComplete,
  normalizeAnswers
} from "../lib/surveyComplete";
import SegmentMap from "../components/review/SegmentMap.vue";
import SegmentGalleryBar from "../components/review/SegmentGalleryBar.vue";
import StreetViewLightbox from "../components/review/StreetViewLightbox.vue";
import SurveyHost from "../components/surveys/SurveyHost.vue";
import PretestSurvey from "../components/surveys/PretestSurvey.vue";
import UmuxSurvey from "../components/surveys/UmuxSurvey.vue";
import { isPosttestComplete } from "../lib/reviewPayload.js";
import { scoreUmux, umuxAnsweredCount, umuxAnswersFromDraft } from "../lib/umux.js";
import { withSegmentColors } from "../lib/segmentColors";
import { WALKING_ORDER_OPTIONS } from "../lib/walkingOrder.js";

const parsed = parseRouteConfig(decodedRoute);

/** @type {import('vue').Ref<'pre'|'post'>} */
const phase = ref("pre");
const subjectId = ref("");
const walkingOrder = ref(WALKING_ORDER_OPTIONS[0].value);
const subjectName = ref("");
const subjectAge = ref("");
const subjectGender = ref("");
const subjectEducation = ref("");
const subjectMajor = ref("");

const GENDER_OPTIONS = [
  "Female",
  "Male",
  "Non-binary",
  "Other"
];

const hoverSegmentId = ref(null);
const activeSegmentId = ref(null);
const lightboxOpen = ref(false);
const lightboxPointId = ref(null);
const activePointId = ref(null);

/** drafts keyed by segmentId (post) or single pretest draft */
const drafts = reactive({});
const pretestDraft = ref({});
/** confirmed payload keyed by segmentId: { answers, scores } */
const confirmed = reactive({});
const pretestConfirmed = ref(null);
const posttestStep = ref("segments");
const umuxDraft = ref({});

const saveStatus = ref(null);
const saving = ref(false);

const isPre = computed(() => phase.value === "pre");

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
const posttestComplete = computed(() => isPosttestComplete(segments.value, confirmed, umuxDraft.value));
const umuxCount = computed(() => umuxAnsweredCount(umuxDraft.value));

function clearSessionState() {
  Object.keys(drafts).forEach((k) => delete drafts[k]);
  Object.keys(confirmed).forEach((k) => delete confirmed[k]);
  pretestDraft.value = {};
  pretestConfirmed.value = null;
  posttestStep.value = "segments";
  umuxDraft.value = {};
  activeSegmentId.value = null;
  activePointId.value = null;
  lightboxOpen.value = false;
  lightboxPointId.value = null;
  hoverSegmentId.value = null;
  saveStatus.value = null;
}

watch(phase, () => {
  clearSessionState();
});

function onHover(id) {
  hoverSegmentId.value = id;
}

function onLeave() {
  hoverSegmentId.value = null;
}

function onSelect(id) {
  if (saving.value) return;
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

/** Local confirm for current segment (post-test only). */
function onSegmentConfirm(payload) {
  if (saving.value) return;
  const segId = payload.segmentId || activeSegmentId.value;
  if (!segId) return;
  const answers = payload.answers || drafts[segId] || {};
  if (!isInstrumentComplete("posttest", answers)) {
    saveStatus.value = {
      ok: false,
      message: "Please complete all items for this segment first."
    };
    return;
  }
  confirmed[segId] = {
    answers: normalizeAnswers("posttest", answers),
    scores: buildScores("posttest", answers)
  };
  saveStatus.value = {
    ok: true,
    message: `Confirmed “${activeSegment.value?.label || segId}” (${completedCount.value}/${segments.value.length})`
  };
  if (allSegmentsComplete.value) {
    posttestStep.value = "usability";
    lightboxOpen.value = false;
  }
}

function updateSegmentDraft(segmentId, answers) {
  if (saving.value) return;
  drafts[segmentId] = answers;
  delete confirmed[segmentId];
  saveStatus.value = null;
}

function updateUmuxDraft(answers) {
  if (saving.value) return;
  umuxDraft.value = answers;
  saveStatus.value = null;
}

function openPlatformEvaluation() {
  if (!allSegmentsComplete.value || saving.value) return;
  posttestStep.value = "usability";
  lightboxOpen.value = false;
  saveStatus.value = null;
}

async function submitPretest(payload) {
  if (saving.value) return;
  const answers = payload?.answers || pretestDraft.value;
  if (!isInstrumentComplete("pretest", answers)) {
    saveStatus.value = { ok: false, message: "Please complete GAD-7 and all mood items." };
    return;
  }
  const age = String(subjectAge.value || "").trim();
  const gender = String(subjectGender.value || "").trim();
  const education = String(subjectEducation.value || "").trim();
  const major = String(subjectMajor.value || "").trim();
  if (!age || !gender || !education || !major) {
    saveStatus.value = {
      ok: false,
      message: "Please fill Age, Gender, Education, and Major."
    };
    return;
  }
  saving.value = true;
  saveStatus.value = null;
  try {
    const scores = payload?.scores || buildScores("pretest", answers);
    const normalized = {
      ...normalizeAnswers("pretest", answers),
      age,
      gender,
      education,
      major
    };
    pretestConfirmed.value = { answers: normalized, scores };
    const result = await savePretestSession({
      subjectId: subjectId.value.trim() || "anonymous",
      subjectName: subjectName.value.trim() || "anonymous",
      walkingOrder: walkingOrder.value,
      answers: normalized,
      scores
    });
    if (result.ok) {
      saveStatus.value = {
        ok: true,
        message: result.skipped
          ? result.reason
          : `Pre-test submitted (session ${String(result.sessionId).slice(0, 8)}…)`
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

async function submitAll() {
  if (isPre.value || !posttestComplete.value || saving.value) return;
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
      walkingOrder: walkingOrder.value,
      routeConfigId: routeMeta.value.id,
      routeName: routeMeta.value.name,
      instrumentId: "posttest",
      segments: segments.value,
      responses,
      platformEvaluation: {
        answers: umuxAnswersFromDraft(umuxDraft.value),
        scores: scoreUmux(umuxDraft.value)
      }
    });
    if (result.ok) {
      saveStatus.value = {
        ok: true,
        message: result.skipped
          ? result.reason
          : `Post-test submitted: ${segments.value.length} route surveys and UX/UI evaluation (session ${String(result.sessionId).slice(0, 8)}…)`
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
  <main class="review-page" :class="{ 'phase-pre': isPre, 'phase-post': !isPre }">
    <section class="review-toolbar">
      <div class="route-info">
        <span class="toolbar-kicker">Review</span>
        <strong>{{ isPre ? "Pre-test" : "Post-test" }}</strong>
      </div>

      <div class="toolbar-fields" :class="{ 'is-pre': isPre }" aria-label="Review setup">
        <label class="phase-field">
          Phase
          <div class="phase-toggle" role="group" aria-label="Test phase">
            <span class="phase-side" :class="{ on: isPre }">Pre</span>
            <button
              type="button"
              class="phase-switch"
              :class="{ post: !isPre }"
              :aria-pressed="!isPre"
              :aria-label="isPre ? 'Switch to Post-test' : 'Switch to Pre-test'"
              :disabled="saving"
              @click="phase = isPre ? 'post' : 'pre'"
            >
              <span class="phase-knob" />
            </button>
            <span class="phase-side" :class="{ on: !isPre }">Post</span>
          </div>
        </label>
        <label>
          Name
          <input v-model="subjectName" type="text" placeholder="e.g. Alex" autocomplete="off" />
        </label>
        <label class="walking-order-field">
          Walk order
          <select v-model="walkingOrder" :disabled="saving">
            <option v-for="option in WALKING_ORDER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <template v-if="isPre">
          <label>
            Age
            <input
              v-model="subjectAge"
              type="number"
              min="1"
              max="120"
              placeholder="e.g. 22"
              autocomplete="off"
            />
          </label>
          <label>
            Gender
            <select v-model="subjectGender">
              <option value="" disabled>Select…</option>
              <option v-for="opt in GENDER_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </label>
          <label>
            Major
            <input
              v-model="subjectMajor"
              type="text"
              placeholder="e.g. Psychology"
              autocomplete="off"
            />
          </label>
          <label>
            Education
            <input
              v-model="subjectEducation"
              type="text"
              placeholder="e.g. Bachelor"
              autocomplete="off"
            />
          </label>
        </template>
      </div>

      <div v-if="!isPre || saveStatus" class="archive-block">
        <label v-if="!isPre" class="progress-field">
          Progress
          <button
            type="button"
            class="btn-submit-all"
            :class="{ ready: posttestStep === 'usability' ? posttestComplete : allSegmentsComplete }"
            :disabled="saving || (posttestStep === 'usability' ? !posttestComplete : !allSegmentsComplete)"
            :aria-label="posttestStep === 'usability' ? 'Submit post-test' : 'Continue to UX/UI evaluation'"
            @click="posttestStep === 'usability' ? submitAll() : openPlatformEvaluation()"
          >
            <span v-if="posttestStep === 'segments' && !allSegmentsComplete" class="button-progress">
              <span>{{ completedCount }} / {{ segments.length }} route surveys</span>
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
            <span v-else-if="posttestStep === 'segments'">Continue to UX/UI evaluation</span>
            <span v-else>{{ saving ? "Submitting…" : posttestComplete ? "Submit post-test" : `UX/UI evaluation · ${umuxCount} / 4 answered` }}</span>
          </button>
        </label>
        <p
          v-if="saveStatus"
          class="save-msg"
          :class="saveStatus.ok ? 'ok' : 'err'"
        >
          {{ saveStatus.message }}
        </p>
      </div>
    </section>

    <!-- Pre-test: full-width questionnaire, no map -->
    <div v-if="isPre" class="pretest-body">
      <div class="pretest-pane">
        <PretestSurvey
          v-model="pretestDraft"
          :submitting="saving"
          @submit="submitPretest"
        />
      </div>
    </div>

    <div v-else-if="posttestStep === 'usability'" class="usability-body">
      <div class="usability-pane">
        <div class="usability-nav">
          <button type="button" class="back-to-segments" :disabled="saving" @click="posttestStep = 'segments'; saveStatus = null">
            ← Review route answers
          </button>
          <span>{{ completedCount }} / {{ segments.length }} route surveys confirmed</span>
        </div>
        <UmuxSurvey :model-value="umuxDraft" :disabled="saving" @update:model-value="updateUmuxDraft" />
        <div class="usability-submit">
          <p>Submit once you have answered all four questions. Your route surveys and platform evaluation will be saved together.</p>
          <button type="button" class="btn-submit-all" :class="{ ready: posttestComplete }"
            :disabled="!posttestComplete || saving" @click="submitAll">
            {{ saving ? "Submitting…" : "Submit post-test" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Post-test: map + per-segment POMS-30, then one platform-wide UMUX -->
    <div v-else class="review-body">
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
          <nav class="route-survey-nav" aria-label="Route survey sections">
            <button v-for="segment in segments" :key="segment.id" type="button"
              :aria-pressed="activeSegmentId === segment.id" :disabled="saving"
              :style="{ '--segment-color': segment.color }" @click="onSelect(segment.id)">
              <span>{{ segment.label }}</span>
              <small>{{ confirmed[segment.id] ? 'Confirmed ✓' : 'Route survey' }}</small>
            </button>
          </nav>
          <div v-if="!activeSegment" class="survey-empty">
            <span class="empty-step">Step 2</span>
            <p class="empty-title">No segment selected</p>
            <p class="empty-copy">
              Click a path segment on the map to fill its mood survey. Confirm both route surveys,
              then complete the final four-question UX/UI evaluation before submitting.
            </p>
          </div>
          <SurveyHost
            v-else
            instrument-id="posttest"
            :segment-meta="{
              id: activeSegment.id,
              label: activeSegment.label,
              order: activeSegment.order
            }"
            :model-value="drafts[activeSegment.id]"
            @update:model-value="updateSegmentDraft(activeSegment.id, $event)"
            @submit="onSegmentConfirm"
          />
        </div>
      </aside>
    </div>

    <StreetViewLightbox
      v-if="!isPre && posttestStep === 'segments'"
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
  grid-template-columns: minmax(140px, 0.7fr) minmax(0, 1.6fr) minmax(220px, 0.9fr);
  align-items: end;
  gap: 12px 24px;
  padding: 14px 24px;
  box-sizing: border-box;
  width: 100%;
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
  align-self: end;
  padding-bottom: 2px;
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

.toolbar-fields {
  display: grid;
  grid-template-columns: minmax(132px, 0.9fr) minmax(110px, 1fr) minmax(220px, 1.4fr);
  gap: 12px 14px;
  align-items: end;
  min-width: 0;
}

.toolbar-fields.is-pre {
  grid-column: 2 / -1;
  grid-template-columns: minmax(132px, 0.9fr) minmax(88px, 1fr) minmax(220px, 1.5fr) repeat(4, minmax(72px, 1fr));
}

.phase-pre .archive-block {
  grid-column: 2 / -1;
}

.toolbar-fields label {
  display: grid;
  gap: 5px;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
  min-width: 0;
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

.toolbar-fields select {
  cursor: pointer;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, #a7b0bc 50%),
    linear-gradient(135deg, #a7b0bc 50%, transparent 50%);
  background-position: calc(100% - 16px) calc(50% - 2px), calc(100% - 10px) calc(50% - 2px);
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
  padding-right: 28px;
}

.toolbar-fields input:focus,
.toolbar-fields select:focus {
  border-color: rgba(34, 211, 238, 0.7);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
}

.toolbar-fields input::placeholder {
  color: var(--faint);
}

.phase-field {
  gap: 4px;
}

.phase-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
}

.phase-side {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.2px;
  text-transform: none;
  color: var(--faint);
  min-width: 28px;
}

.phase-side.on {
  color: var(--ink);
}

.phase-switch {
  position: relative;
  width: 44px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  flex: none;
  transition: background 0.18s, border-color 0.18s;
}

.phase-switch.post {
  background: rgba(34, 211, 238, 0.22);
  border-color: rgba(34, 211, 238, 0.45);
}

.phase-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e8eef4;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.18s;
}

.phase-switch.post .phase-knob {
  transform: translateX(20px);
  background: #67e8f9;
}

.archive-block {
  display: grid;
  gap: 5px;
  min-width: 0;
  width: 100%;
  justify-self: stretch;
  align-content: end;
}

.progress-field {
  display: grid;
  gap: 5px;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
  min-width: 0;
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

.pretest-body {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: #0e131a;
  scrollbar-gutter: stable;
}

.pretest-pane {
  /* Match app header / nav horizontal inset (24px) and full content width */
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  padding: 18px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #0e131a;
}

.pretest-pane :deep(.pretest) {
  flex: none;
  min-height: 0;
  overflow: visible;
}

.usability-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  background: #0e131a;
  scrollbar-gutter: stable;
}

.usability-pane {
  width: min(100%, 960px);
  box-sizing: border-box;
  margin: 0 auto;
  padding: 24px 28px 36px;
  display: grid;
  gap: 22px;
}

.usability-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.usability-nav > span { color: #86efac; font-size: 12px; }
.back-to-segments {
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.back-to-segments:hover { color: var(--ink); }
.usability-submit { display: grid; grid-template-columns: 1fr minmax(180px, 240px); align-items: center; gap: 24px; }
.usability-submit p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.usability-submit .btn-submit-all { height: auto; min-height: 44px; }
.route-survey-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; flex: none; margin-bottom: 18px; }
.route-survey-nav button {
  display: grid; gap: 5px; text-align: left; padding: 10px 12px; border: 1px solid var(--line);
  border-radius: 9px; background: rgba(255, 255, 255, .025); color: var(--ink); font: inherit;
  font-size: 12px; cursor: pointer; min-width: 0;
}
.route-survey-nav button[aria-pressed="true"] { border-color: var(--segment-color); background: color-mix(in srgb, var(--segment-color) 8%, transparent); }
.route-survey-nav small { color: var(--muted); font-size: 10px; }
.route-survey-nav button:focus-visible, .back-to-segments:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

@media (max-width: 540px) {
  .usability-pane { padding: 18px 16px 28px; }
  .usability-nav { align-items: flex-start; }
  .usability-nav > span { text-align: right; line-height: 1.5; }
  .usability-submit { grid-template-columns: 1fr; gap: 12px; }
}

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

@media (max-width: 1280px) {
  .review-toolbar {
    grid-template-columns: minmax(140px, 0.7fr) minmax(0, 1.6fr);
  }

  .toolbar-fields,
  .toolbar-fields.is-pre {
    grid-column: 2;
  }

  .toolbar-fields.is-pre {
    grid-template-columns: minmax(120px, 0.85fr) repeat(3, minmax(0, 1fr));
  }

  .toolbar-fields.is-pre .walking-order-field {
    grid-column: span 2;
  }

  .archive-block,
  .phase-pre .archive-block {
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
  .review-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .review-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-fields,
  .toolbar-fields.is-pre {
    grid-column: auto;
    grid-template-columns: 1fr;
  }

  .toolbar-fields.is-pre .walking-order-field {
    grid-column: auto;
  }

  .archive-block,
  .phase-pre .archive-block {
    grid-column: auto;
    width: 100%;
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
    width: 100%;
    min-height: 420px;
  }

}
</style>

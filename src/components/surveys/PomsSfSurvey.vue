<script setup>
import { computed } from "vue";
import {
  POMS30_ITEMS,
  isPoms30Complete,
  poms30AnswersFromDraft,
  scorePoms30
} from "../../lib/poms30";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) },
  /** When true, hide local submit (used inside PretestSurvey). */
  embed: { type: Boolean, default: false },
  submitLabel: { type: String, default: "Confirm this segment" }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

const openFeeling = computed({
  get: () => answers.value.openFeeling || "",
  set: (v) => {
    answers.value = { ...answers.value, openFeeling: v };
  }
});

function setItem(i, v) {
  answers.value = { ...answers.value, [`m${i}`]: v };
}

const complete = computed(() => {
  if (!isPoms30Complete(answers.value)) return false;
  // Post-test (non-embed): require open-ended segment feeling.
  if (!props.embed) return String(answers.value.openFeeling || "").trim().length > 0;
  return true;
});

function submit() {
  if (!complete.value) return;
  emit("submit", {
    answers: {
      ...poms30AnswersFromDraft(answers.value),
      openFeeling: String(answers.value.openFeeling || "").trim()
    },
    scores: scorePoms30(answers.value)
  });
}
</script>

<template>
  <div class="survey-body" :class="{ embed }">
    <p class="hint">
      How do you feel right now? 0 = Not at all · 4 = Extremely
      <span v-if="segmentMeta?.label"> · {{ segmentMeta.label }}</span>
    </p>
    <ol class="items" :class="{ row: embed }">
      <li v-for="(text, i) in POMS30_ITEMS" :key="i">
        <p>{{ text }}</p>
        <div class="scale" :class="{ 'cols-5': embed }">
          <label v-for="v in [0, 1, 2, 3, 4]" :key="v">
            <input
              type="radio"
              :name="`poms30-${segmentMeta?.id || 'pre'}-${i}`"
              :value="v"
              :checked="answers[`m${i}`] === v"
              @change="setItem(i, v)"
            />
            <span>{{ v }}</span>
          </label>
        </div>
      </li>
      <li v-if="!embed" class="open-item">
        <p>How did you feel while walking this segment of the route?</p>
        <textarea
          :id="`open-feeling-${segmentMeta?.id || 'seg'}`"
          v-model="openFeeling"
          rows="4"
          placeholder="Describe your feelings about this segment…"
          autocomplete="off"
        />
      </li>
    </ol>
    <button
      v-if="!embed"
      type="button"
      class="btn primary"
      :disabled="!complete"
      @click="submit"
    >
      {{ submitLabel }}
    </button>
  </div>
</template>

<style scoped>
@import "./survey-shared.css";

.survey-body.embed {
  flex: none;
  height: auto;
  min-height: 0;
  overflow: visible;
}

.survey-body.embed .items {
  flex: none;
  overflow: visible;
}

.open-item {
  display: grid;
  gap: 10px;
}

.open-item p {
  margin: 0;
}

.open-item textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.34);
  color: var(--ink);
  font: inherit;
  line-height: 1.45;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.open-item textarea:focus {
  border-color: rgba(34, 211, 238, 0.7);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
}

.open-item textarea::placeholder {
  color: var(--faint);
}
</style>

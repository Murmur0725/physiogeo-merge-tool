<script setup>
import { computed } from "vue";
import Gad7Survey from "./Gad7Survey.vue";
import PomsSfSurvey from "./PomsSfSurvey.vue";
import {
  gad7AnswersFromDraft,
  isGad7Complete,
  scoreGad7
} from "../../lib/gad7";
import {
  isPoms30Complete,
  poms30AnswersFromDraft,
  scorePoms30
} from "../../lib/poms30";

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  submitting: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

const complete = computed(
  () => isGad7Complete(answers.value) && isPoms30Complete(answers.value)
);

function submit() {
  if (!complete.value || props.submitting) return;
  emit("submit", {
    answers: {
      ...gad7AnswersFromDraft(answers.value),
      ...poms30AnswersFromDraft(answers.value)
    },
    scores: {
      ...scoreGad7(answers.value),
      ...scorePoms30(answers.value)
    }
  });
}
</script>

<template>
  <div class="pretest">
    <div class="pretest-scroll" role="region" aria-label="Pre-test questionnaire">
      <section class="block">
        <Gad7Survey
          embed
          :segment-meta="{ id: 'pretest' }"
          :model-value="answers"
          @update:model-value="answers = $event"
        />
      </section>
      <section class="block">
        <PomsSfSurvey
          embed
          :segment-meta="{ id: 'pretest' }"
          :model-value="answers"
          @update:model-value="answers = $event"
        />
      </section>
    </div>
    <button
      type="button"
      class="btn primary"
      :disabled="!complete || submitting"
      @click="submit"
    >
      {{ submitting ? "Submitting…" : "Submit pre-test" }}
    </button>
  </div>
</template>

<style scoped>
@import "./survey-shared.css";

.pretest {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  overflow: visible;
}

.pretest-scroll {
  width: 100%;
  overflow: visible;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.block {
  flex: none;
  width: 100%;
}

.pretest > .btn {
  flex: none;
  width: 100%;
  max-width: none;
  margin-top: 4px;
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: #0e131a;
  box-shadow: 0 -10px 24px rgba(8, 12, 18, 0.55);
}
</style>

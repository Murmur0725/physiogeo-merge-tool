<script setup>
import { computed } from "vue";
import { GAD7_ITEMS, GAD7_SCALE, isGad7Complete, scoreGad7 } from "../../lib/gad7";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) },
  /** When true, hide local submit (used inside PretestSurvey). */
  embed: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

function setItem(i, v) {
  answers.value = { ...answers.value, [`g${i}`]: v };
}

const complete = computed(() => isGad7Complete(answers.value));

function submit() {
  if (!complete.value) return;
  emit("submit", {
    answers: { ...answers.value },
    scores: scoreGad7(answers.value)
  });
}
</script>

<template>
  <div class="survey-body" :class="{ embed }">
    <p class="hint">
      Over the last 2 weeks, how often have you been bothered by the following?
      0 = Not at all · 3 = Nearly every day
    </p>
    <ol class="items" :class="{ row: embed }">
      <li v-for="(text, i) in GAD7_ITEMS" :key="i">
        <p>{{ text }}</p>
        <div class="scale" :class="{ 'cols-4': embed }">
          <label v-for="opt in GAD7_SCALE" :key="opt.v" :title="opt.label">
            <input
              type="radio"
              :name="`gad7-${segmentMeta?.id || 'pre'}-${i}`"
              :value="opt.v"
              :checked="answers[`g${i}`] === opt.v"
              @change="setItem(i, opt.v)"
            />
            <span>{{ opt.v }}</span>
          </label>
        </div>
      </li>
    </ol>
    <button
      v-if="!embed"
      type="button"
      class="btn primary"
      :disabled="!complete"
      @click="submit"
    >
      Confirm GAD-7
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
</style>

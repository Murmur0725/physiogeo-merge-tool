<script setup>
import { computed } from "vue";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["update:modelValue", "submit"]);

/** PSS-10 stub items (Likert 0–4). */
const ITEMS = [
  "In this segment, how often did you feel upset?",
  "How often did you feel unable to control important things?",
  "How often did you feel nervous or stressed?",
  "How often did you feel confident about handling problems?",
  "How often did you feel that things were going your way?",
  "How often did you feel unable to cope with all you had to do?",
  "How often were you able to control irritations?",
  "How often did you feel on top of things?",
  "How often were you angered by things outside your control?",
  "How often did you feel difficulties were piling up?"
];

const SCALE = [
  { v: 0, label: "Never" },
  { v: 1, label: "Almost never" },
  { v: 2, label: "Sometimes" },
  { v: 3, label: "Fairly often" },
  { v: 4, label: "Very often" }
];

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

function setItem(i, v) {
  answers.value = { ...answers.value, [`q${i}`]: v };
}

const complete = computed(() => ITEMS.every((_, i) => Number.isFinite(answers.value[`q${i}`])));

function score() {
  // Reverse-scored items: 3,4,6,7 (1-based) → indices 3,4,6,7
  const reverse = new Set([3, 4, 6, 7]);
  let total = 0;
  ITEMS.forEach((_, i) => {
    const raw = Number(answers.value[`q${i}`]);
    total += reverse.has(i) ? 4 - raw : raw;
  });
  return { pssTotal: total };
}

function submit() {
  if (!complete.value) return;
  emit("submit", { answers: { ...answers.value }, scores: score() });
}
</script>

<template>
  <div class="survey-body">
    <p class="hint">0 = Never · 4 = Very often (research stub; replace with formal items as needed)</p>
    <ol class="items">
      <li v-for="(text, i) in ITEMS" :key="i">
        <p>{{ text }}</p>
        <div class="scale">
          <label v-for="opt in SCALE" :key="opt.v">
            <input
              type="radio"
              :name="`pss-${segmentMeta?.id}-${i}`"
              :value="opt.v"
              :checked="answers[`q${i}`] === opt.v"
              @change="setItem(i, opt.v)"
            />
            <span>{{ opt.v }}</span>
          </label>
        </div>
      </li>
    </ol>
    <button type="button" class="btn primary" :disabled="!complete" @click="submit">
      Confirm this segment
    </button>
  </div>
</template>

<style scoped>
@import "./survey-shared.css";
</style>

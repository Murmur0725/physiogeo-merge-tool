<script setup>
import { computed } from "vue";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const ITEMS = [
  "Tense",
  "Angry",
  "Worn out",
  "Lively",
  "Confused",
  "Sad",
  "Active",
  "On edge",
  "Fatigued",
  "Cheerful"
];

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

function setItem(i, v) {
  answers.value = { ...answers.value, [`m${i}`]: v };
}

const complete = computed(() => ITEMS.every((_, i) => Number.isFinite(answers.value[`m${i}`])));

function submit() {
  if (!complete.value) return;
  const vals = ITEMS.map((_, i) => Number(answers.value[`m${i}`]));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  emit("submit", {
    answers: { ...answers.value },
    scores: { pomsSfMean: Number(mean.toFixed(2)) }
  });
}
</script>

<template>
  <div class="survey-body">
    <p class="hint">POMS-SF stub · 0 Not at all → 4 Extremely (this segment)</p>
    <ol class="items">
      <li v-for="(text, i) in ITEMS" :key="i">
        <p>{{ text }}</p>
        <div class="scale">
          <label v-for="v in [0, 1, 2, 3, 4]" :key="v">
            <input
              type="radio"
              :name="`poms-${segmentMeta?.id}-${i}`"
              :value="v"
              :checked="answers[`m${i}`] === v"
              @change="setItem(i, v)"
            />
            <span>{{ v }}</span>
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

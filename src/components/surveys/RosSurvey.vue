<script setup>
import { computed } from "vue";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const ITEMS = [
  "I feel restored and relaxed",
  "I feel alert and interested",
  "I have new enthusiasm and energy for my everyday routines",
  "I feel calm",
  "I got distance to everyday worries",
  "My concentration and alertness clearly increased"
];

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

function setItem(i, v) {
  answers.value = { ...answers.value, [`r${i}`]: v };
}

const complete = computed(() => ITEMS.every((_, i) => Number.isFinite(answers.value[`r${i}`])));

function submit() {
  if (!complete.value) return;
  const vals = ITEMS.map((_, i) => Number(answers.value[`r${i}`]));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  emit("submit", {
    answers: { ...answers.value },
    scores: { rosMean: Number(mean.toFixed(2)) }
  });
}
</script>

<template>
  <div class="survey-body">
    <p class="hint">ROS stub · 1 Strongly disagree → 7 Strongly agree</p>
    <ol class="items">
      <li v-for="(text, i) in ITEMS" :key="i">
        <p>{{ text }}</p>
        <div class="scale wide">
          <label v-for="v in [1, 2, 3, 4, 5, 6, 7]" :key="v">
            <input
              type="radio"
              :name="`ros-${segmentMeta?.id}-${i}`"
              :value="v"
              :checked="answers[`r${i}`] === v"
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

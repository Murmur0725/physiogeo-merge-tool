<script setup>
import { computed } from "vue";

const props = defineProps({
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["update:modelValue", "submit"]);

const FIELDS = [
  { key: "pleasant", label: "Pleasantness of this segment", min: 1, max: 7 },
  { key: "safety", label: "Perceived safety", min: 1, max: 7 },
  { key: "interest", label: "Visual interest", min: 1, max: 7 },
  { key: "walkability", label: "Walkability / comfort", min: 1, max: 7 }
];

const answers = computed({
  get: () => props.modelValue || {},
  set: (v) => emit("update:modelValue", v)
});

function setField(key, v) {
  answers.value = { ...answers.value, [key]: v };
}

const complete = computed(
  () =>
    FIELDS.every((f) => Number.isFinite(answers.value[f.key])) &&
    String(answers.value.note || "").length >= 0
);

function submit() {
  if (!complete.value) return;
  const scores = {};
  FIELDS.forEach((f) => {
    scores[f.key] = Number(answers.value[f.key]);
  });
  emit("submit", {
    answers: {
      ...answers.value,
      note: answers.value.note || ""
    },
    scores
  });
}
</script>

<template>
  <div class="survey-body">
    <p class="hint">Custom evaluation for the selected segment (replace items as needed)</p>
    <div class="custom-fields">
      <div v-for="f in FIELDS" :key="f.key" class="field-block">
        <label class="field-label">{{ f.label }} ({{ f.min }}–{{ f.max }})</label>
        <div class="scale wide">
          <label v-for="v in Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i)" :key="v">
            <input
              type="radio"
              :name="`custom-${segmentMeta?.id}-${f.key}`"
              :value="v"
              :checked="answers[f.key] === v"
              @change="setField(f.key, v)"
            />
            <span>{{ v }}</span>
          </label>
        </div>
      </div>
      <label class="field-label">Optional note</label>
      <textarea
        class="note"
        rows="3"
        :value="answers.note || ''"
        placeholder="Anything notable about this segment…"
        @input="setField('note', $event.target.value)"
      />
    </div>
    <button type="button" class="btn primary" :disabled="!complete" @click="submit">
      Confirm this segment
    </button>
  </div>
</template>

<style scoped>
@import "./survey-shared.css";

.custom-fields {
  display: grid;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
  scrollbar-gutter: stable;
}

.field-block {
  display: grid;
  gap: 8px;
}

.field-label {
  font-size: 13px;
  color: var(--ink);
}

.note {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.25);
  color: var(--ink);
  font: inherit;
}

.note:focus {
  outline: none;
  border-color: rgba(34, 211, 238, 0.45);
}
</style>

<script setup>
import { computed } from "vue";
import { resolveSurvey } from "./registry";

const props = defineProps({
  instrumentId: { type: String, default: "customEval" },
  segmentMeta: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) }
});

const emit = defineEmits(["update:modelValue", "submit"]);

const entry = computed(() => resolveSurvey(props.instrumentId));
const SurveyComp = computed(() => entry.value.component);

function onUpdate(answers) {
  emit("update:modelValue", answers);
}

function onSubmit(payload) {
  emit("submit", {
    instrumentId: entry.value.id,
    segmentId: props.segmentMeta?.id,
    ...payload
  });
}
</script>

<template>
  <div class="survey-host">
    <header class="survey-head">
      <div>
        <p class="survey-kicker">Segment survey</p>
        <h2>{{ segmentMeta?.label || "—" }}</h2>
      </div>
      <span class="survey-badge">{{ entry.label }}</span>
    </header>
    <component
      :is="SurveyComp"
      :segment-meta="segmentMeta"
      :model-value="modelValue"
      @update:model-value="onUpdate"
      @submit="onSubmit"
    />
  </div>
</template>

<style scoped>
.survey-host {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  flex: 1;
}

.survey-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.survey-kicker {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--muted);
}

.survey-head h2 {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  text-transform: none;
  letter-spacing: 0;
}

.survey-badge {
  flex: none;
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.07);
  border-color: rgba(34, 211, 238, 0.22);
  white-space: nowrap;
}

.survey-host > :deep(.survey-body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

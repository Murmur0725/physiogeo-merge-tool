<script setup>
import { UMUX_ITEMS, umuxAnsweredCount } from "../../lib/umux.js";

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue"]);

function setAnswer(key, value) {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}
</script>

<template>
  <section class="umux-survey" aria-labelledby="umux-heading">
    <header class="umux-header">
      <div>
        <p class="umux-kicker">Final step · UMUX</p>
        <h1 id="umux-heading">UX/UI evaluation</h1>
      </div>
      <span class="umux-progress" aria-live="polite">{{ umuxAnsweredCount(modelValue) }} / 4 answered</span>
    </header>
    <p class="umux-intro">
      Think about the web platform you just used to review your walk and answer the surveys.
      Rate your agreement with each statement about this system.
    </p>
    <p class="umux-hint">1 = Strongly disagree · 7 = Strongly agree. Please answer all four statements.</p>
    <div class="umux-items">
      <fieldset v-for="(item, index) in UMUX_ITEMS" :key="item.key" :disabled="disabled" class="umux-item">
        <legend><span class="umux-number">{{ index + 1 }}.</span> {{ item.text }}</legend>
        <div class="umux-scale">
          <label v-for="value in 7" :key="value">
            <input
              type="radio"
              :name="`umux-${item.key}`"
              :value="value"
              :checked="modelValue[item.key] === value"
              :aria-label="`${value}${value === 1 ? ' — Strongly disagree' : value === 7 ? ' — Strongly agree' : ''}`"
              required
              @change="setAnswer(item.key, value)"
            />
            <span>{{ value }}</span>
          </label>
        </div>
        <div class="umux-anchors" aria-hidden="true"><span>Strongly disagree</span><span>Strongly agree</span></div>
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
.umux-survey { display: grid; gap: 12px; }
.umux-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.umux-kicker { margin: 0 0 7px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(22px, 3vw, 30px); color: var(--ink); }
.umux-progress { flex: none; border: 1px solid rgba(34, 211, 238, .3); border-radius: 999px; padding: 7px 11px; font-size: 12px; color: #a5f3fc; background: rgba(34, 211, 238, .07); }
.umux-intro, .umux-hint { margin: 0; color: var(--muted); line-height: 1.6; font-size: 13px; }
.umux-hint { font-size: 12px; }
.umux-items { display: grid; gap: 14px; margin-top: 6px; }
.umux-item { min-width: 0; margin: 0; padding: 10px 18px 13px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255, 255, 255, .025); }
.umux-item legend { max-width: 100%; padding: 0 5px; font-size: 14px; font-weight: 600; line-height: 1.6; color: var(--ink); }
.umux-number { color: var(--accent); margin-right: 5px; }
.umux-scale { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.umux-scale label { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 44px; border-radius: 8px; border: 1px solid transparent; font-size: 13px; color: var(--muted); cursor: pointer; }
.umux-scale label:hover { background: rgba(255, 255, 255, .04); border-color: var(--line); }
.umux-scale label:has(input:checked) { border-color: rgba(34, 211, 238, .5); color: #a5f3fc; background: rgba(34, 211, 238, .1); }
.umux-scale input { width: 17px; height: 17px; margin: 0; accent-color: var(--accent); }
.umux-scale label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.umux-anchors { display: flex; justify-content: space-between; margin-top: 5px; color: var(--muted); font-size: 11px; }
@media (max-width: 540px) {
  .umux-header { align-items: flex-start; }
  .umux-progress { font-size: 11px; padding: 6px 8px; }
  .umux-item { padding-left: 10px; padding-right: 10px; }
  .umux-scale { gap: 2px; }
  .umux-scale label { flex-direction: column; gap: 5px; min-height: 52px; }
}
</style>

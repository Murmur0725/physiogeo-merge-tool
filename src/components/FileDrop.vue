<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  label: { type: String, required: true },
  accept: { type: String, required: true },
  hint: { type: String, default: "" },
  color: { type: String, default: "#22d3ee" },
  file: { type: File, default: null }
});

const emit = defineEmits(["select"]);

const inputEl = ref(null);
const dragging = ref(false);

const fileSize = computed(() => {
  if (!props.file) return "";
  const kb = props.file.size / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
});

function pick() {
  inputEl.value?.click();
}

function onChange(e) {
  const f = e.target.files?.[0];
  if (f) emit("select", f);
  e.target.value = "";
}

function onDrop(e) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) emit("select", f);
}
</script>

<template>
  <div
    class="drop"
    :class="{ filled: file, dragging }"
    :style="{ '--c': color }"
    @click="pick"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="inputEl" type="file" :accept="accept" hidden @change="onChange" />
    <div class="drop-head">
      <span class="dot"></span>
      <span class="drop-label">{{ label }}</span>
      <span v-if="file" class="check">✓</span>
    </div>
    <div v-if="file" class="file-name">{{ file.name }} <em>{{ fileSize }}</em></div>
    <div v-else class="drop-hint">{{ hint || "Click or drag file here" }}</div>
  </div>
</template>

<style scoped>
.drop {
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  margin-bottom: 10px;
}

.drop:hover,
.drop.dragging {
  border-color: var(--c);
  background: rgba(255, 255, 255, 0.035);
}

.drop.filled {
  border-style: solid;
  border-color: color-mix(in srgb, var(--c) 45%, transparent);
  background: color-mix(in srgb, var(--c) 7%, transparent);
}

.drop-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 8px var(--c);
  flex: none;
}

.drop-label {
  font-size: 12.5px;
  font-weight: 700;
}

.check {
  margin-left: auto;
  color: var(--c);
  font-weight: 700;
}

.drop-hint {
  margin-top: 3px;
  font-size: 11px;
  color: var(--faint);
}

.file-name {
  margin-top: 3px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink);
  word-break: break-all;
}

.file-name em {
  font-style: normal;
  color: var(--muted);
}
</style>

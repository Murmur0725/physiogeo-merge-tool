<script setup>
import { useRoute } from "vue-router";
import { computed } from "vue";

const route = useRoute();
const title = computed(() => route.meta.title || "Module");
</script>

<template>
  <div class="placeholder">
    <div class="orb"></div>
    <h1>{{ title }}</h1>
    <p>该模块正在开发中 — 将接入已归档的 merge 数据。</p>
    <RouterLink to="/" class="back">← 返回 Merge 工具</RouterLink>
  </div>
</template>

<style scoped>
.placeholder {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 60px 20px;
  text-align: center;
}

.orb {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--rainbow);
  opacity: 0.4;
  margin-bottom: 8px;
}

h1 {
  margin: 0;
  font-size: 24px;
}

p {
  margin: 0;
  color: var(--muted);
}

.back {
  margin-top: 14px;
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
</style>

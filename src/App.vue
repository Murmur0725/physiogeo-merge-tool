<script setup>
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-orb"></span>
      <div>
        PhysioGeo Studio
        <br />
        <small>Polite Study · Chicago Workshop</small>
      </div>
    </div>
    <nav class="app-nav" aria-label="Primary">
      <RouterLink to="/" class="nav-link" :class="{ active: route.path === '/' }">
        Merge
      </RouterLink>
      <RouterLink
        to="/review"
        class="nav-link"
        :class="{ active: route.path.startsWith('/review') }"
      >
        Review
      </RouterLink>
    </nav>
  </header>
  <RouterView />
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 24px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 24px;
  height: 58px;
  background: rgba(7, 9, 13, 0.82);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.app-header::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, #22d3ee, #4ade80, #facc15, #fb923c, #ef4444);
  opacity: 0.55;
  pointer-events: none;
}

.brand {
  justify-self: start;
  display: flex;
  align-items: center;
  gap: 11px;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  min-width: 0;
}

.brand-orb {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  flex: none;
  background: linear-gradient(90deg, #22d3ee, #4ade80, #facc15, #fb923c, #ef4444);
  box-shadow: 0 0 14px rgba(34, 211, 238, 0.35);
}

.brand small {
  color: #8b949e;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}

.app-nav {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-link {
  padding: 9px 18px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e6edf3;
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
  background: rgba(255, 255, 255, 0.05);
  transition: color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.nav-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.22);
}

.nav-link.active {
  color: #041016;
  background: linear-gradient(135deg, #67e8f9, #22d3ee 55%, #14b8a6);
  border-color: transparent;
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.35);
}
</style>

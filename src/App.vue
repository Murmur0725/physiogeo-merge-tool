<script setup>
const navItems = [
  { to: "/", label: "Merge", soon: false },
  { to: "/map", label: "Map", soon: true },
  { to: "/streetview", label: "Street View", soon: true },
  { to: "/survey", label: "Survey", soon: true }
];
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
    <nav class="nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :class="{ active: $route.path === item.to }"
      >
        {{ item.label }}
        <span v-if="item.soon" class="soon-tag">SOON</span>
      </RouterLink>
    </nav>
  </header>
  <RouterView />
</template>

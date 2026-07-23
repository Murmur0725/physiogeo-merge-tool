import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Project is served at https://murmur0725.github.io/physiogeo-merge-tool/
export default defineConfig({
  plugins: [vue()],
  base: "/physiogeo-merge-tool/"
});

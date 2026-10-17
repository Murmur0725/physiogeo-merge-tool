import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/** GitHub Pages serves 404.html for unknown paths — copy SPA shell so /review works. */
function spaFallback404() {
  return {
    name: "spa-fallback-404",
    closeBundle() {
      const index = resolve("dist/index.html");
      const fallback = resolve("dist/404.html");
      if (existsSync(index)) {
        copyFileSync(index, fallback);
        // Real entry files let both published version URLs return HTTP 200.
        for (const version of ["v1", "v2"]) {
          mkdirSync(resolve("dist", version), { recursive: true });
          copyFileSync(index, resolve("dist", version, "index.html"));
        }
      }
    }
  };
}

// Project is served at https://murmur0725.github.io/physiogeo-merge-tool/
export default defineConfig({
  plugins: [vue(), spaFallback404()],
  base: "/physiogeo-merge-tool/"
});

import { readFileSync } from "node:fs";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

// the version actually installed from npm, so the sidebar label can never go stale
const { version } = JSON.parse(
  readFileSync(
    new URL("./node_modules/@dschz/solid-ag-grid/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

export default defineConfig({
  // served from GitHub Pages under /solid-ag-grid/
  base: "/solid-ag-grid/",
  plugins: [solid()],
  define: { __SOLID_AG_GRID_VERSION__: JSON.stringify(version) },
  // AllCommunityModule makes the single chunk inherently large; that's expected here.
  build: { target: "esnext", chunkSizeWarningLimit: 1600 },
});

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // served from GitHub Pages under /solid-ag-grid/
  base: "/solid-ag-grid/",
  plugins: [solid()],
  // AllCommunityModule makes the single chunk inherently large; that's expected here.
  build: { target: "esnext", chunkSizeWarningLimit: 1600 },
});

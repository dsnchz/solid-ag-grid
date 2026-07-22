import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  // AllCommunityModule makes the single chunk inherently large; that's expected here.
  build: { target: "esnext", chunkSizeWarningLimit: 1600 },
});

import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      {
        // no `extends`: this project brings its own solid() so the SSR JSX transform doesn't
        // leak into the jsdom project (Vitest runs jsdom through the ssr module pipeline too)
        plugins: [solid({ ssr: true })],
        test: {
          name: "ssr",
          include: ["test/ssr/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

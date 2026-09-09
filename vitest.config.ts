import solid from "@solidjs/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const PERF_TESTS = [
  "test/browser/perfHarness.browser.test.tsx",
  "test/browser/perfCompare.browser.test.tsx",
  "test/browser/perfSmoke.browser.test.tsx",
  "test/browser/rowStorePerf.browser.test.tsx",
];

// factory, not a shared object: Vitest names each project's browser instance in place, and a
// shared reference reads as the same instance defined twice
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [{ browser: "chromium" as const }],
});

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
          exclude: [...PERF_TESTS, "**/node_modules/**"],
          browser: browser(),
        },
      },
      {
        // PERF PROJECT — production posture. Benchmarks must run Solid's PROD runtime and
        // prod-compiled JSX: the dev build carries attribution/diagnostics instrumentation
        // that folds out of prod (solid-flow measured ~30% on rc.2 from dev instrumentation
        // alone; rc.7 carries far more), and vanilla AG Grid pays no such tax, so dev-build
        // numbers understate the renderer against its own baseline. No `extends`: this
        // project brings its own solid() with dev injection off, and `mode: "production"`
        // resolves Vite's `development|production` default condition to production.
        // test/browser/perfHarness.browser.test.tsx pins that the prod runtime really loaded.
        mode: "production",
        plugins: [solid({ dev: false, hot: false })],
        // explicit: Vitest pins its own mode, so Vite's `development|production` default token
        // would still resolve to development — name the conditions outright
        resolve: { conditions: ["production", "browser", "module", "default"] },
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        test: {
          name: "perf",
          include: PERF_TESTS,
          browser: browser(),
        },
      },
    ],
  },
});

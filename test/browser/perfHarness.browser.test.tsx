// Harness sanity for the `perf` vitest project (vitest.config.ts): every benchmark number is
// meaningless unless Solid's PRODUCTION runtime is what ran. Pins the posture explicitly so a
// config drift (a `development` condition sneaking back in, dev injection re-enabled) fails
// loudly instead of silently re-taxing the numbers.
import { DEV } from "solid-js";
import { describe, expect, it } from "vitest";

describe("perf harness posture", () => {
  it("runs Solid's production runtime (DEV is undefined) in a visible document", () => {
    expect(
      DEV,
      "solid-js resolved to its dev build — see the perf project in vitest.config.ts",
    ).toBeUndefined();
    // (import.meta.env.MODE stays "test" under Vitest regardless of project; NODE_ENV is the
    // define the perf project sets, and DEV === undefined proves the resolved runtime)
    expect(process.env.NODE_ENV).toBe("production");
    // hidden tabs suspend rAF / ResizeObserver and look exactly like a regression
    expect(document.visibilityState).toBe("visible");
  });
});

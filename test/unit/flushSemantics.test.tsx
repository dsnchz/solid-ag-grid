import { testEffect } from "@solidjs/testing-library";
import { createEffect, createMemo, createSignal, flush, NotReadyError, untrack } from "solid-js";
import { describe, expect, it } from "vitest";

import { agFlush, runWithoutFlush } from "../../src/core/utils";

/**
 * Empirical evidence for ARCHITECTURE.md Open question 2 (`flush()` vs `flushSync` semantics
 * and the ensureVisible reentrancy latch) plus the apply-phase legality questions T3.4's
 * row/cell code depends on (renderKey bumps, flush from grid-core callbacks re-entered from
 * apply phases). Also pins the question 9 mechanism: catching NotReadyError in a compute
 * keeps the subscription alive.
 */
describe("flush semantics (Open question 2 evidence)", () => {
  it("agFlush(false) defers to the microtask batch; agFlush(true) applies synchronously", () => {
    const [v, setV] = createSignal(0);

    agFlush(false, () => setV(1));
    // unowned read returns the committed value: the write is still pending
    expect(untrack(v)).toBe(0);
    flush();
    expect(untrack(v)).toBe(1);

    agFlush(true, () => setV(2));
    // flush() ran inside agFlush — the write is already committed
    expect(untrack(v)).toBe(2);
  });

  it("the ensureVisible latch (runWithoutFlush) suppresses agFlush(true) during the callback and the current frame, without losing updates", async () => {
    const [v, setV] = createSignal(0);

    runWithoutFlush(() => {
      agFlush(true, () => setV(1));
      // suppressed: no synchronous apply
      expect(untrack(v)).toBe(0);
    });

    // the latch stays down until its setTimeout(0) re-enable fires
    agFlush(true, () => setV(2));
    expect(untrack(v)).toBe(0);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // nothing was lost: Solid's own microtask batch applied the writes anyway
    expect(untrack(v)).toBe(2);

    // latch re-enabled: agFlush(true) is synchronous again
    agFlush(true, () => setV(3));
    expect(untrack(v)).toBe(3);
  });

  it("signal writes inside an effect apply phase are legal (the renderKey-bump pattern in CellComp)", () =>
    testEffect((done) => {
      const [src, setSrc] = createSignal(0);
      const [key, setKey] = createSignal(1);

      createEffect(
        () => src(),
        (value) => {
          if (value === 0) {
            setSrc(1);
          } else {
            // CellComp's refresh effect does exactly this write
            setKey((prev) => prev + 1);
          }
        },
      );

      createEffect(
        () => key(),
        (k) => {
          if (k === 2) {
            done();
          }
        },
      );
    }));

  it("agFlush(true) called from inside an effect apply phase does not throw (flush mid-apply)", () =>
    testEffect((done) => {
      const [a, setA] = createSignal(0);
      const [_b, setB] = createSignal(0);

      createEffect(
        () => a(),
        (value) => {
          if (value !== 1) {
            setA(1);
            return;
          }
          // grid code invoked from an apply phase may reach agFlush (this is the hazard class
          // the runWithoutFlush latch exists for on the ensureVisible path)
          expect(() => agFlush(true, () => setB(5))).not.toThrow();
          done();
        },
      );
    }));

  it("catching NotReadyError in a compute keeps the subscription (Open question 9 per-key isolation mechanism)", () =>
    testEffect((done) => {
      let resolvePromise!: (value: string) => void;
      const promise = new Promise<string>((resolve) => (resolvePromise = resolve));
      const asyncVal = createMemo(() => promise);

      const seen: (string | undefined)[] = [];
      createEffect(
        () => {
          try {
            return asyncVal();
          } catch (e) {
            if (e instanceof NotReadyError) {
              return undefined;
            }
            throw e;
          }
        },
        (value) => {
          seen.push(value);
          if (value === "ready") {
            // first run observed "not ready yet", second run fired on resolution — the
            // dependency edge survived the caught throw
            expect(seen).toEqual([undefined, "ready"]);
            done();
          }
        },
      );

      setTimeout(() => resolvePromise("ready"), 10);
    }));
});

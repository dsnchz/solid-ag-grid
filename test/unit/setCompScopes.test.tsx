/* eslint-disable solid/reactivity -- these tests deliberately read/write signals outside
   tracked scopes to characterize Solid 2.0's unowned-scope semantics */
import { render } from "@solidjs/testing-library";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";

/**
 * Empirical evidence for ARCHITECTURE.md Open question 1 (where may `ctrl.setComp` run?).
 *
 * The `setComp` call synchronously pushes initial state through the compProxy → signal writes
 * (GridCtrl.setComp → LayoutFeature.postConstruct → updateLayoutClasses → setLayoutClass).
 * The React wrapper does setComp in ref callbacks; these tests prove the same placement is
 * legal in Solid 2.0 dev mode, and that the dev diagnostics are actually armed in this test
 * environment (so the "no throw" result is meaningful).
 */
describe("setComp scope rules (Open question 1 evidence)", () => {
  it("signal writes inside a ref callback do NOT throw and apply after flush", () => {
    const [layoutClass, setLayoutClass] = createSignal("");
    let refFired = false;

    // @solidjs/web applies refs via runWithOwner(null, ...) — unowned scope, so the
    // REACTIVE_WRITE_IN_OWNED_SCOPE dev throw (which requires an active computation
    // context) cannot fire.
    render(() => (
      <div
        ref={() => {
          refFired = true;
          setLayoutClass("ag-layout-normal");
        }}
      />
    ));

    expect(refFired).toBe(true);
    flush();
    expect(layoutClass()).toBe("ag-layout-normal");
  });

  it("the same write inside an owned scope (memo compute) DOES throw — diagnostics are armed", () => {
    expect(() =>
      createRoot((dispose) => {
        const [count, setCount] = createSignal(0);
        const bad = createMemo(() => {
          setCount(1);
          return count();
        });
        try {
          bad();
          flush();
        } finally {
          dispose();
        }
      }),
    ).toThrowError(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
  });

  it("unowned signal reads mid-flush return the stale committed value (why refs must not READ reactive props)", () => {
    // Companion finding: ref callbacks run unowned, and unowned reads return the committed
    // (pre-flush) value while tracked scopes already see the pending one. GridComp therefore
    // captures `props.context` in the component body (tracked-creation scope) instead of
    // reading it inside its ref callback. (Note: the write below is legal only because the
    // test body is unowned — inside createRoot it would throw, see the previous test.)
    const [value, setValue] = createSignal("old");
    setValue("new");
    // outside any computation, before flush: still the committed value
    expect(value()).toBe("old");
    flush();
    expect(value()).toBe("new");
  });
});

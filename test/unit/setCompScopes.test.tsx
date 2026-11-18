/* eslint-disable solid/reactivity -- these tests deliberately read/write signals outside
   tracked scopes to characterize Solid 2.0's ref-callback scope semantics */
import { render } from "@solidjs/testing-library";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  runWithOwner,
} from "solid-js";
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

    // a ref callback runs like a render effect's callback (solidjs/solid#4761, rc.22+):
    // writes are the imperative work a ref does, so REACTIVE_WRITE_IN_OWNED_SCOPE does not
    // fire there.
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
          // eslint-disable-next-line solid/no-write-in-pure-computation -- the negative control: this write must throw
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

  // EMPIRICAL (CellComp's lazy JS renderer relies on it): a ref owns nothing. An effect created
  // in the ref's own context throws, and so does onCleanup anywhere under a ref; an effect
  // inside a root created with no ambient owner is allowed, and its disposal registered in
  // the component body runs at unmount.
  it("a ref callback cannot own computations or cleanups; a detached root disposed from the body can", () => {
    const [source, setSource] = createSignal(0);
    const seen: number[] = [];
    const codes: string[] = [];
    const attempt = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        codes.push(/^\[(\w+)\]/.exec((error as Error).message)?.[1] ?? String(error));
      }
    };

    const { unmount } = render(() => {
      let disposeRoot: (() => void) | undefined;
      onCleanup(() => disposeRoot?.());
      return (
        <div
          ref={() => {
            attempt(() => createEffect(source, () => undefined));
            attempt(() => onCleanup(() => undefined));
            runWithOwner(null, () =>
              createRoot((dispose) => {
                disposeRoot = dispose;
                createEffect(source, (value) => {
                  seen.push(value);
                });
              }),
            );
          }}
        />
      );
    });
    flush();

    expect(codes).toEqual(["PRIMITIVE_IN_EFFECT_CALLBACK", "CLEANUP_IN_FORBIDDEN_SCOPE"]);
    expect(seen).toEqual([0]);
    setSource(1);
    flush();
    expect(seen).toEqual([0, 1]);

    unmount();
    setSource(2);
    flush();
    // the body-registered cleanup disposed the root: the effect no longer runs
    expect(seen).toEqual([0, 1]);
  });
});

import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  merge,
} from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GridPropGuards } from "../../src/core/asyncProps";
import {
  createGridPropGuards,
  extractGridPropertyChanges,
  snapshotGridProps,
} from "../../src/core/asyncProps";

/**
 * Focused coverage for the per-key async-prop isolation machinery (the Open question 9
 * verdict, see the block atop src/core/asyncProps.ts). The end-to-end behavior — async
 * rowData booting with the loading overlay and diffing in on resolve — is pinned by
 * test/browser/rowsCells.browser.test.tsx ("async rowData"); these tests pin the per-key
 * read semantics in isolation.
 */
describe("asyncProps (per-key isolation)", () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A props object shaped like the compiler's (a getter per passed prop) over an async rowData
   * whose promise is swapped per refetch, plus a sync `other` and an excluded `class`.
   */
  const asyncHarness = () => {
    let resolveGate!: (v: number) => void;
    let gate = new Promise<number>((r) => (resolveGate = r));
    const [ver, setVer] = createSignal(0);
    const [other, setOther] = createSignal("static");
    const diffs: Record<string, unknown>[] = [];
    let guards!: GridPropGuards;
    const dispose = createRoot((d) => {
      const data = createMemo(() => {
        ver();
        return gate;
      });
      const props = {
        get rowData() {
          return data();
        },
        get other() {
          return other();
        },
        class: "excluded",
      };
      guards = createGridPropGuards(props, new Set(["class"]));
      createEffect(
        () => snapshotGridProps(guards).values,
        (values) => {
          diffs.push(values);
        },
      );
      return d;
    });
    return {
      diffs,
      creation: () => snapshotGridProps(guards, true),
      setOther,
      resolve: (v: number) => resolveGate(v),
      refetch: () => {
        gate = new Promise<number>((r) => (resolveGate = r));
        setVer((v) => v + 1);
      },
      dispose,
    };
  };

  it("real async memo, prop-diff read: never-loaded → omitted; landed → present; refetching → omitted, other props still flow; landed → present — with no dev warning", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const h = asyncHarness();
    try {
      flush();
      await tick();
      // never loaded: rowData absent, other props not stalled; the excluded key never appears
      expect(h.diffs.at(-1)).toEqual({ other: "static" });
      h.setOther("first-load");
      flush();
      await tick();
      expect(h.diffs.at(-1)).toEqual({ other: "first-load" });

      h.resolve(1);
      await tick();
      flush();
      await tick();
      expect(h.diffs.at(-1)).toEqual({ rowData: 1, other: "first-load" });

      // refetch: while pending the key is absent — neither the held previous value nor
      // anything else (SWR: no change is applied)
      h.refetch();
      flush();
      await tick();
      expect(h.diffs.at(-1)).toEqual({ other: "first-load" });

      // the pending key does not stall the others
      h.setOther("changed");
      flush();
      await tick();
      expect(h.diffs.at(-1)).toEqual({ other: "changed" });

      h.resolve(2);
      await tick();
      flush();
      await tick();
      expect(h.diffs.at(-1)).toEqual({ rowData: 2, other: "changed" });

      // the guards read catch-free: Solid's dev build has nothing to report (CAUGHT_REACTIVE_READ
      // on rc.21 before solidjs/solid#4789's loadingValue shape)
      expect(warnSpy.mock.calls.map(([m]) => String(m))).toEqual([]);
    } finally {
      h.dispose();
    }
  });

  it("creation read (untracked): never-loaded → omitted without throwing; refetching → previous value held; keys list every guarded key", async () => {
    const h = asyncHarness();
    try {
      flush();
      await tick();
      expect(h.creation()).toEqual({ values: { other: "static" }, keys: ["rowData", "other"] });

      h.resolve(1);
      await tick();
      flush();
      await tick();
      h.refetch();
      flush();
      await tick();
      // grid creation during a refetch boots with the last landed value, not an empty grid
      expect(h.creation().values).toEqual({ rowData: 1, other: "static" });
    } finally {
      h.dispose();
    }
  });

  it("a key added to or dropped from a spread props object gains or loses its guard", () => {
    const [extra, setExtra] = createStore<Record<string, unknown>>({});
    const keyLists: string[][] = [];
    const dispose = createRoot((d) => {
      const props = merge({ rowData: [1] }, extra);
      const guards = createGridPropGuards(props, new Set());
      createEffect(
        () => snapshotGridProps(guards),
        ({ values, keys }) => {
          keyLists.push(keys);
          expect(Object.keys(values)).toEqual(keys);
        },
      );
      return d;
    });
    try {
      flush();
      setExtra((s) => {
        s.pagination = true;
      });
      flush();
      setExtra((s) => {
        delete s.pagination;
      });
      flush();
      expect(keyLists).toEqual([["rowData"], ["rowData", "pagination"], ["rowData"]]);
    } finally {
      dispose();
    }
  });

  it("a prop getter that throws a real error surfaces it (user bugs are not read as absent)", () => {
    const props = {
      get rowData(): unknown {
        throw new Error("boom");
      },
    };
    const dispose = createRoot((d) => {
      const guards = createGridPropGuards(props, new Set());
      expect(() => snapshotGridProps(guards, true)).toThrow("boom");
      return d;
    });
    dispose();
  });

  it("extractGridPropertyChanges returns only reference-changed keys", () => {
    const rowData = [1];
    const prev = { rowData, pagination: false };
    const next = { rowData, pagination: true };

    expect(extractGridPropertyChanges(prev, next, Object.keys(prev), Object.keys(next))).toEqual({
      pagination: true,
    });
  });

  it("extractGridPropertyChanges clears an event handler dropped from props; other dropped keys keep their value", () => {
    const onCellClicked = () => undefined;
    const prev = { onCellClicked, pagination: true };
    const next = {};

    // toStrictEqual: toEqual treats an undefined-valued key as absent
    expect(
      extractGridPropertyChanges(prev, next, Object.keys(prev), Object.keys(next)),
    ).toStrictEqual({ onCellClicked: undefined });
  });

  it("extractGridPropertyChanges keeps a pending event handler (omitted from the snapshot, still on props)", () => {
    const onCellClicked = () => undefined;
    const prev = { onCellClicked };
    // refetching async handler: absent from the value snapshot, present in the props key list
    const next = {};

    expect(
      extractGridPropertyChanges(prev, next, ["onCellClicked"], ["onCellClicked"]),
    ).toStrictEqual({});
  });
});

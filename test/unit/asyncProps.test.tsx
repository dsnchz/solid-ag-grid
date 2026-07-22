import { createMemo, createRoot, flush, NotReadyError } from "solid-js";
import { describe, expect, it } from "vitest";

import {
  extractGridPropertyChanges,
  readPropIfReady,
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
  it("copies a ready prop value onto the target", () => {
    const target: Record<string, unknown> = {};
    const rowData = [{ make: "Toyota" }];

    readPropIfReady({ rowData }, "rowData", target);

    expect(target.rowData).toBe(rowData);
  });

  it("omits a key whose read throws NotReadyError (pending async prop)", () => {
    const props = {
      get rowData(): unknown {
        throw new NotReadyError(undefined);
      },
    };
    const target: Record<string, unknown> = {};

    expect(() => readPropIfReady(props, "rowData", target)).not.toThrow();
    expect("rowData" in target).toBe(false);
  });

  it("omits a key whose read throws the dev-mode PENDING_ASYNC_UNTRACKED_READ plain Error", () => {
    const props = {
      get rowData(): unknown {
        // dev builds throw a plain Error carrying this diagnostic code (not NotReadyError)
        // for untracked pending reads — the grid-creation read path
        throw new Error(
          "[PENDING_ASYNC_UNTRACKED_READ] Reading a pending async value directly in an untracked scope.",
        );
      },
    };
    const target: Record<string, unknown> = {};

    expect(() => readPropIfReady(props, "rowData", target)).not.toThrow();
    expect("rowData" in target).toBe(false);
  });

  it("rethrows errors that are not not-ready signals (user getter bugs must surface)", () => {
    const props = {
      get rowData(): unknown {
        throw new Error("boom");
      },
    };

    expect(() => readPropIfReady(props, "rowData", {})).toThrow("boom");
  });

  it("viaLatest: a pending async prop reads as undefined (no throw), then resolves (creation-time path)", async () => {
    let resolvePromise!: (value: string[]) => void;
    const promise = new Promise<string[]>((resolve) => (resolvePromise = resolve));

    const { dispose, data } = createRoot((d) => {
      const pendingData = createMemo(() => promise);
      return { dispose: d, data: pendingData };
    });

    try {
      const props = {
        get rowData() {
          return data();
        },
      };

      // pending: latest() bypasses the pending-link machinery — the read yields undefined
      // rather than suspending or linking, so the grid boots with "no rowData yet" (loading
      // overlay), never a throw out of the boot path. Contrast: a direct (non-latest)
      // untracked read of the same pending memo throws.
      const before: Record<string, unknown> = {};
      expect(() => readPropIfReady(props, "rowData", before, true)).not.toThrow();
      expect(before.rowData).toBeUndefined();
      expect(() => readPropIfReady(props, "rowData", {})).not.toThrow();

      resolvePromise(["ready"]);
      await promise;
      flush();

      // resolved: the same viaLatest read now yields the value
      const after: Record<string, unknown> = {};
      readPropIfReady(props, "rowData", after, true);
      expect(after.rowData).toEqual(["ready"]);
    } finally {
      dispose();
    }
  });

  it("snapshotGridProps skips excluded keys and omits not-ready keys, keeping the rest", () => {
    const props = {
      rowData: [1, 2],
      class: "my-grid",
      get columnDefs(): unknown {
        throw new NotReadyError(undefined);
      },
    };

    const snapshot = snapshotGridProps(props, new Set(["class"]));

    expect(snapshot).toEqual({ rowData: [1, 2] });
  });

  it("extractGridPropertyChanges returns only reference-changed keys", () => {
    const rowData = [1];
    const prev = { rowData, pagination: false };
    const next = { rowData, pagination: true };

    expect(extractGridPropertyChanges(prev, next)).toEqual({ pagination: true });
  });
});

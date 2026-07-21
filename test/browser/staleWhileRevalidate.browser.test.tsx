// Pins the stale-while-revalidate contract for async rowData (ROADMAP T4 docs):
// a REFETCH (async prop pending again) must keep the previous rows visible — the
// pending key is omitted from the prop-diff snapshot, so no change is applied until
// the new data resolves. Initial load shows the loading overlay; revalidation never
// blanks the grid. This is promoted from emergent behavior to guaranteed contract.
import { render } from "@solidjs/testing-library";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createMemo, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly a: string };

describe("async rowData stale-while-revalidate", () => {
  it("keeps previous rows visible during a refetch, then swaps on resolve", async () => {
    const [generation, setGeneration] = createSignal(1);
    let release!: (rows: Row[]) => void;

    const rows = createMemo(async () => {
      const gen = generation();
      if (gen === 1) {
        return [{ a: "first" }];
      }
      return new Promise<Row[]>((resolve) => {
        release = resolve;
      });
    });

    const { container } = render(() => (
      <div style={{ height: "300px" }}>
        <AgGridSolid columnDefs={[{ field: "a" }]} rowData={rows()} />
      </div>
    ));

    // initial load resolves synchronously-ish; wait for first-generation rows
    await vi.waitFor(() => {
      expect(container.textContent).toContain("first");
    });

    // trigger refetch: memo re-runs, promise stays pending
    setGeneration(2);
    flush();
    await new Promise((r) => setTimeout(r, 50));

    // CONTRACT: previous rows still visible, no overlay, no blanking
    expect(container.textContent).toContain("first");
    expect(container.querySelector(".ag-overlay-loading-center")).toBeNull();

    // resolve the refetch; new rows swap in
    release([{ a: "second" }]);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("second");
      expect(container.textContent).not.toContain("first");
    });
  });
});

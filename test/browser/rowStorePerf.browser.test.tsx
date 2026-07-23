// rowStore adapter perf probe: 10k-row store through <AgGridSolid rowStore>, timing the two
// user-felt single-row paths the delta capture optimizes — a field update on one row and a
// single-row add. INFORMATIONAL — absolute timings go to the console (console.warn: the vite
// client-log bridge only forwards warn/error to the terminal); assertions are
// correctness-only, no thresholds (CI timing variance would make gates flaky). Note the
// field-update number includes AG Grid's applyTransactionAsync batching window (~50ms
// default) — it measures the user-felt store-write→painted-cell latency, not adapter CPU.
import { render } from "@solidjs/testing-library";
import type { GridApi } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
// eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
import { createStore } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly id: string; name: string; qty: number };

const ROWS = 10_000;

const buildRows = (): Row[] =>
  Array.from({ length: ROWS }, (_, i) => ({ id: `r${i}`, name: `row-${i}`, qty: i }));

const columnDefs = [
  { field: "name" as const, width: 200 },
  { field: "qty" as const, width: 120 },
];
const getRowId = (params: { data: Row }) => params.data.id;

const waitFor = async (cond: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
};

const cellText = (root: Element, rowId: string, colId: string): string | undefined =>
  root.querySelector(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`)?.textContent?.trim();

describe("rowStore adapter perf (10k rows, informational)", () => {
  it("single-row field update and single-row add: absolute latency + surgical DOM", async () => {
    const [store, setStore] = createStore<Row[]>(buildRows());
    let api!: GridApi<Row>;
    const host = document.createElement("div");
    host.style.cssText = "height:500px;width:600px";
    document.body.appendChild(host);
    const { unmount } = render(
      () => (
        <AgGridSolid
          containerStyle={{ height: "500px", width: "600px" }}
          columnDefs={columnDefs}
          rowStore={store}
          getRowId={getRowId}
          ref={(r) => {
            api = r.api;
          }}
        />
      ),
      { container: host },
    );
    await waitFor(() => host.querySelectorAll(".ag-row").length > 3);
    await waitFor(() => api.getDisplayedRowCount() === ROWS);

    // identity baseline: every rendered row element + one cell element per row
    const domBefore = new Map<string, { row: HTMLElement; cells: HTMLElement[] }>();
    for (const row of host.querySelectorAll<HTMLElement>(".ag-row")) {
      const rowId = row.getAttribute("row-id");
      if (rowId !== null) {
        domBefore.set(rowId, { row, cells: [...row.querySelectorAll<HTMLElement>(".ag-cell")] });
      }
    }
    // target a rendered row that is NOT the add site (adds go to index 0 below)
    const targetId = [...domBefore.keys()].find((id) => id !== "r0")!;

    // ---- single-row field update: store write → painted cell ----
    const t0 = performance.now();
    setStore((draft) => {
      draft[Number(targetId.slice(1))]!.qty = 777_777;
    });
    await waitFor(() => cellText(host, targetId, "qty") === "777777");
    const fieldUpdateMs = Math.round(performance.now() - t0);

    // correctness: the right row updated (grid node data confirms the store round-trip)
    expect(cellText(host, targetId, "qty")).toBe("777777");
    expect(api.getRowNode(targetId)?.data?.qty).toBe(777_777);
    // ...and every OTHER rendered row's DOM is untouched by element identity (row element
    // and its cell elements are the same nodes — no collateral re-render)
    for (const [rowId, before] of domBefore) {
      if (rowId === targetId) {
        continue;
      }
      const row = host.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"]`);
      expect(row, `row ${rowId} disappeared`).toBe(before.row);
      const cells = [...row!.querySelectorAll<HTMLElement>(".ag-cell")];
      expect(cells, `cells re-created for row ${rowId}`).toEqual(before.cells);
    }
    // even the updated row keeps its row/cell elements — AG Grid refreshes cell CONTENT
    const targetRowAfter = host.querySelector<HTMLElement>(`.ag-row[row-id="${targetId}"]`);
    expect(targetRowAfter).toBe(domBefore.get(targetId)!.row);

    // ---- single-row add (prepend — the visible position): store write → painted row ----
    const t1 = performance.now();
    setStore((draft) => {
      draft.unshift({ id: "added", name: "brand-new", qty: -1 });
    });
    await waitFor(() => host.querySelector('.ag-row[row-id="added"]') !== null);
    const addMs = Math.round(performance.now() - t1);

    // correctness: the new row is first, with the right data
    expect(cellText(host, "added", "name")).toBe("brand-new");
    expect(api.getDisplayedRowCount()).toBe(ROWS + 1);
    expect(api.getDisplayedRowAtIndex(0)?.data?.id).toBe("added");
    // surviving rendered rows keep their element identity across the add
    for (const [rowId, before] of domBefore) {
      const row = host.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"]`);
      if (row !== null) {
        expect(row, `row ${rowId} re-created by the add`).toBe(before.row);
      }
    }

    // informational benchmark output (warn: the vite bridge forwards warn/error only)
    console.warn(
      `PERF [rowStore 10k] single-row field update (store write → painted cell, incl. ` +
        `applyTransactionAsync batching): ${fieldUpdateMs}ms; single-row add (store write → ` +
        `painted row): ${addMs}ms`,
    );

    unmount();
    host.remove();
  }, 120_000);
});

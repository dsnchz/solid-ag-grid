// REACTIVE GRAPH BUDGET — "what can be derived, should be derived" (ARCHITECTURE §5.1) made
// measurable. Walks Solid's dev-only owner tree (DEV.getChildren / DEV.getSignals) under mounted
// grids and derives the MARGINAL reactive-node cost of one row and one cell by differencing grid
// sizes (header cells scale with columns, so rows are differenced at two column counts). The
// budget is an upper bound: a change that adds effects/memos/Show branches to the per-cell or
// per-row mount fails here before it shows up as scroll jank. Runs on the dev build (unit
// project); prod has no DEV. Baseline recorded in the constants below.
import { render } from "@solidjs/testing-library";
import type { ColDef, GridApi } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createRoot, DEV, getOwner } from "solid-js";
import { describe, expect, it } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Owner = NonNullable<ReturnType<typeof getOwner>>;
type Dev = {
  getChildren: (o: Owner) => Owner[];
  getSignals: (o: Owner) => unknown[];
};
const dev = DEV as unknown as Dev;

const countGraph = (owner: Owner): { computations: number; signals: number } => {
  let computations = 0;
  let signals = dev.getSignals(owner).length;
  for (const child of dev.getChildren(owner)) {
    computations++;
    const inner = countGraph(child);
    computations += inner.computations;
    signals += inner.signals;
  }
  return { computations, signals };
};

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

/** Mounts a rows x cols grid under an owner we control and returns the settled graph size. */
const measure = async (rows: number, cols: number) => {
  const columnDefs: ColDef[] = Array.from({ length: cols }, (_, c) => ({ field: `f${c}` }));
  const rowData = Array.from({ length: rows }, (_, r) => {
    const row: Record<string, number | string> = { id: String(r) };
    for (let c = 0; c < cols; c++) row[`f${c}`] = r * cols + c;
    return row;
  });
  let owner!: Owner;
  let api: GridApi | undefined;
  let unmount!: () => void;
  let container!: HTMLElement;
  const dispose = createRoot((d) => {
    owner = getOwner()!;
    const rendered = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "800px" }}
        columnDefs={columnDefs}
        rowData={rowData}
        getRowId={(p) => String(p.data.id)}
        ref={(r: AgGridSolidRef) => (api = r.api)}
      />
    ));
    unmount = rendered.unmount;
    container = rendered.container;
    return d;
  });
  await waitFor(
    () =>
      api != null &&
      container.querySelectorAll(".ag-row .ag-cell").length === rows * cols &&
      container.querySelectorAll(".ag-header-cell").length === cols,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const size = countGraph(owner);
  unmount();
  dispose();
  return size;
};

// HISTORY (solid-js 2.0.0-rc.7):
//   2026-09-09 before the per-cell diet: cell 41 computations / 11 signals, row 40 / 11
//   2026-09-09 after  the per-cell diet: cell 26 / 10, row 34 / 11
//     (editor effect, tool-widget effect and refresh bridge scoped to their branches; editing
//      classes event-driven; inner wrapper Show + raw-value Show + showTools memo + per-cell
//      context lookup removed; row full-width effects gated on the per-ctrl constants)
// The budget is the CEILING the implementation must stay under — the counts are deterministic,
// so it is pinned exactly. Tighten it when the mount gets cheaper; never raise it without a
// design note in ARCHITECTURE.md.
//   2026-09-09 imperative attribute/style writes: cell 25 / 9, row 32 / 5
//     (row-index, row-id, row-business-key, top, transform, user row/cell styles: setter →
//      DOM, like vanilla; static initial attributes)
//   2026-09-09 lazy JS-renderer machinery + JS element on the framework fallback: cell 23 / 9
const BUDGET = {
  cell: { computations: 23, signals: 9 },
  row: { computations: 32, signals: 5 },
};

describe("reactive graph budget (dev owner-tree walk)", () => {
  it("marginal reactive nodes per cell and per row stay within budget", async () => {
    // sequential: each measurement owns the document
    const r1c5 = await measure(1, 5);
    const r3c5 = await measure(3, 5);
    const r1c10 = await measure(1, 10);
    const r3c10 = await measure(3, 10);
    // per row at C columns = row + C * cell
    const perRow5 = {
      computations: (r3c5.computations - r1c5.computations) / 2,
      signals: (r3c5.signals - r1c5.signals) / 2,
    };
    const perRow10 = {
      computations: (r3c10.computations - r1c10.computations) / 2,
      signals: (r3c10.signals - r1c10.signals) / 2,
    };
    const cell = {
      computations: (perRow10.computations - perRow5.computations) / 5,
      signals: (perRow10.signals - perRow5.signals) / 5,
    };
    const row = {
      computations: perRow5.computations - 5 * cell.computations,
      signals: perRow5.signals - 5 * cell.signals,
    };
    console.info(
      `GRAPH per cell: ${cell.computations} computations / ${cell.signals} signals | per row: ${row.computations} computations / ${row.signals} signals`,
    );
    expect(cell.computations).toBeLessThanOrEqual(BUDGET.cell.computations);
    expect(cell.signals).toBeLessThanOrEqual(BUDGET.cell.signals);
    expect(row.computations).toBeLessThanOrEqual(BUDGET.row.computations);
    expect(row.signals).toBeLessThanOrEqual(BUDGET.row.signals);
  }, 30_000);
});

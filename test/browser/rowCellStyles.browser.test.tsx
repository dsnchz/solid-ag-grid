// Core-jurisdiction attributes as imperative writes (per-row/per-cell diet): row-index, row-id,
// row-business-key, top/transform and user row/cell styles are written by the compProxy setter
// directly, like vanilla. Parity oracle: every attribute/style compared with vanilla at mount,
// after a data update that changes styles, after a sort (row-index moves) and after a scroll
// (top/transform move).
import { render } from "@solidjs/testing-library";
import type { CellStyle, GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; make: string; price: number };
const rowData = (): Row[] =>
  Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, make: `M${i}`, price: (i * 37) % 100 }));

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

const options = (): GridOptions<Row> => ({
  columnDefs: [
    { field: "make", cellStyle: { fontStyle: "italic" } },
    {
      field: "price",
      cellStyle: (p): CellStyle =>
        p.value > 50
          ? { color: "rgb(200, 0, 0)", fontWeight: "bold" }
          : { color: "rgb(0, 0, 200)" },
    },
  ],
  rowData: rowData(),
  getRowId: (p) => p.data.id,
  getBusinessKeyForNode: (node) => node.data?.make ?? "",
  rowStyle: { letterSpacing: "1px" },
  getRowStyle: (p) =>
    p.data && p.data.price > 50 ? { background: "rgb(240, 240, 200)" } : undefined,
});

const mountVanilla = (o: GridOptions<Row>) => {
  const container = document.createElement("div");
  container.style.cssText = "height:300px;width:600px";
  document.body.appendChild(container);
  const api = createGrid(container, o);
  return {
    container,
    api,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
};
const mountSolid = (o: GridOptions<Row>) => {
  let apiRef: AgGridSolidRef<Row> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...o}
      ref={(r: AgGridSolidRef<Row>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<Row> };
};

/** Everything the imperative writes touch, for the first N rendered rows, keyed by row-id. */
const snapshot = (root: Element) => {
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>(".ag-center-cols-container .ag-row, .ag-row"),
  )
    .filter((r) => r.querySelector(".ag-cell"))
    .sort((a, b) => Number(a.getAttribute("row-index")) - Number(b.getAttribute("row-index")));
  return rows.map((row) => ({
    id: row.getAttribute("row-id"),
    index: row.getAttribute("row-index"),
    businessKey: row.getAttribute("row-business-key"),
    top: row.style.top,
    transform: row.style.transform,
    letterSpacing: row.style.letterSpacing,
    background: row.style.background,
    cells: Array.from(row.querySelectorAll<HTMLElement>(".ag-cell")).map((c) => ({
      col: c.getAttribute("col-id"),
      fontStyle: c.style.fontStyle,
      color: c.style.color,
      fontWeight: c.style.fontWeight,
    })),
  }));
};

describe("row/cell attributes and styles vs vanilla (imperative writes)", () => {
  it("mount, style-changing data update, sort and scroll all match vanilla", async () => {
    const vanilla = mountVanilla(options());
    const solid = mountSolid(options());
    await waitFor(
      () =>
        solid.api() != null &&
        solid.container.querySelector('.ag-row[row-id="r0"] .ag-cell') != null,
    );
    await waitFor(() => vanilla.container.querySelector('.ag-row[row-id="r0"] .ag-cell') != null);
    await settle();
    const s0 = snapshot(solid.container);
    expect(s0.length).toBeGreaterThan(5);
    expect(s0[0]!.letterSpacing).toBe("1px");
    expect(s0).toEqual(snapshot(vanilla.container));

    // data update flips the conditional row + cell styles (additive semantics like vanilla:
    // keys never removed, only rewritten)
    const flipped = rowData().map((r) => ({ ...r, price: 100 - r.price }));
    solid.api().setGridOption("rowData", flipped);
    vanilla.api.setGridOption("rowData", flipped);
    await settle();
    await waitFor(
      () =>
        solid.container.querySelector<HTMLElement>('.ag-row[row-id="r0"] .ag-cell[col-id="price"]')
          ?.textContent === String(100 - 0),
    );
    expect(snapshot(solid.container)).toEqual(snapshot(vanilla.container));

    // sort moves row-index (and top/transform) — attributes must follow
    solid.api().applyColumnState({ state: [{ colId: "price", sort: "desc" }] });
    vanilla.api.applyColumnState({ state: [{ colId: "price", sort: "desc" }] });
    await settle();
    await waitFor(
      () =>
        solid.container.querySelector('.ag-row[row-index="0"]')?.getAttribute("row-id") ===
        vanilla.container.querySelector('.ag-row[row-index="0"]')?.getAttribute("row-id"),
    );
    expect(snapshot(solid.container)).toEqual(snapshot(vanilla.container));

    // scroll: new rows mount with initial top/transform, existing ones are re-positioned
    solid.api().ensureIndexVisible(45);
    vanilla.api.ensureIndexVisible(45);
    await settle();
    await waitFor(() => solid.container.querySelector('.ag-row[row-index="45"] .ag-cell') != null);
    await waitFor(
      () => vanilla.container.querySelector('.ag-row[row-index="45"] .ag-cell') != null,
    );
    await settle();
    expect(snapshot(solid.container)).toEqual(snapshot(vanilla.container));

    vanilla.destroy();
    solid.unmount();
  });
});

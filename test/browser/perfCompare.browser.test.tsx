// Comparative perf harness: identical GridOptions through our Solid renderer and
// vanilla createGrid, timing the operations users feel. INFORMATIONAL — numbers go
// to the console (vitest surfaces them); assertions are sanity-only, no thresholds
// (CI timing variance would make gates flaky). Two shapes: TALL stresses vertical
// virtualization; WIDE (100 cols) stresses horizontal virtualization + per-cell
// comp creation, the layer the port rewrites.
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Shape = { readonly name: string; readonly rows: number; readonly cols: number };
const TALL: Shape = { name: "tall 100k x 10", rows: 100_000, cols: 10 };
const WIDE: Shape = { name: "wide 20k x 100", rows: 20_000, cols: 100 };

const buildData = ({ rows, cols }: Shape) => {
  const fields = Array.from({ length: cols }, (_, c) => `f${c}`);
  const data = Array.from({ length: rows }, (_, r) => {
    // dedicated stable id — NEVER touched by update transactions (getRowId key)
    const row: Record<string, number> = { id: r };
    for (let c = 0; c < cols; c++) row[fields[c]!] = r * cols + c;
    return row;
  });
  return { columnDefs: fields.map((field) => ({ field, width: 120 })), rowData: data };
};

const paint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const timed = async (
  label: string,
  out: Record<string, number>,
  fn: () => void | Promise<void>,
) => {
  const t0 = performance.now();
  await fn();
  await paint();
  out[label] = Math.round(performance.now() - t0);
};

async function bench(shape: Shape, renderer: "solid" | "vanilla") {
  const { columnDefs, rowData } = buildData(shape);
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);

  let api!: GridApi;
  const out: Record<string, number> = {};
  const options: GridOptions = { columnDefs, rowData, getRowId: (p) => String(p.data.id) };

  await timed("initial render", out, async () => {
    if (renderer === "vanilla") {
      api = createGrid(host, options);
    } else {
      render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
    }
    await new Promise<void>((r) => {
      const poll = () => (host.querySelector(".ag-cell") ? r() : setTimeout(poll, 5));
      poll();
    });
  });
  await timed("scroll to mid row", out, () => api.ensureIndexVisible(Math.floor(shape.rows / 2)));
  await timed("scroll to last row", out, () => api.ensureIndexVisible(shape.rows - 1));
  await timed("scroll to last col", out, () =>
    api.ensureColumnVisible(`f${shape.cols - 1}`, "end"),
  );
  await timed("full refresh (force)", out, () => api.refreshCells({ force: true }));
  await timed("txn burst 500 updates", out, async () => {
    const update = Array.from({ length: 500 }, (_, i) => {
      const row: Record<string, number> = { id: i };
      for (let c = 0; c < shape.cols; c++) row[`f${c}`] = -i;
      return row;
    });
    await new Promise<void>((r) => api.applyTransactionAsync({ update }, () => r()));
  });

  const alive = api.getDisplayedRowCount() === shape.rows;
  api.destroy?.();
  host.remove();
  return { out, alive };
}

describe("perf comparison: Solid vs vanilla rendering", () => {
  for (const shape of [TALL, WIDE]) {
    it(`${shape.name}`, async () => {
      const solid = await bench(shape, "solid");
      const vanilla = await bench(shape, "vanilla");

      const labels = Object.keys(solid.out);
      const table = labels.map((l) => ({
        op: l,
        solid_ms: solid.out[l],
        vanilla_ms: vanilla.out[l],
        ratio: Number((solid.out[l]! / Math.max(1, vanilla.out[l]!)).toFixed(2)),
      }));
      // console.warn — the vite client-log bridge only forwards warn/error to the terminal
      for (const row of table) {
        // eslint-disable-next-line no-console -- informational benchmark output
        console.warn(
          `PERF [${shape.name}] ${row.op}: solid ${row.solid_ms}ms vs vanilla ${row.vanilla_ms}ms (x${row.ratio})`,
        );
      }

      expect(solid.alive).toBe(true);
      expect(vanilla.alive).toBe(true);
    }, 120_000);
  }
});

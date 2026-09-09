// BOOT LATENCY: render() → first cell in the DOM, Solid vs vanilla, on a SMALL grid so the
// grid core's row-model work is negligible and the number isolates what the port adds — the
// mount of the viewport's row/cell components (21 rows x 10 cols here). The paint-to-paint
// comparison harness cannot see this: it sits under its two-rAF floor. INFORMATIONAL — numbers
// go to the console; the assertion is sanity-only.
// Baseline 2026-09-09 (rc.7, prod posture, M-series, headless Chromium): solid ~7.5-8.5 ms vs
// vanilla ~5.8-6.5 ms median; the delta is the viewport mount (~15-25 µs per cell vs vanilla's
// ~10 µs), spread across per-cell effects/memos/Show/context reads — no single hotspot
// (CDP profile: test/browser/perfProfile.browser.test.tsx).
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROWS = 1_000;
const COLS = 10;
const build = () => {
  const fields = Array.from({ length: COLS }, (_, c) => `f${c}`);
  const data = Array.from({ length: ROWS }, (_, r) => {
    const row: Record<string, number> = { id: r };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = r * COLS + c;
    return row;
  });
  return { columnDefs: fields.map((field) => ({ field, width: 120 })), rowData: data };
};

async function firstCellMs(renderer: "solid" | "vanilla") {
  const { columnDefs, rowData } = build();
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);
  let api!: GridApi;
  const options: GridOptions = { columnDefs, rowData, getRowId: (p) => String(p.data.id) };
  // MutationObserver: exact insertion time, no poll granularity
  const firstCell = new Promise<number>((resolve) => {
    const mo = new MutationObserver(() => {
      if (host.querySelector(".ag-cell")) {
        resolve(performance.now());
        mo.disconnect();
      }
    });
    mo.observe(host, { childList: true, subtree: true });
  });
  const t0 = performance.now();
  if (renderer === "vanilla") api = createGrid(host, options);
  else render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  const ms = (await firstCell) - t0;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const cells = host.querySelectorAll(".ag-cell").length;
  api.destroy?.();
  host.remove();
  return { ms, cells };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

describe("boot latency: render() → first cell (1k rows, viewport mount isolated)", () => {
  it("Solid vs vanilla, median and p95 of 9 alternating runs after warmup", async () => {
    await firstCellMs("solid");
    await firstCellMs("vanilla");
    const samples = { solid: [] as number[], vanilla: [] as number[] };
    let cells = 0;
    for (let i = 0; i < 9; i++) {
      for (const r of i % 2 === 0
        ? (["solid", "vanilla"] as const)
        : (["vanilla", "solid"] as const)) {
        const out = await firstCellMs(r);
        samples[r].push(out.ms);
        cells = out.cells;
        expect(out.cells).toBeGreaterThan(0);
      }
    }
    console.warn(
      `PERF [boot 1k x 10, ${cells} cells] first cell: solid ${median(samples.solid).toFixed(1)}ms (p95 ${p95(samples.solid).toFixed(1)}) vs vanilla ${median(samples.vanilla).toFixed(1)}ms (p95 ${p95(samples.vanilla).toFixed(1)}) [n=9, median]`,
    );
  }, 120_000);
});

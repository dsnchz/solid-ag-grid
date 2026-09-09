// Comparative perf harness: identical GridOptions through our Solid renderer and
// vanilla createGrid, timing the operations users feel. INFORMATIONAL — numbers go
// to the console (vitest surfaces them); assertions are sanity-only, no thresholds
// (CI timing variance would make gates flaky). Two shapes: TALL stresses vertical
// virtualization; WIDE (100 cols) stresses horizontal virtualization + per-cell
// comp creation, the layer the port rewrites.
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

// HARNESS RESOLUTION (2026-09-09): every op reports two numbers.
// - cpu: performance.now() around the call PLUS an explicit reactive settle (flush() + one
//   microtask) — Solid's DOM work lands there, vanilla's is synchronous, so both sides' DOM work
//   is inside this window and NOTHING else is (no rAF wait, no layout/paint). This is the number that can see renderer
//   cost: the paint-to-paint figure sits on a two-rAF floor (~17 ms) that hides anything smaller.
// - wall: cpu + two rAFs (what the user perceives; kept for continuity with earlier baselines).
// Stats: median, p95 and worst over ITERATIONS alternating runs after a discarded first
// iteration per renderer (cold JIT/GC); document visibility asserted (hidden tabs suspend rAF).
// "row swap" is the hot path the per-cell diet targets: SWAPS jumps of ensureIndexVisible, each
// replacing the whole viewport; reported per swap.

type Shape = { readonly name: string; readonly rows: number; readonly cols: number };
const TALL: Shape = { name: "tall 100k x 10", rows: 100_000, cols: 10 };
const WIDE: Shape = { name: "wide 20k x 100", rows: 20_000, cols: 100 };
const ITERATIONS = 7;
const SWAPS = 20;

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

// settle the reactive graph synchronously: Solid's auto-flush is a CHAIN of microtasks (a
// single queued microtask lands between its stages and misses the DOM work — proven by the
// row-swap assertion below), so the harness calls flush() explicitly (the flushSync stand-in;
// a no-op for vanilla) and then drains one microtask for anything queued by the flush itself
const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};
const paint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

type Sample = { cpu: number; wall: number };
type Out = Record<string, Sample>;

const timed = async (label: string, out: Out, fn: () => void | Promise<void>) => {
  const t0 = performance.now();
  await fn();
  await settle();
  const cpu = performance.now() - t0;
  await paint();
  out[label] = { cpu, wall: performance.now() - t0 };
};

async function bench(shape: Shape, renderer: "solid" | "vanilla") {
  const { columnDefs, rowData } = buildData(shape);
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);

  let api!: GridApi;
  const out: Out = {};
  // suppressAnimationFrame: the grid otherwise spreads row creation over animation frames on
  // scroll, which the CPU window cannot see; identical semantics for both renderers
  const options: GridOptions = {
    columnDefs,
    rowData,
    getRowId: (p) => String(p.data.id),
    suppressAnimationFrame: true,
  };
  // ensureIndexVisible only sets scrollTop — the grid swaps rows in its scroll-event handler,
  // which the browser fires on the NEXT frame. Dispatching the event ourselves runs that
  // handler synchronously so the swap lands inside the CPU window (proven by the assertion
  // in the row-swap loop; without this the window measured only the scrollTop write).
  const scrollTo = (index: number) => {
    api.ensureIndexVisible(index);
    host.querySelector(".ag-body-viewport")?.dispatchEvent(new Event("scroll"));
  };

  await timed("initial render", out, async () => {
    // first .ag-cell insertion observed exactly (no poll granularity)
    const firstCell = new Promise<void>((resolve) => {
      const mo = new MutationObserver(() => {
        if (host.querySelector(".ag-cell")) {
          resolve();
          mo.disconnect();
        }
      });
      mo.observe(host, { childList: true, subtree: true });
    });
    if (renderer === "vanilla") {
      api = createGrid(host, options);
    } else {
      render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
    }
    await firstCell;
  });
  await timed("scroll to mid row", out, () => scrollTo(Math.floor(shape.rows / 2)));
  await timed("scroll to last row", out, () => scrollTo(shape.rows - 1));
  await timed("scroll to last col", out, () =>
    api.ensureColumnVisible(`f${shape.cols - 1}`, "end"),
  );
  await timed("full refresh (force)", out, () => api.refreshCells({ force: true }));
  // per-swap cost of replacing the whole viewport — the path every scroll frame runs
  {
    const stride = Math.floor(shape.rows / (SWAPS + 1));
    let cpu = 0;
    for (let i = 1; i <= SWAPS; i++) {
      const target = i * stride;
      const t0 = performance.now();
      scrollTo(target);
      await settle();
      cpu += performance.now() - t0;
      // PROOF the CPU window contains the swap: the target row's cells are in the DOM already
      // (Solid's flush is synchronous on the scroll path or lands in the drained microtask;
      // vanilla's is synchronous). A miss would mean deferred work escaped the measurement.
      expect(
        host.querySelector(`.ag-row[row-index="${target}"] .ag-cell`),
        `${renderer}: row ${target} not mounted within the CPU window`,
      ).not.toBeNull();
    }
    await paint();
    out["row swap (per swap)"] = { cpu: cpu / SWAPS, wall: Number.NaN };
  }
  const update = Array.from({ length: 500 }, (_, i) => {
    const row: Record<string, number> = { id: i };
    for (let c = 0; c < shape.cols; c++) row[`f${c}`] = -i;
    return row;
  });
  await timed("txn 500 updates (sync)", out, () => {
    api.applyTransaction({ update });
  });
  await timed("txn burst 500 updates (async)", out, async () => {
    await new Promise<void>((r) => api.applyTransactionAsync({ update }, () => r()));
  });

  const alive = api.getDisplayedRowCount() === shape.rows;
  api.destroy?.();
  host.remove();
  return { out, alive };
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => sorted(xs)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]!;
const worst = (xs: number[]) => sorted(xs)[xs.length - 1]!;
const fmt = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(1));

// Objectivity measures: (1) warmup pass for BOTH renderers before any measurement (cold JIT
// would penalize whichever runs first); (2) ITERATIONS alternating order per iteration so
// neither renderer systematically runs on a warmer engine; (3) the first measured iteration
// per renderer is DISCARDED (first-run-of-a-fresh-shape effects); (4) median AND p95/worst
// per op — a spike that hides in medians is exactly what a scroll user feels.
const WARMUP: Shape = { name: "warmup", rows: 200, cols: 5 };

describe("perf comparison: Solid vs vanilla rendering", () => {
  it("harness posture", () => {
    expect(document.visibilityState).toBe("visible");
  });

  for (const shape of [TALL, WIDE]) {
    it(`${shape.name}`, async () => {
      await bench(WARMUP, "solid");
      await bench(WARMUP, "vanilla");

      const samples: Record<string, { solid: Sample[]; vanilla: Sample[] }> = {};
      for (let i = 0; i < ITERATIONS + 1; i++) {
        const order: ("solid" | "vanilla")[] =
          i % 2 === 0 ? ["solid", "vanilla"] : ["vanilla", "solid"];
        for (const renderer of order) {
          const { out, alive } = await bench(shape, renderer);
          expect(alive).toBe(true);
          if (i === 0) continue; // discarded
          for (const [op, sample] of Object.entries(out)) {
            (samples[op] ??= { solid: [], vanilla: [] })[renderer].push(sample);
          }
        }
      }

      // console.warn — the vite client-log bridge only forwards warn/error to the terminal
      for (const [op, s] of Object.entries(samples)) {
        const sc = s.solid.map((x) => x.cpu);
        const vc = s.vanilla.map((x) => x.cpu);
        const sw = s.solid.map((x) => x.wall);
        const vw = s.vanilla.map((x) => x.wall);
        const ratio = (median(sc) / Math.max(0.05, median(vc))).toFixed(2);
        console.warn(
          `PERF [${shape.name}] ${op}: CPU solid ${fmt(median(sc))} (p95 ${fmt(p95(sc))}, worst ${fmt(worst(sc))}) vs vanilla ${fmt(median(vc))} (p95 ${fmt(p95(vc))}, worst ${fmt(worst(vc))}) ms (x${ratio}) | wall solid ${fmt(median(sw))} vs vanilla ${fmt(median(vw))} [n=${ITERATIONS}]`,
        );
      }
    }, 600_000);
  }
});

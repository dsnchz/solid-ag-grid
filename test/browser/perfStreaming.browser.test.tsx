// STREAMING benchmark (perf project, prod posture): the cost of a value tick reaching a
// CUSTOM cell renderer, Solid vs vanilla. Every column carries a user renderer; each tick
// updates 500 rows (the visible viewport among them) through a sync transaction, so every
// visible cell's renderer receives new params. Two renderer shapes:
// - lean: reads `value` only (one text insert).
// - rich: reads value, valueFormatted, data, node and column — the shape real renderers have,
//   and the shape where the params spread re-fires readers of props that did not change.
// The vanilla side is the equivalent JS class renderer with an in-place refresh().
// INFORMATIONAL — console.warn output, sanity assertions only. Written to decide the "per-key
// equality cut for pushed renderer props" question; the cut only pays if the rich shape's
// per-tick CPU gap over vanilla is dominated by the spread's re-fires.
// VERDICT (2026-09-09): NO CUT. Rich costs Solid 0.2–0.3 ms/tick over lean (200 visible cells),
// and a memo-per-primitive-key cut measured as a no-op (lean 2.4 → 2.5, rich 2.7 → 2.7 ms).
// perfStreamProfile showed the gap elsewhere: ~0.2 ms/tick of per-row resize-drain timers in
// RenderStatusService (now coalesced: lean x1.50 → x1.29, rich x1.59 → x1.41) and the rest in
// Solid's scheduler + (program) time at ~2 µs per refreshed cell.
import { render } from "@solidjs/testing-library";
import type {
  GridApi,
  GridOptions,
  ICellRendererComp,
  ICellRendererParams,
} from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROWS = 20_000;
const COLS = 10;
const ITERATIONS = 7;
const TICKS = 20;
const UPDATE_ROWS = 500;

type Row = Record<string, number>;
type Shape = "lean" | "rich";
type Renderer = "solid" | "vanilla";

const fields = Array.from({ length: COLS }, (_, c) => `f${c}`);
const buildRows = (): Row[] =>
  Array.from({ length: ROWS }, (_, r) => {
    const row: Row = { id: r };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = r * COLS + c;
    return row;
  });

const richText = (p: ICellRendererParams<Row, number>) =>
  `${p.value}|${p.valueFormatted ?? ""}|${p.data?.id}|${p.node.rowIndex}|${p.column?.getColId()}`;

// Solid renderers: plain function components (the port detects them by shape)
const SolidLean = (p: ICellRendererParams<Row, number>) => <span class="r">{p.value}</span>;
const SolidRich = (p: ICellRendererParams<Row, number>) => <span class="r">{richText(p)}</span>;

// vanilla renderers: refresh() in place, same text
const jsRenderer = (shape: Shape) =>
  class implements ICellRendererComp<Row> {
    private eGui = document.createElement("span");
    init(p: ICellRendererParams<Row, number>) {
      this.eGui.className = "r";
      this.refresh(p);
    }
    getGui() {
      return this.eGui;
    }
    refresh(p: ICellRendererParams<Row, number>) {
      this.eGui.textContent = shape === "lean" ? String(p.value) : richText(p);
      return true;
    }
  };

const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};

async function bench(shape: Shape, renderer: Renderer) {
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:1300px";
  document.body.appendChild(host);
  const cellRenderer =
    renderer === "solid" ? (shape === "lean" ? SolidLean : SolidRich) : jsRenderer(shape);
  let api!: GridApi<Row>;
  const options: GridOptions<Row> = {
    columnDefs: fields.map((field) => ({ field, width: 120, cellRenderer })),
    rowData: buildRows(),
    getRowId: (p) => String(p.data.id),
    suppressAnimationFrame: true,
  };
  const firstCell = new Promise<void>((resolve) => {
    const mo = new MutationObserver(() => {
      if (host.querySelector(".ag-cell .r")) {
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
  await settle();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const ticks: number[] = [];
  for (let t = 1; t <= TICKS; t++) {
    const update = Array.from({ length: UPDATE_ROWS }, (_, i) => {
      const row: Row = { id: i };
      for (let c = 0; c < COLS; c++) row[fields[c]!] = -(t * 1000 + i);
      return row;
    });
    const t0 = performance.now();
    api.applyTransaction({ update });
    await settle();
    ticks.push(performance.now() - t0);
  }
  // PROOF the CPU window contains the renderer refresh: the first visible cell shows the last tick
  const first = host.querySelector('.ag-row[row-index="0"] .ag-cell[col-id="f0"] .r');
  expect(
    first?.textContent?.startsWith(`-${TICKS * 1000}`),
    `${renderer}/${shape}: stale cell`,
  ).toBe(true);

  const alive = api.getDisplayedRowCount() === ROWS;
  api.destroy();
  host.remove();
  return { ticks, alive };
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => sorted(xs)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]!;

describe("perf streaming: custom cell renderers under value ticks", () => {
  it("harness posture", () => {
    expect(document.visibilityState).toBe("visible");
  });

  for (const shape of ["lean", "rich"] as const) {
    it(`${shape} renderer, ${UPDATE_ROWS}-row ticks`, async () => {
      // warmup both sides
      await bench(shape, "solid");
      await bench(shape, "vanilla");
      const samples: Record<Renderer, number[]> = { solid: [], vanilla: [] };
      for (let i = 0; i < ITERATIONS + 1; i++) {
        const order: Renderer[] = i % 2 === 0 ? ["solid", "vanilla"] : ["vanilla", "solid"];
        for (const renderer of order) {
          const { ticks, alive } = await bench(shape, renderer);
          expect(alive).toBe(true);
          if (i === 0) continue; // discarded
          samples[renderer].push(median(ticks));
        }
      }
      const s = samples.solid;
      const v = samples.vanilla;
      console.warn(
        `PERF [stream ${shape}] per tick (${UPDATE_ROWS} rows, ${COLS} custom cols): CPU solid ${median(s).toFixed(2)} (p95 ${p95(s).toFixed(2)}) vs vanilla ${median(v).toFixed(2)} (p95 ${p95(v).toFixed(2)}) ms (x${(median(s) / Math.max(0.05, median(v))).toFixed(2)}) [n=${ITERATIONS}, ${TICKS} ticks each]`,
      );
    }, 600_000);
  }
});

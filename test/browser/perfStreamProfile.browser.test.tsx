// CPU PROFILE of a streaming tick reaching custom cell renderers (diagnostic, perf project):
// CDP self time by function, Solid vs vanilla, over the same 500-row sync update ticks as
// perfStreaming (lean renderer: reads `value` only). Answers "where does the per-tick gap go"
// once the params-spread equality cut was measured as a no-op.
import { render } from "@solidjs/testing-library";
import { cdp } from "@vitest/browser/context";
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
const TICKS = 20;
const ROUNDS = 5;
const UPDATE_ROWS = 500;

type Row = Record<string, number>;
const fields = Array.from({ length: COLS }, (_, c) => `f${c}`);
const buildRows = (): Row[] =>
  Array.from({ length: ROWS }, (_, r) => {
    const row: Row = { id: r };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = r * COLS + c;
    return row;
  });

const SolidLean = (p: ICellRendererParams<Row, number>) => <span class="r">{p.value}</span>;
class JsLean implements ICellRendererComp<Row> {
  private eGui = document.createElement("span");
  init(p: ICellRendererParams<Row, number>) {
    this.eGui.className = "r";
    this.refresh(p);
  }
  getGui() {
    return this.eGui;
  }
  refresh(p: ICellRendererParams<Row, number>) {
    this.eGui.textContent = String(p.value);
    return true;
  }
}

type Profile = {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
  samples: number[];
  timeDeltas: number[];
};

const ownerOf = (url: string, fn: string): string => {
  if (fn === "(garbage collector)") return "gc";
  if (fn === "(program)") return "(program)";
  if (fn === "(idle)") return "(idle)";
  if (/solid-js|@solidjs|solid\.js|solid-[A-Za-z0-9]+\.js|web\.js|signals/.test(url))
    return "solid runtime";
  if (/\/src\//.test(url)) return "solid-ag-grid src";
  if (/\/test\//.test(url)) return "test (renderers)";
  if (/ag-grid-community|ag-stack/.test(url)) return "ag-grid core";
  if (url === "") return "DOM/native";
  return "other";
};

function aggregate(profile: Profile, buckets: Map<string, number>, fns: Map<string, number>) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]!;
    selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  let total = 0;
  for (const [id, us] of selfUs) {
    const n = byId.get(id)!;
    const b = ownerOf(n.callFrame.url, n.callFrame.functionName);
    buckets.set(b, (buckets.get(b) ?? 0) + us);
    total += us;
    const file = n.callFrame.url.split("/").slice(-1)[0]?.split("?")[0] ?? "";
    const key = `${n.callFrame.functionName || "(anonymous)"}  ${file}:${n.callFrame.lineNumber + 1}`;
    fns.set(key, (fns.get(key) ?? 0) + us);
  }
  return total;
}

const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};

async function mount(renderer: "solid" | "vanilla") {
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:1300px";
  document.body.appendChild(host);
  let api!: GridApi<Row>;
  const options: GridOptions<Row> = {
    columnDefs: fields.map((field) => ({
      field,
      width: 120,
      cellRenderer: renderer === "solid" ? SolidLean : JsLean,
    })),
    rowData: buildRows(),
    getRowId: (p) => String(p.data.id),
    suppressAnimationFrame: true,
  };
  if (renderer === "vanilla") api = createGrid(host, options);
  else render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  await new Promise<void>((r) => {
    const poll = () => (host.querySelector(".ag-cell .r") ? r() : setTimeout(poll, 5));
    poll();
  });
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  return { api, host };
}

const tickUpdate = (t: number) =>
  Array.from({ length: UPDATE_ROWS }, (_, i) => {
    const row: Row = { id: i };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = -(t * 1000 + i);
    return row;
  });

const ms = (us: number) => (us / 1000).toFixed(3);

describe("streaming tick CPU profile (diagnostic)", () => {
  it("20k x 10 custom lean renderers, 20 ticks x 5 rounds per renderer: self time by owner and top functions", async () => {
    const session = cdp();
    const report: string[] = [];
    for (const renderer of ["solid", "vanilla"] as const) {
      const { api, host } = await mount(renderer);
      let tick = 0;
      for (let i = 0; i < 5; i++) {
        api.applyTransaction({ update: tickUpdate(++tick) });
        await settle();
      }
      const buckets = new Map<string, number>();
      const fns = new Map<string, number>();
      let total = 0;
      let wall = 0;
      await session.send("Profiler.enable");
      await session.send("Profiler.setSamplingInterval", { interval: 50 });
      for (let round = 0; round < ROUNDS; round++) {
        await session.send("Profiler.start");
        const t0 = performance.now();
        for (let i = 0; i < TICKS; i++) {
          api.applyTransaction({ update: tickUpdate(++tick) });
          await settle();
        }
        wall += performance.now() - t0;
        const { profile } = (await session.send("Profiler.stop")) as { profile: Profile };
        total += aggregate(profile, buckets, fns);
      }
      await session.send("Profiler.disable");
      expect(
        host.querySelector('.ag-row[row-index="0"] .ag-cell[col-id="f0"] .r')?.textContent,
      ).toBe(`-${tick * 1000}`);
      const n = TICKS * ROUNDS;
      report.push(
        `\n===== ${renderer.toUpperCase()}  per tick: wall ${(wall / n).toFixed(3)} ms | sampled ${ms(total / n)} ms`,
      );
      for (const [b, us] of [...buckets].sort((a, b) => b[1] - a[1])) {
        report.push(`  ${b.padEnd(20)} ${ms(us / n).padStart(8)} ms/tick`);
      }
      report.push("  top functions (self, ms per tick):");
      for (const [k, us] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
        if (us / n < 8) break;
        report.push(`    ${ms(us / n).padStart(7)}  ${k}`);
      }
      api.destroy();
      host.remove();
    }
    console.warn("STREAMPROFILE" + report.join("\n"));
  }, 300_000);
});

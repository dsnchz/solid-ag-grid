// ALLOCATION PROFILE of the row swap (diagnostic, perf project): CDP sampling heap profiler
// over the same synchronous swap loop as perfSwapProfile — bytes allocated per function, Solid
// vs vanilla, so an allocation diet targets what actually allocates.
import { render } from "@solidjs/testing-library";
import { cdp } from "@vitest/browser/context";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROWS = 20_000;
const COLS = 10;
const SWAPS = 40;

const buildData = () => {
  const fields = Array.from({ length: COLS }, (_, c) => `f${c}`);
  const data = Array.from({ length: ROWS }, (_, r) => {
    const row: Record<string, number> = { id: r };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = r * COLS + c;
    return row;
  });
  return { columnDefs: fields.map((field) => ({ field, width: 120 })), rowData: data };
};

type HeapNode = {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
};

const ownerOf = (url: string) =>
  /solid-js|@solidjs|solid-[A-Za-z0-9]+\.js|web\.js|signals/.test(url)
    ? "solid runtime"
    : /\/src\//.test(url)
      ? "solid-ag-grid src"
      : /ag-grid-community|ag-stack/.test(url)
        ? "ag-grid core"
        : url === ""
          ? "native/anon"
          : "other";

function walk(
  node: HeapNode,
  owners: Map<string, number>,
  fns: Map<string, number>,
  total: { b: number },
) {
  if (node.selfSize > 0) {
    const o = ownerOf(node.callFrame.url);
    owners.set(o, (owners.get(o) ?? 0) + node.selfSize);
    const file = node.callFrame.url.split("/").slice(-1)[0]?.split("?")[0] ?? "";
    const key = `${node.callFrame.functionName || "(anonymous)"}  ${file}:${node.callFrame.lineNumber + 1}`;
    fns.set(key, (fns.get(key) ?? 0) + node.selfSize);
    total.b += node.selfSize;
  }
  for (const c of node.children ?? []) walk(c, owners, fns, total);
}

const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};

async function mount(renderer: "solid" | "vanilla") {
  const { columnDefs, rowData } = buildData();
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);
  let api!: GridApi;
  const options: GridOptions = {
    columnDefs,
    rowData,
    getRowId: (p) => String(p.data.id),
    suppressAnimationFrame: true,
  };
  if (renderer === "vanilla") api = createGrid(host, options);
  else render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  await new Promise<void>((r) => {
    const poll = () => (host.querySelector(".ag-cell") ? r() : setTimeout(poll, 5));
    poll();
  });
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const scrollTo = (index: number) => {
    api.ensureIndexVisible(index);
    host.querySelector(".ag-body-viewport")?.dispatchEvent(new Event("scroll"));
  };
  return { api, host, scrollTo };
}

const kb = (b: number) => (b / 1024).toFixed(1);

describe("row swap allocation profile (diagnostic)", () => {
  it("20k x 10, 40 swaps per renderer: bytes allocated by owner and top allocating functions", async () => {
    const session = cdp();
    const report: string[] = [];
    for (const renderer of ["solid", "vanilla"] as const) {
      const { api, host, scrollTo } = await mount(renderer);
      for (let i = 1; i <= 5; i++) {
        scrollTo(i * 700);
        await settle();
      }
      const stride = Math.floor(ROWS / (SWAPS + 1));
      await session.send("HeapProfiler.enable");
      await session.send("HeapProfiler.startSampling", { samplingInterval: 512 });
      for (let i = 1; i <= SWAPS; i++) {
        const target = i * stride;
        scrollTo(target);
        await settle();
        expect(host.querySelector(`.ag-row[row-index="${target}"] .ag-cell`)).not.toBeNull();
      }
      const { profile } = (await session.send("HeapProfiler.stopSampling")) as {
        profile: { head: HeapNode };
      };
      await session.send("HeapProfiler.disable");
      const owners = new Map<string, number>();
      const fns = new Map<string, number>();
      const total = { b: 0 };
      walk(profile.head, owners, fns, total);
      report.push(
        `\n===== ${renderer.toUpperCase()}  allocated per swap: ${kb(total.b / SWAPS)} KB (sampled)`,
      );
      for (const [o, b] of [...owners].sort((a, b) => b[1] - a[1])) {
        report.push(`  ${o.padEnd(20)} ${kb(b / SWAPS).padStart(8)} KB/swap`);
      }
      report.push("  top allocating functions (KB per swap):");
      for (const [k, b] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
        if (b / SWAPS < 1024) break;
        report.push(`    ${kb(b / SWAPS).padStart(7)}  ${k}`);
      }
      api.destroy?.();
      host.remove();
    }
    console.warn("ALLOC" + report.join("\n"));
  }, 300_000);
});

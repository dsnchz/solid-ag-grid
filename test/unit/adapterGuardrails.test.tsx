// Adapter guardrails (API RULING, .agent/planning/STATUS.md): dev warnings that keep the two
// data protocols from being crossed. rowData is the VALUE protocol (snapshots, identity-diffed)
// — a store proxy handed there is snapshot-once and its mutations silently never reach the
// grid; rowStore is the SUBSCRIPTION protocol and requires the client-side row model (core
// applyTransaction against any other model is a silent no-op). Wiring-level coverage; the
// adapter's own bookkeeping lives in rowStoreAdapter.test.tsx.
import { render } from "@solidjs/testing-library";
import type { ColDef, IDatasource } from "ag-grid-community";
import { AllCommunityModule, getGridApi, ModuleRegistry } from "ag-grid-community";
import {
  createMemo,
  // eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
  createStore,
  flush,
} from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly id: string; name: string; qty: number };

const initialRows = (): Row[] => [
  { id: "a", name: "alpha", qty: 1 },
  { id: "b", name: "beta", qty: 2 },
  { id: "c", name: "gamma", qty: 3 },
];

const columnDefs: ColDef<Row>[] = [{ field: "name" }, { field: "qty" }];

/** Boot runs in a microtask off onSettled; two macrotasks let boot + ready drain fully. */
const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const PROXY_ROWDATA_WARNING =
  "AG Grid: `rowData` received a Solid store proxy — `rowData` is snapshot once and identity-diffed, so store mutations will NOT update the grid. Pass plain (or async) values to `rowData`, or use the `rowStore` prop for live store projection.";

const rowModelMismatchWarning = (rowModelType: string) =>
  `AG Grid: \`rowStore\` requires the client-side row model (\`rowModelType\` is "${rowModelType}") — live row-store projection is disabled and the store is ignored; this row model sources data from its own datasource. Remove \`rowModelType\` to use \`rowStore\`.`;

describe("rowData store-proxy guardrail (value protocol)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns at boot when a Solid store proxy is passed as rowData", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [store] = createStore<Row[]>(initialRows());
    // the cast enacts the misuse under test: handing the (deeply-readonly) store proxy to the
    // mutable-array value protocol
    const { unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowData={store as Row[]} />
    ));
    await settle();
    expect(warnSpy).toHaveBeenCalledWith(PROXY_ROWDATA_WARNING);
    unmount();
  });

  it("stays silent for a plain array rowData", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowData={initialRows()} />
    ));
    await settle();
    expect(warnSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("stays silent when rowData is undefined / not provided", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount: unmountAbsent } = render(() => <AgGridSolid columnDefs={columnDefs} />);
    const { unmount: unmountUndefined } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowData={undefined} />
    ));
    await settle();
    expect(warnSpy).not.toHaveBeenCalled();
    unmountAbsent();
    unmountUndefined();
  });

  it("stays silent for async-pending rowData (per-key isolation: the pending key is absent, never a proxy)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // never-resolving async source — the boot snapshot reads it via latest() and omits the key
    const pending = new Promise<Row[]>(() => {});
    const Harness = () => {
      const asyncRows = createMemo(() => pending);
      return <AgGridSolid columnDefs={columnDefs} rowData={asyncRows()} />;
    };
    const { unmount } = render(() => <Harness />);
    await settle();
    expect(warnSpy).not.toHaveBeenCalled();
    unmount();
  });
});

describe("rowStore row-model guardrail (subscription protocol is clientSide-only)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Minimal infinite-model datasource: answers every block request with zero rows. */
  const emptyDatasource: IDatasource = {
    getRows: (params) => params.successCallback([], 0),
  };

  it('warns and detaches the adapter for rowModelType "infinite" (degraded: store mutations are not projected)', async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store, setStore] = createStore<Row[]>(initialRows());
    const { container, unmount } = render(() => (
      <AgGridSolid
        columnDefs={columnDefs}
        rowModelType="infinite"
        datasource={emptyDatasource}
        rowStore={store}
        getRowId={(params) => params.data.id}
      />
    ));
    await settle();
    expect(warnSpy).toHaveBeenCalledWith(rowModelMismatchWarning("infinite"));
    // no console errors: the getRowId degraded path must not also fire, and — because the
    // mismatch fallback passes NO rowData — core's error #200 (rowData under a
    // non-clientSide model) must not fire either
    expect(errorSpy).not.toHaveBeenCalled();

    // detachment proof: were the adapter attached, a store mutation would call
    // api.applyTransaction / applyTransactionAsync (a silent core no-op on this model —
    // exactly why the wrapper warns). Spy the live api and assert neither is ever reached.
    const api = getGridApi(container.firstElementChild as HTMLElement);
    expect(api).toBeDefined();
    const syncSpy = vi.spyOn(api!, "applyTransaction");
    const asyncSpy = vi.spyOn(api!, "applyTransactionAsync");
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
      draft[0]!.qty = 99;
    });
    flush();
    await settle();
    expect(syncSpy).not.toHaveBeenCalled();
    expect(asyncSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("warns when the non-clientSide rowModelType comes from the gridOptions bag", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [store] = createStore<Row[]>(initialRows());
    const { unmount } = render(() => (
      <AgGridSolid
        columnDefs={columnDefs}
        gridOptions={{ rowModelType: "infinite", datasource: emptyDatasource }}
        rowStore={store}
        getRowId={(params) => params.data.id}
      />
    ));
    await settle();
    expect(warnSpy).toHaveBeenCalledWith(rowModelMismatchWarning("infinite"));
    unmount();
  });

  it('stays silent — and projects live — for an explicit rowModelType "clientSide"', async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store, setStore] = createStore<Row[]>(initialRows());
    const { container, unmount } = render(() => (
      <AgGridSolid
        columnDefs={columnDefs}
        rowModelType="clientSide"
        rowStore={store}
        getRowId={(params) => params.data.id}
      />
    ));
    await settle();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    // positive control: the adapter IS attached — a structural store write reaches the grid
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    await settle();
    const api = getGridApi(container.firstElementChild as HTMLElement);
    const ids: string[] = [];
    api?.forEachNode((node) => ids.push((node.data as Row).id));
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
    unmount();
  });
});

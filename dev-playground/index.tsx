/* Playground: toggle-able scenarios exercising the Solid-native capabilities, with the
 * vanilla createGrid oracle kept side-by-side (parity reference for the basic scenario). */
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import type { ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import {
  action,
  affects,
  createMemo,
  createOptimisticStore,
  createSignal,
  // eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
  createStore,
  deep,
  For,
  isPending,
  onSettled,
  Show,
} from "solid-js";

import type {
  CustomCellEditorProps,
  CustomFilterProps,
  CustomNoRowsOverlayProps,
} from "../src/index";
import AgGridSolid, { useGridCellEditor, useGridFilter } from "../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type CarRow = { make: string; model: string; price: number };

const carRows = (tag = ""): CarRow[] => [
  { make: `Toyota${tag}`, model: "Celica", price: 35000 },
  { make: `Ford${tag}`, model: "Mondeo", price: 32000 },
  { make: `Porsche${tag}`, model: "Boxster", price: 72000 },
  { make: `BMW${tag}`, model: "M3", price: 61000 },
  { make: `Ford${tag}`, model: "Focus", price: 24000 },
];

const carColumns = [
  { field: "make" as const, sortable: true, filter: true },
  { field: "model" as const, sortable: true, filter: true },
  { field: "price" as const, sortable: true, filter: "agNumberColumnFilter" },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ scenarios */

/** 1. Basic grid with sorting + filtering enabled. */
const BasicScenario = () => (
  <AgGridSolid
    containerStyle={{ height: "400px" }}
    columnDefs={carColumns}
    rowData={carRows()}
    defaultColDef={{ flex: 1, resizable: true }}
  />
);

/** 2. Async rowData: loading overlay on first load, SWR refetch keeps rows visible. */
const AsyncRowsScenario = () => {
  const [generation, setGeneration] = createSignal(1);
  // eslint-disable-next-line solid/reactivity -- async memos are first-class in Solid 2.0 (plugin predates 2.0); signals are read before the first await
  const rows = createMemo(async () => {
    const gen = generation(); // read BEFORE the await — reads after await never track
    await sleep(1500);
    return carRows(` g${gen}`);
  });
  return (
    <>
      <p class="scenario-note">
        First load shows the grid's loading overlay. Refetch keeps the previous rows visible until
        the new generation resolves (stale-while-revalidate) — no overlay flash, no blanking.
      </p>
      <button onClick={() => setGeneration((g) => g + 1)}>Refetch (1.5s)</button>
      <div style={{ height: "400px", "margin-top": "0.5rem" }}>
        <AgGridSolid columnDefs={carColumns} rowData={rows()} defaultColDef={{ flex: 1 }} />
      </div>
    </>
  );
};

/** 3. Custom Solid cell renderer + async cell renderer suspending into <Loading>. */
const PriceBadge = (props: ICellRendererParams<CarRow, number>) => (
  <span
    style={{
      background: (props.value ?? 0) > 40000 ? "#fde68a" : "#bbf7d0",
      "border-radius": "999px",
      padding: "0 0.6em",
    }}
  >
    {props.value?.toLocaleString()}
  </span>
);

const AsyncMakeCell = (props: ICellRendererParams<CarRow, string>) => {
  // zero-ceremony async: the renderer reads an async computation directly; the per-cell
  // <Loading> boundary shows loadingCellRenderer until it settles
  const enriched = new Promise<string>((resolve) =>
    setTimeout(() => resolve("verified"), 800 + Math.random() * 1200),
  );
  const detail = createMemo(() => enriched);
  return (
    <span>
      {props.value} <em style={{ color: "#16a34a" }}>({detail()})</em>
    </span>
  );
};

const CellSkeleton = () => <span style={{ color: "#94a3b8" }}>loading…</span>;

const RenderersScenario = () => (
  <>
    <p class="scenario-note">
      "make" uses an async Solid renderer (per-cell loading fallback, staggered resolve); "price"
      uses a sync Solid badge renderer.
    </p>
    <div style={{ height: "400px" }}>
      <AgGridSolid
        columnDefs={[
          { field: "make", cellRenderer: AsyncMakeCell, loadingCellRenderer: CellSkeleton },
          { field: "model" },
          { field: "price", cellRenderer: PriceBadge },
        ]}
        rowData={carRows()}
        defaultColDef={{ flex: 1 }}
      />
    </div>
  </>
);

/** 4. Custom filter via useGridFilter. */
const MakeFilter = (props: CustomFilterProps<CarRow, unknown, string>) => {
  useGridFilter({
    doesFilterPass: (params) => props.model == null || params.data.make.startsWith(props.model),
  });
  return (
    <div style={{ padding: "0.5rem", display: "flex", gap: "0.25rem", "flex-direction": "column" }}>
      <span>model = {props.model ?? "none"}</span>
      <button onClick={() => props.onModelChange("Ford")}>only Ford</button>
      <button onClick={() => props.onModelChange("Porsche")}>only Porsche</button>
      <button onClick={() => props.onModelChange(null)}>clear</button>
    </div>
  );
};

const FilterScenario = () => (
  <>
    <p class="scenario-note">
      The "make" column's filter (open via the column menu) is a Solid component registered with
      <code> useGridFilter</code>; model changes push into the live component without remount.
    </p>
    <div style={{ height: "400px" }}>
      <AgGridSolid
        columnDefs={[{ field: "make", filter: MakeFilter }, { field: "model" }, { field: "price" }]}
        rowData={carRows()}
        defaultColDef={{ flex: 1 }}
      />
    </div>
  </>
);

/** 5. Custom overlay reading an EXTERNAL app signal — updates with zero grid API calls. */
const [connectionStatus, setConnectionStatus] = createSignal("connected: 0");
let connectionCount = 0;

const ExternalSignalOverlay = (_props: CustomNoRowsOverlayProps) => (
  <div style={{ padding: "1rem", border: "1px dashed #94a3b8", "border-radius": "8px" }}>
    no rows — external status: <strong>{connectionStatus()}</strong>
  </div>
);

const OverlayScenario = () => (
  <>
    <p class="scenario-note">
      The noRows overlay is a Solid component reading an app-level signal. Click the button — the
      overlay inside the grid updates live, with no grid API involvement.
    </p>
    <button onClick={() => setConnectionStatus(`connected: ${++connectionCount}`)}>
      bump external signal
    </button>
    <div style={{ height: "400px", "margin-top": "0.5rem" }}>
      <AgGridSolid
        columnDefs={carColumns}
        rowData={[] as CarRow[]}
        noRowsOverlayComponent={ExternalSignalOverlay}
        defaultColDef={{ flex: 1 }}
      />
    </div>
  </>
);

/** 6. Full-width rows rendered by a Solid component. */
type InfoRow = { id: string; info: string; wide?: boolean };

const infoRows: InfoRow[] = [
  { id: "1", info: "regular row" },
  { id: "2", info: "this row spans the full grid width", wide: true },
  { id: "3", info: "another regular row" },
  { id: "4", info: "another full-width row", wide: true },
];

const FullWidthRow = (props: ICellRendererParams<InfoRow>) => (
  <div
    style={{
      display: "flex",
      "align-items": "center",
      height: "100%",
      padding: "0 1rem",
      background: "#eef2ff",
    }}
  >
    FULL WIDTH: {props.data?.info}
  </div>
);

const FullWidthScenario = () => (
  <div style={{ height: "400px" }}>
    <AgGridSolid
      columnDefs={[{ field: "id" }, { field: "info" }]}
      rowData={infoRows}
      getRowId={(params) => params.data.id}
      isFullWidthRow={(params) => !!params.rowNode.data?.wide}
      fullWidthCellRenderer={FullWidthRow}
      defaultColDef={{ flex: 1 }}
    />
  </div>
);

/** 7. Editors: custom inline Solid editor (make) + built-in editors (model/price). */
const MakeEditor = (props: CustomCellEditorProps<CarRow, string>) => {
  useGridCellEditor({
    // demo of a grid-editor callback: refuse to start editing Porsche rows
    isCancelBeforeStart: () => props.value === "Porsche",
  });
  let el!: HTMLInputElement;
  onSettled(() => {
    el.focus();
    el.select();
  });
  return (
    <input
      ref={el}
      style={{ width: "100%", height: "100%", border: "none" }}
      value={props.value ?? ""}
      onInput={(e) => props.onValueChange(e.currentTarget.value)}
    />
  );
};

const EditorsScenario = () => (
  <>
    <p class="scenario-note">
      Double-click cells to edit. "make" is a custom Solid inline editor (
      <code>useGridCellEditor</code>; editing "Porsche" is cancelled via isCancelBeforeStart);
      "model" and "price" use built-in editors.
    </p>
    <div style={{ height: "400px" }}>
      <AgGridSolid
        columnDefs={[
          { field: "make", editable: true, cellEditor: MakeEditor },
          { field: "model", editable: true },
          { field: "price", editable: true, cellEditor: "agNumberCellEditor" },
        ]}
        rowData={carRows()}
        defaultColDef={{ flex: 1 }}
      />
    </div>
  </>
);

/** 8. rowStore: optimistic CRUD against a simulated flaky server — zero grid API calls.
 * The grid is driven ONLY by store mutations: `action` + `createOptimisticStore` show rows
 * instantly, the adapter projects them as transactions, and a failed server write reverts
 * the overlay — the row disappears (or reappears, for deletes) by itself. */
type ItemRow = { readonly id: string; readonly name: string; readonly qty: number };

const OptimisticCrudScenario = () => {
  // stable client-generated ids persisted by the "server" — the supported rowStore pattern
  const [rows, setRows] = createStore<ItemRow[]>([
    { id: crypto.randomUUID(), name: "widget", qty: 3 },
    { id: crypto.randomUUID(), name: "gadget", qty: 5 },
  ]);
  const [optimisticRows, setOptimisticRows] = createOptimisticStore<ItemRow[]>(rows);

  const [failNext, setFailNext] = createSignal(false);
  const [lastError, setLastError] = createSignal("");
  const [name, setName] = createSignal("");
  const [qty, setQty] = createSignal(1);

  const server = async <T,>(result: T): Promise<T> => {
    await sleep(1500);
    if (failNext()) {
      setFailNext(false);
      throw new Error("simulated server failure");
    }
    return result;
  };

  // eslint-disable-next-line solid/reactivity -- action() IS the 2.0 mutation scope; its writes are transaction-coordinated (plugin predates 2.0)
  const addRow = action(function* (row: ItemRow) {
    affects(rows); // declares the in-flight write → isPending(deep(rows)) reads true
    setOptimisticRows((draft) => {
      draft.push(row); // shows in the grid INSTANTLY
    });
    const saved = (yield server(row)) as ItemRow; // background write
    setRows((draft) => {
      draft.push(saved); // confirm into the base store
    });
  });

  // eslint-disable-next-line solid/reactivity -- action() IS the 2.0 mutation scope; its writes are transaction-coordinated (plugin predates 2.0)
  const removeRow = action(function* (id: string) {
    affects(rows);
    setOptimisticRows((draft) => draft.filter((row) => row.id !== id)); // gone INSTANTLY
    yield server(id);
    setRows((draft) => draft.filter((row) => row.id !== id));
  });

  const submit = () => {
    if (!name()) {
      return;
    }
    setLastError("");
    addRow({ id: crypto.randomUUID(), name: name(), qty: qty() }).catch((e: unknown) =>
      setLastError(e instanceof Error ? e.message : String(e)),
    );
    setName("");
  };

  // pending affordance: true while an action that declared affects(rows) is awaiting its
  // server settle. Note: probing the OPTIMISTIC view never reads pending — overlay writes
  // are revealed immediately (that is their point); the in-flight state lives on the base
  // store the action declared it will change.
  const saving = createMemo(() => isPending(() => deep(rows)));
  // a row is pending iff it is visible optimistically but not yet confirmed into the base
  // store — the renderer reads the app store directly (Solid-native external reactivity)
  const StatusCell = (props: ICellRendererParams<ItemRow>) => {
    const confirmed = createMemo(() => rows.some((row) => row.id === props.data?.id));
    return (
      <Show when={confirmed()} fallback={<em style={{ color: "#d97706" }}>saving…</em>}>
        <span style={{ color: "#16a34a" }}>saved</span>
      </Show>
    );
  };
  const DeleteCell = (props: ICellRendererParams<ItemRow>) => (
    <button
      onClick={() => {
        const id = props.data?.id;
        if (id) {
          setLastError("");
          removeRow(id).catch((e: unknown) =>
            setLastError(e instanceof Error ? e.message : String(e)),
          );
        }
      }}
    >
      delete
    </button>
  );

  return (
    <>
      <p class="scenario-note">
        The grid is driven only by <code>rowStore</code> mutations — no grid API calls. Adds and
        deletes paint instantly; toggle "fail next request" to watch a failed write auto-revert (the
        optimistic row vanishes, a deleted row comes back).
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
        <input placeholder="name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        <input
          type="number"
          style={{ width: "5rem" }}
          value={qty()}
          onInput={(e) => setQty(Number(e.currentTarget.value) || 0)}
        />
        <button onClick={submit}>Add row (1.5s save)</button>
        <label>
          <input
            type="checkbox"
            checked={failNext()}
            onChange={(e) => setFailNext(e.currentTarget.checked)}
          />
          fail next request
        </label>
        <Show when={saving()}>
          <em style={{ color: "#d97706" }}>saving…</em>
        </Show>
        <Show when={lastError()}>
          <strong style={{ color: "#dc2626" }}>server error: {lastError()} (reverted)</strong>
        </Show>
      </div>
      <div style={{ height: "400px", "margin-top": "0.5rem" }}>
        <AgGridSolid
          columnDefs={[
            { field: "name" },
            { field: "qty" },
            { headerName: "status", cellRenderer: StatusCell, sortable: false },
            { headerName: "", cellRenderer: DeleteCell, sortable: false, width: 110 },
          ]}
          rowStore={optimisticRows}
          getRowId={(params) => params.data.id}
          defaultColDef={{ flex: 1 }}
        />
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ app shell */

type Scenario = { readonly id: string; readonly label: string; readonly Comp: () => JSX.Element };

const SCENARIOS: Scenario[] = [
  { id: "basic", label: "Basic + sort/filter", Comp: BasicScenario },
  { id: "async", label: "Async rowData (SWR)", Comp: AsyncRowsScenario },
  { id: "renderers", label: "Cell renderers (sync + async)", Comp: RenderersScenario },
  { id: "filter", label: "Custom filter (useGridFilter)", Comp: FilterScenario },
  { id: "overlay", label: "External-signal overlay", Comp: OverlayScenario },
  { id: "fullwidth", label: "Full-width rows", Comp: FullWidthScenario },
  { id: "editors", label: "Editors", Comp: EditorsScenario },
  { id: "rowstore", label: "rowStore optimistic CRUD", Comp: OptimisticCrudScenario },
];

const App = () => {
  const [current, setCurrent] = createSignal("basic");
  return (
    <>
      <div class="scenario-toolbar">
        <For each={SCENARIOS}>
          {(s) => (
            <button
              class={current() === s.id ? "scenario-btn active" : "scenario-btn"}
              onClick={() => setCurrent(s.id)}
            >
              {s.label}
            </button>
          )}
        </For>
      </div>
      <For each={SCENARIOS}>
        {(s) => (
          <Show when={current() === s.id}>
            <s.Comp />
          </Show>
        )}
      </For>
    </>
  );
};

render(() => <App />, document.getElementById("solid-root")!);

/* Vanilla createGrid oracle (parity reference for the basic scenario). */
createGrid(document.getElementById("vanilla-grid")!, {
  columnDefs: carColumns,
  rowData: carRows(),
  defaultColDef: { flex: 1, resizable: true },
});

import type { CustomCellRendererProps } from "@dschz/solid-ag-grid";
import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createSignal,
  createStore,
  Show,
} from "solid-js";

/* rowStore optimistic CRUD — Recipe A from docs/row-store.md (vanish on failure).
 * The grid is driven ONLY by store mutations: `action` + `createOptimisticStore` show rows
 * instantly, the adapter projects them as surgical grid transactions, and a failed server
 * write reverts the overlay — the row disappears (or reappears, for deletes) by itself. */

type ItemRow = { readonly id: string; readonly name: string; readonly qty: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const RowStore = () => {
  // Stable client-generated ids persisted by the "server" — the supported rowStore pattern:
  // the optimistic row and the confirmed row share an identity, so the confirm diffs as a
  // no-op instead of a remove+add flicker.
  const [rows, setRows] = createStore<ItemRow[]>([
    { id: crypto.randomUUID(), name: "widget", qty: 3 },
    { id: crypto.randomUUID(), name: "gadget", qty: 5 },
    { id: crypto.randomUUID(), name: "gizmo", qty: 8 },
  ]);
  const [optimisticRows, setOptimisticRows] = createOptimisticStore<ItemRow[]>(rows);

  const [failNext, setFailNext] = createSignal(false);
  const [lastError, setLastError] = createSignal("");
  const [name, setName] = createSignal("");
  const [qty, setQty] = createSignal(1);

  // "saving…" affordance — the canonical co-written createOptimistic(false) flag (cheatsheet:
  // process affordances are a co-written optimistic flag, NOT isPending): set true alongside
  // the optimistic write inside each action; it auto-reverts when the transition settles
  // (success or failure). isPending is the wrong tool here — optimistic writes are
  // source-of-truth and never read as pending; isPending answers "is a value change
  // propagating?" (get side), while "saving…" reports a process the user started (post side),
  // i.e. state you write, not state you probe.
  const [saving, setSaving] = createOptimistic(false);

  // Simulated flaky server: 1.5s latency, fails once when the toggle is armed.
  const server = async <T,>(result: T): Promise<T> => {
    await sleep(1500);
    if (failNext()) {
      setFailNext(false);
      throw new Error("simulated server failure");
    }
    return result;
  };

  // GENERATOR form — Solid 2.0's action() takes generators. Writes after a plain `await`
  // would escape the transaction envelope (the classic mistake); `yield` preserves it.
  const addRow = action(function* (row: ItemRow) {
    setSaving(true); // process affordance, co-written with the optimistic write
    setOptimisticRows((draft) => {
      draft.push(row); // shows in the grid INSTANTLY
    });
    const saved = (yield server(row)) as ItemRow; // the background write
    setRows((draft) => {
      draft.push(saved); // confirm into the base store
    });
  });

  const removeRow = action(function* (id: string) {
    setSaving(true); // co-written flag — auto-reverts at settle
    setOptimisticRows((draft) => draft.filter((row) => row.id !== id)); // gone INSTANTLY
    yield server(id);
    setRows((draft) => draft.filter((row) => row.id !== id));
  });

  const submit = () => {
    if (!name()) return;
    setLastError("");
    // Recipe A surfaces failure out-of-band: the overlay revert removes the row by itself.
    addRow({ id: crypto.randomUUID(), name: name(), qty: qty() }).catch((e: unknown) =>
      setLastError(e instanceof Error ? e.message : String(e)),
    );
    setName("");
  };

  // Per-row status: derived, not probed — a row is "saving" while it is visible in the
  // optimistic view but not yet confirmed into the base store. The renderer reads the app
  // store directly (Solid-native external reactivity — doorway 2). The co-written per-row
  // status-TAG variant (a status field on the rows themselves) belongs to the base-store
  // recipe — see docs/row-store.md, "The failure UX is a choice".
  const StatusCell = (props: CustomCellRendererProps<ItemRow>) => {
    const confirmed = createMemo(() => rows.some((row) => row.id === props.data?.id));
    return (
      <Show when={confirmed()} fallback={<span class="pill down">saving…</span>}>
        <span class="pill up">saved</span>
      </Show>
    );
  };

  const DeleteCell = (props: CustomCellRendererProps<ItemRow>) => (
    <button
      class="btn danger"
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

  const columnDefs: ColDef<ItemRow>[] = [
    { field: "name" },
    { field: "qty", maxWidth: 120 },
    { headerName: "Status (derived)", cellRenderer: StatusCell, sortable: false },
    { headerName: "", cellRenderer: DeleteCell, sortable: false, maxWidth: 130 },
  ];

  return (
    <>
      <div class="toolbar">
        <input
          class="text"
          placeholder="name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <input
          class="text"
          type="number"
          style={{ width: "5.5rem" }}
          value={qty()}
          onInput={(e) => setQty(Number(e.currentTarget.value) || 0)}
        />
        <button class="btn primary" onClick={submit}>
          add row (1.5s save)
        </button>
        <label>
          <input
            type="checkbox"
            checked={failNext()}
            onChange={(e) => setFailNext(e.currentTarget.checked)}
          />{" "}
          fail next request
        </label>
        <Show when={saving()}>
          <span class="badge warn">saving…</span>
        </Show>
        <Show when={lastError()}>
          <span class="badge warn">server error: {lastError()} (reverted)</span>
        </Show>
      </div>
      <div class="grid-box short">
        <AgGridSolid
          columnDefs={columnDefs}
          rowStore={optimisticRows}
          getRowId={(params) => params.data.id}
          defaultColDef={{ flex: 1 }}
        />
      </div>
      <p class="hint">
        Adds and deletes paint instantly from the <code>createOptimisticStore</code> overlay write;
        the action's <code>yield</code>ed server call runs in the background and confirms into the
        base store on success. Arm "fail next request" to watch a failed write auto-revert — the
        optimistic row vanishes (a deleted row comes back) with zero adapter-specific code. The
        "saving…" badge is a co-written <code>createOptimistic(false)</code> flag, and the status
        column is derived by reading the base store from inside a cell renderer.
      </p>
    </>
  );
};

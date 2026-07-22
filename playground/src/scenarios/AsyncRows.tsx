import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createMemo, createSignal, For, isPending, Loading, Show } from "solid-js";

import type { DatasetName, Product } from "../data";
import { DATASET_NAMES, makeProducts, money, sleep } from "../data";

const columnDefs: ColDef<Product>[] = [
  { field: "name", minWidth: 180 },
  { field: "category" },
  { field: "price", valueFormatter: (p) => money(p.value) },
  { field: "stock" },
];

export const AsyncRows = () => {
  const [dataset, setDataset] = createSignal<DatasetName>("laptops");
  const [latency, setLatency] = createSignal(1500);
  const [generation, setGeneration] = createSignal(1);

  // Async rowData, straight from the docs: read every signal BEFORE the first await
  // (reads after await never track), return the promise's value from the memo.
  const rows = createMemo(async () => {
    const name = dataset();
    const gen = generation();
    const ms = latency();
    await sleep(ms);
    return makeProducts(name, gen);
  });

  const revalidating = () => isPending(() => rows());

  return (
    <>
      <div class="toolbar">
        <label>dataset:</label>
        <For each={DATASET_NAMES}>
          {(name) => (
            <button
              class={dataset() === name ? "btn active" : "btn"}
              onClick={() => setDataset(name)}
            >
              {name}
            </button>
          )}
        </For>
        <button class="btn" onClick={() => setGeneration((g) => g + 1)}>
          refetch same dataset
        </button>
        <label>latency:</label>
        <select
          class="select"
          value={String(latency())}
          onChange={(e) => setLatency(Number(e.currentTarget.value))}
        >
          <option value="500">500 ms</option>
          <option value="1500">1.5 s</option>
          <option value="3000">3 s (slow network)</option>
        </select>
        {/* isPending rethrows NotReady while the source is UNINITIALIZED (very first load),
            so the badge needs its own <Loading> boundary; refetches return true without
            throwing. The grid needs no boundary — it guards its option props internally. */}
        <Loading fallback={<span class="badge warn">first load…</span>}>
          <Show when={revalidating()} fallback={<span class="badge live">data settled</span>}>
            <span class="badge warn">revalidating… (rows below stay visible)</span>
          </Show>
        </Loading>
      </div>
      <div class="grid-box short">
        <AgGridSolid columnDefs={columnDefs} rowData={rows()} defaultColDef={{ flex: 1 }} />
      </div>
      <p class="hint">
        The very first load shows the grid's own loading overlay (the pending prop is simply absent
        at creation). Every subsequent switch or refetch is stale-while-revalidate: the pending key
        is omitted from the change snapshot, so the grid keeps the old rows until the new promise
        resolves. Prefer an overlay during refetch? Drive it explicitly with{" "}
        <code>loading=&#123;isPending(() =&gt; rows())&#125;</code>.
      </p>
    </>
  );
};

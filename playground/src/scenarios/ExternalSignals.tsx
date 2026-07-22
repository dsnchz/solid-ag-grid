import type { CustomCellRendererProps, CustomNoRowsOverlayProps } from "@dschz/solid-ag-grid";
import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createSignal, onSettled, Show } from "solid-js";

import type { Ticker } from "../data";
import { rng, TICKERS } from "../data";

/* Module-level app state — lives entirely OUTSIDE the grid. The grid is never told
 * about any of this: cells and the overlay subscribe to it like any Solid JSX would. */

type Quote = { price: number; delta: number };

const initialQuotes = (): Record<string, Quote> =>
  Object.fromEntries(TICKERS.map((t) => [t.symbol, { price: t.base, delta: 0 }]));

const [quotes, setQuotes] = createSignal<Record<string, Quote>>(initialQuotes());
const [feedStatus, setFeedStatus] = createSignal<"live" | "paused">("live");
const [tickCount, setTickCount] = createSignal(0);

/** Cell renderer reading the app signal directly — zero grid API involvement. */
const PriceCell = (props: CustomCellRendererProps<Ticker>) => {
  const quote = () => quotes()[props.data?.symbol ?? ""];
  return (
    <span class={(quote()?.delta ?? 0) >= 0 ? "pill up" : "pill down"}>
      {quote()?.price.toFixed(2)}
      {"  "}
      {(quote()?.delta ?? 0) >= 0 ? "▲" : "▼"}
    </span>
  );
};

const DeltaCell = (props: CustomCellRendererProps<Ticker>) => {
  const delta = () => quotes()[props.data?.symbol ?? ""]?.delta ?? 0;
  return (
    <span>
      {delta() >= 0 ? "+" : ""}
      {delta().toFixed(2)}
    </span>
  );
};

/** No-rows overlay reading the same app signals — it updates live inside the grid. */
const FeedOverlay = (_props: CustomNoRowsOverlayProps<Ticker>) => (
  <div class="overlay-card">
    <div>no rows loaded</div>
    <div>
      feed is <strong>{feedStatus()}</strong> · {tickCount()} ticks so far
    </div>
  </div>
);

const columnDefs: ColDef<Ticker>[] = [
  { field: "symbol", maxWidth: 110 },
  { field: "company", minWidth: 200 },
  { headerName: "Price (app signal)", cellRenderer: PriceCell },
  { headerName: "Δ", cellRenderer: DeltaCell, maxWidth: 120 },
];

export const ExternalSignals = () => {
  const [rows, setRows] = createSignal<Ticker[]>(TICKERS);
  const rand = rng(Date.now() % 100000);

  onSettled(() => {
    const interval = setInterval(() => {
      if (feedStatus() !== "live") return;
      setTickCount((c) => c + 1);
      setQuotes((prev) => {
        const next = { ...prev };
        for (const t of TICKERS) {
          const q = prev[t.symbol] ?? { price: t.base, delta: 0 };
          const delta = Math.round((rand() - 0.5) * 200) / 100;
          next[t.symbol] = { price: Math.max(1, q.price + delta), delta };
        }
        return next;
      });
    }, 700);
    // Solid 2.0: cleanups from onSettled are RETURNED, not registered via onCleanup.
    return () => clearInterval(interval);
  });

  return (
    <>
      <div class="toolbar">
        <button
          class={feedStatus() === "live" ? "btn active" : "btn"}
          onClick={() => setFeedStatus(feedStatus() === "live" ? "paused" : "live")}
        >
          {feedStatus() === "live" ? "pause feed" : "resume feed"}
        </button>
        <Show
          when={rows().length > 0}
          fallback={
            <button class="btn primary" onClick={() => setRows(TICKERS)}>
              restore rows (hides overlay)
            </button>
          }
        >
          <button class="btn" onClick={() => setRows([])}>
            clear rows (shows live overlay)
          </button>
        </Show>
        <span class={feedStatus() === "live" ? "badge live" : "badge warn"}>
          feed {feedStatus()} · tick #{tickCount()}
        </span>
      </div>
      <div class="grid-box short">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rows()}
          noRowsOverlayComponent={FeedOverlay}
          defaultColDef={{ flex: 1 }}
        />
      </div>
      <p class="hint">
        The price cells and the no-rows overlay subscribe to module-level signals updated by a plain{" "}
        <code>setInterval</code>. No <code>api.refreshCells</code>, no transactions, no grid
        involvement at all — the JSX subscription is the update path.
      </p>
    </>
  );
};

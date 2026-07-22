import type { CustomCellRendererProps } from "@dschz/solid-ag-grid";
import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createMemo, createSignal } from "solid-js";

import type { Ticker } from "../data";
import { sleep, TICKERS } from "../data";

/** Fake per-cell API calls with staggered latency so cells reveal independently. */
const fetchQuote = async (base: number) => {
  await sleep(600 + Math.random() * 2400);
  return base * (0.95 + Math.random() * 0.1);
};

const fetchAnalystRating = async (symbol: string) => {
  await sleep(400 + Math.random() * 2800);
  const ratings = ["strong buy", "buy", "hold", "sell"] as const;
  return ratings[symbol.length % ratings.length]!;
};

/** Async renderer: reads an async memo directly; the cell's own <Loading> boundary
 *  shows loadingCellRenderer until this particular cell settles. */
const QuoteCell = (props: CustomCellRendererProps<Ticker, number>) => {
  const quote = createMemo(() => fetchQuote(props.data?.base ?? 0));
  return <span>${quote().toFixed(2)}</span>;
};

const RatingCell = (props: CustomCellRendererProps<Ticker, string>) => {
  const rating = createMemo(() => fetchAnalystRating(props.data?.symbol ?? ""));
  return (
    <span class={rating() === "sell" ? "pill down" : "pill up"}>{rating()}</span>
  );
};

const CellSkeleton = () => <span class="skeleton">fetching…</span>;

const columnDefs: ColDef<Ticker>[] = [
  { field: "symbol", maxWidth: 120 },
  { field: "company", minWidth: 200 },
  {
    headerName: "Live quote (async)",
    field: "base",
    cellRenderer: QuoteCell,
    loadingCellRenderer: CellSkeleton,
  },
  {
    headerName: "Analyst rating (async)",
    field: "symbol",
    colId: "rating",
    cellRenderer: RatingCell,
    loadingCellRenderer: CellSkeleton,
  },
];

export const AsyncCells = () => {
  // A fresh array identity remounts the rows, re-running every async renderer.
  const [rows, setRows] = createSignal(TICKERS.map((t) => ({ ...t })));

  return (
    <>
      <div class="toolbar">
        <button class="btn primary" onClick={() => setRows(TICKERS.map((t) => ({ ...t })))}>
          reload all cells
        </button>
      </div>
      <div class="grid-box short">
        <AgGridSolid columnDefs={columnDefs} rowData={rows()} defaultColDef={{ flex: 1 }} />
      </div>
      <p class="hint">
        Watch the two async columns: every cell resolves on its own schedule, showing its
        <code> loadingCellRenderer</code> fallback meanwhile. Sync columns render immediately and
        pay nothing. (Note: <code>agSkeletonCellRenderer</code> is not part of
        <code> AllCommunityModule</code>, hence the custom skeleton.)
      </p>
    </>
  );
};

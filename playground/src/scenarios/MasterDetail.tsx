import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { createMemo, createSignal } from "solid-js";

import type { Car, Order } from "../data";
import { makeCars, makeOrders, money } from "../data";

/** A row is either a car (master) or a synthetic full-width detail row for a car. */
type Row = Partial<Car> & { id: string; detail?: boolean; car?: Car };

const CARS = makeCars();

const orderCols: ColDef<Order>[] = [
  { field: "order", maxWidth: 130 },
  { field: "customer" },
  { field: "qty", maxWidth: 90 },
  { field: "total", valueFormatter: (p) => money(p.value) },
];

/** Full-width renderer mounting a second, fully independent AgGridSolid. */
const DetailPanel = (props: ICellRendererParams<Row>) => {
  // Read pushed props lazily (accessor), never in the component body.
  const orders = () => {
    const car = props.data?.car;
    return car ? makeOrders(car.id) : [];
  };
  return (
    <div class="detail-panel">
      <span class="detail-title">
        orders for {props.data?.car?.make} {props.data?.car?.model}
      </span>
      <div class="detail-grid">
        <AgGridSolid
          columnDefs={orderCols}
          rowData={orders()}
          defaultColDef={{ flex: 1 }}
          headerHeight={28}
          rowHeight={28}
        />
      </div>
    </div>
  );
};

export const MasterDetail = () => {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set<string>());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // New array identity on every toggle; getRowId keeps existing rows stable.
  const rows = createMemo<Row[]>(() =>
    CARS.flatMap((car): Row[] =>
      expanded().has(car.id)
        ? [car, { id: `${car.id}-detail`, detail: true, car }]
        : [car],
    ),
  );

  const ExpandCell = (props: ICellRendererParams<Row, string>) => (
    <span>
      <button class="expand-btn" onClick={() => props.data && toggle(props.data.id)}>
        {expanded().has(props.data?.id ?? "") ? "▼" : "▶"}
      </button>
      {props.value}
    </span>
  );

  const columnDefs: ColDef<Row>[] = [
    { field: "make", cellRenderer: ExpandCell, minWidth: 160 },
    { field: "model" },
    { field: "year", maxWidth: 110 },
    { field: "price", valueFormatter: (p) => money(p.value) },
  ];

  return (
    <>
      <div class="grid-box short">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rows()}
          getRowId={(params) => params.data.id}
          isFullWidthRow={(params) => !!params.rowNode.data?.detail}
          fullWidthCellRenderer={DetailPanel}
          getRowHeight={(params) => (params.data?.detail ? 220 : undefined)}
          defaultColDef={{ flex: 1 }}
        />
      </div>
      <p class="hint">
        Click ▶ to expand a car. The detail row is a community-edition full-width row whose
        renderer mounts a nested <code>AgGridSolid</code> — two live grids, one reactive graph.
        Collapse and re-expand freely; <code>getRowId</code> keeps master rows stable across the
        rowData identity changes.
      </p>
    </>
  );
};

import type { Context } from "ag-grid-community";

interface GridCompProps {
  context: Context;
}

// STUB — replaced by the full GridComp (GridCtrl + TabGuard tree) in T3.2.
const GridComp = (_props: GridCompProps) => {
  return <div class="ag-root-wrapper" role="presentation" />;
};

export default GridComp;

import { createEffect, createSignal } from "solid-js";

export interface AgGridSolidProps {
  class?: string;
}

/**
 * Placeholder component while the v36 port lands (see .agent/planning).
 * Exercises signals, a two-phase effect, and JSX to prove the Solid 2.0
 * toolchain end to end. Not a functional grid yet.
 */
const AgGridSolid = (props: AgGridSolidProps) => {
  const [ready, setReady] = createSignal(false);

  createEffect(
    () => props.class,
    () => {
      setReady(true);
      return () => setReady(false);
    },
  );

  return (
    <div
      class={props.class}
      data-testid="ag-grid-solid-placeholder"
      data-ready={ready() ? "true" : "false"}
    >
      @dschz/solid-ag-grid — v36 port in progress
    </div>
  );
};

export default AgGridSolid;

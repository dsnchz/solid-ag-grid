import type { JSX } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import type { Context, GetRowIdParams, GridApi, GridOptions, Module } from "ag-grid-community";
import { _processOnChange } from "ag-grid-community";
import {
  $PROXY,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  Show,
  snapshot,
  untrack,
  useContext,
} from "solid-js";

import { LicenseContext, ModulesContext } from "./agGridProvider";
import { extractGridPropertyChanges, readPropIfReady, snapshotGridProps } from "./core/asyncProps";
import { bootGrid } from "./core/gridBoot";
import GridPortals from "./core/gridPortals";
import { PortalManager } from "./core/portalManager";
import { createReadyQueue } from "./core/readyQueue";
import type { RowStoreAdapter } from "./core/rowStoreAdapter";
import { createRowStoreAdapter } from "./core/rowStoreAdapter";
import { SolidFrameworkOverrides } from "./core/solidFrameworkOverrides";
import GridComp from "./gridComp";

export type AgGridSolidRef<TData = any> = {
  api: GridApi<TData>;
};

export interface AgGridSolidProps<TData = any> extends GridOptions<TData> {
  gridOptions?: GridOptions<TData>;
  /**
   * Used to register AG Grid Modules directly with this instance of the grid.
   */
  modules?: Module[];
  /**
   * The CSS style to be applied to the grid's outermost div element.
   */
  containerStyle?: JSX.CSSProperties;
  /**
   * The CSS class to be applied to the grid's outermost div element.
   */
  class?: string;

  // The following property is only used when custom Solid components are rendered within a Javascript grid component via portals.
  /** Default: div */
  componentWrappingElement?: string;

  /**
   * Opt-in declarative row data: a Solid array store (plain, or a `createOptimisticStore`
   * view) whose mutations the wrapper projects into surgical grid transactions — structural
   * add/remove synchronously (instant optimistic paint), field updates via the grid's async
   * batch. Requires `getRowId` returning a STABLE, data-derived id (client-generate ids and
   * persist them; an id that changes across an optimistic confirm reads as remove+add).
   * Mutually exclusive with `rowData`; the store identity is fixed for the grid's lifetime.
   */
  rowStore?: readonly TData[];

  ref?: (ref: AgGridSolidRef<TData>) => void;
}

// Used to only pass gridOptions to the GridCoreCreator from the props
type SolidCompProps = Omit<AgGridSolidProps, keyof GridOptions>;
const solidPropsNotGridOptions: SolidCompProps = {
  gridOptions: undefined,
  modules: undefined,
  containerStyle: undefined,
  class: undefined,
  componentWrappingElement: undefined,
  rowStore: undefined,
  ref: undefined,
};
const excludeSolidCompProps = new Set(Object.keys(solidPropsNotGridOptions));

// Solid store proxies answer reads of the $PROXY symbol with themselves; plain arrays/objects
// answer undefined (same detection the adapter tests use). Used by the rowData guardrail below.
const isStoreProxy = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  (value as { readonly [key: symbol]: unknown })[$PROXY] !== undefined;

export const AgGridSolid = <TData,>(props: AgGridSolidProps<TData>) => {
  let eOutermost!: HTMLDivElement;
  let eInnermost!: HTMLDivElement;

  // context reads need the component's owner, so they run in the body (grid boot itself is in
  // onSettled below). The contexts carry accessors (see agGridProvider.tsx); the accessors are
  // dereferenced once, at boot, under untrack. null means "no AgGridProvider in the tree" —
  // the core uses that flag to tailor its missing-module error messages.
  const modulesFromContext = useContext(ModulesContext);
  const licenseKeyFromContext = useContext(LicenseContext);
  const usesAgGridProvider = modulesFromContext !== null;

  let api: GridApi<TData> | undefined;
  let frameworkOverrides: SolidFrameworkOverrides | undefined;
  const destroyFuncs: (() => void)[] = [];
  const readyQueue = createReadyQueue(() => frameworkOverrides?.shouldQueueUpdates() ?? false);

  const [context, setContext] = createSignal<Context>();

  // constructed eagerly in the body (allocation only — no DOM, SSR-safe): reactivity lives in
  // the portals signal INSIDE the manager, so the instance itself needs no signal wrapper and
  // the portal <For> below needs no existence guard
  const portalManager = new PortalManager(untrack(() => props.componentWrappingElement));

  // rowStore wiring (T6, src/core/rowStoreAdapter.ts): captured ONCE (§7.1 untrack — the store
  // identity is grid configuration, fixed for the grid's lifetime) and inert server-side (the
  // adapter never exists on the server, preserving the SSR shell contract).
  const rowStore = isServer ? undefined : untrack(() => props.rowStore);
  let rowStoreAdapter: RowStoreAdapter<TData> | undefined;
  let rowStoreModelMismatch = false;
  if (rowStore) {
    if ("rowData" in props) {
      console.warn(
        "AG Grid: both `rowData` and `rowStore` are provided — `rowData` is ignored; the row store drives row data.",
      );
    }
    // ADAPTER GUARDRAIL (API RULING, .agent/planning/STATUS.md): rowStore is the subscription
    // protocol against the CLIENT-SIDE row model only — the other models own their data
    // pipelines (datasources), and core applyTransaction against them is a silent no-op
    // (_getClientSideRowModel returns undefined). Resolution mirrors the core's option merge:
    // the direct prop wins over the gridOptions bag. Mismatch degrades HARDER than missing
    // getRowId: no adapter AND no static seed — a non-clientSide model can't consume rowData
    // at all (core logs error #200 if it is even passed), so the store is ignored entirely.
    const rowModelType = untrack(() => props.rowModelType ?? props.gridOptions?.rowModelType);
    const getRowId = untrack(() => props.getRowId);
    if (rowModelType !== undefined && rowModelType !== "clientSide") {
      rowStoreModelMismatch = true;
      console.warn(
        `AG Grid: \`rowStore\` requires the client-side row model (\`rowModelType\` is "${rowModelType}") — live row-store projection is disabled and the store is ignored; this row model sources data from its own datasource. Remove \`rowModelType\` to use \`rowStore\`.`,
      );
    } else if (getRowId === undefined) {
      // AG Grid's own validation style (cf. the core's notesDataSource getRowId validate):
      // console error, then run degraded — the grid still shows the store's initial snapshot
      console.error(
        "AG Grid: `rowStore` requires a `getRowId` callback (stable, data-derived row ids) — live row-store projection is disabled.",
      );
    } else {
      rowStoreAdapter = createRowStoreAdapter<TData>({
        store: rowStore,
        // key derivation matches the core's _getRowIdCallback (String-coerced). The cast covers
        // the seed pass, where api does not exist yet — getRowId used with rowStore must derive
        // the id from `data` alone (documented on the prop).
        getRowKey: (data) =>
          String(getRowId({ data, level: 0, api } as unknown as GetRowIdParams<TData>)),
        getApi: () => api,
        processWhenReady: readyQueue.processWhenReady,
      });
    }
  }

  // rowStore replaces rowData as the grid's data channel: excluding rowData from the
  // grid-option props means the prop-diff effect can never fight the adapter's transactions
  const excludeProps = rowStore
    ? new Set([...excludeSolidCompProps, "rowData"])
    : excludeSolidCompProps;

  // reactive guard for GridComp: context exists and is alive (set once per component instance;
  // teardown unmounts the whole component, so isDestroyed is re-checked only on context change)
  const liveContext = createMemo(() => {
    const ctx = context();
    return ctx && !ctx.isDestroyed() ? ctx : undefined;
  });

  onCleanup(() => {
    readyQueue.reset();
    for (const f of destroyFuncs) {
      f();
    }
    destroyFuncs.length = 0;
  });

  // grid creation must run exactly once. The guard was once load-bearing: boot originally ran
  // directly inside onSettled, whose caught pending async prop reads linked the computation
  // (dev: PENDING_ASYNC_FORBIDDEN_SCOPE) so it RE-RAN on resolve and booted a second grid.
  // Since boot moved one microtask off onSettled's scope, no reads remain inside onSettled and
  // nothing links it — today the guard is a defensive backstop (e.g. against future 2.0-beta
  // changes to onSettled's re-run semantics), not a fix for an active re-run path.
  let gridCreated = false;

  // runs once, in a microtask off onSettled and under untrack (see the onSettled below):
  // resolve the reactive inputs (contexts, prop snapshot), then hand off to bootGrid
  const createGrid = () => {
    const modules: Module[] = [...(props.modules ?? []), ...(modulesFromContext?.() ?? [])];
    const licenseKey = licenseKeyFromContext();

    // per-key isolation for async props (Open question 9 verdict — see src/core/asyncProps.ts):
    // not-ready keys are absent from the creation snapshot and arrive later via the prop-diff
    // effect
    const initialProps = snapshotGridProps(props, excludeProps, true);
    // ADAPTER GUARDRAIL (API RULING, .agent/planning/STATUS.md): rowData is the VALUE protocol
    // — you hand snapshots, identity-diffed. A store proxy handed here is read once; mutating
    // the store never changes the proxy's identity, so mutations NEVER reach the grid. The
    // check runs only on a successfully-read value (per-key isolation: a pending async rowData
    // is absent from the snapshot, never a proxy), so plain arrays, undefined, and
    // async-pending rowData stay silent. When rowStore is active, rowData is excluded above —
    // the both-props warning already covers that case.
    if (isStoreProxy(initialProps.rowData)) {
      console.warn(
        "AG Grid: `rowData` received a Solid store proxy — `rowData` is snapshot once and identity-diffed, so store mutations will NOT update the grid. Pass plain (or async) values to `rowData`, or use the `rowStore` prop for live store projection.",
      );
    }
    const gridOptionsHolder: { gridOptions?: GridOptions<TData> } = {};
    readPropIfReady(props, "gridOptions", gridOptionsHolder, true);

    if (rowStore && !rowStoreModelMismatch) {
      // seed rowData from the adapter's creation-time snapshot — the exact baseline its
      // structural diff starts from, so store mutations landing before the grid is ready
      // replay as queued transactions with no double-apply. Degraded mode (missing getRowId,
      // no adapter) still shows the initial snapshot, statically. Row-model mismatch (see the
      // guardrail above) passes NO rowData at all — a non-clientSide model rejects the option.
      // degraded mode (no getRowId): static seed via the clean whole-array snapshot form
      initialProps.rowData = rowStoreAdapter
        ? rowStoreAdapter.seedRows
        : untrack(() => snapshot(rowStore));
    }

    frameworkOverrides = new SolidFrameworkOverrides(
      readyQueue.processQueuedUpdates,
      usesAgGridProvider,
    );

    api = bootGrid<TData>({
      eOutermost,
      eInnermost,
      modules,
      licenseKey,
      initialProps,
      gridOptions: gridOptionsHolder.gridOptions,
      portalManager,
      frameworkOverrides,
      drainAndMarkReady: readyQueue.drainAndMarkReady,
      addDestroyFunc: (func) => destroyFuncs.push(func),
      setContext,
      // grid-core callback (untracked): fires once the UI is initialised, exposing the api ref
      onGridUiReady: () => {
        if (api) {
          props.ref?.({ api });
        }
      },
    });
    destroyFuncs.push(() => {
      api = undefined;
    });
  };

  // grid creation needs both styled-root layer elements attached to the document (the core
  // measures/installs styles against them), so it runs in onSettled rather than the ref
  // callbacks — Solid refs fire while the template is still disconnected.
  onSettled(() => {
    if (gridCreated) {
      return;
    }
    gridCreated = true;
    // SSR contract: the server renders only the shell divs; the grid boots once, client-side,
    // after hydration. onSettled should already be server-inert, but the guard makes the
    // contract explicit rather than an implicit invariant of the 2.0 beta.
    if (isServer) {
      return;
    }
    // creation runs one microtask off onSettled's scope: reading a pending async prop INSIDE
    // onSettled logs PENDING_ASYNC_FORBIDDEN_SCOPE (dev) even through latest(), because the
    // warning fires at read time in the forbidden scope. In a plain microtask a pending read
    // either returns undefined (latest() on a never-resolved source) or throws a not-ready
    // error — the per-key snapshot handles both as "absent" — so the async-rowData boot path
    // produces zero console noise, contract unchanged (pinned by browser tests).
    queueMicrotask(() => untrack(createGrid));
  });

  createEffect(
    // compute: read every grid-option prop key so each one is tracked, and return the snapshot.
    // Not-ready async keys are omitted per-key (Open question 9 verdict — see
    // src/core/asyncProps.ts): the tracked read already subscribed this compute, so it re-runs
    // — and the key diffs in — on resolve.
    () => snapshotGridProps(props, excludeProps),
    // apply: diff against the previous snapshot and route the changes through the ready queue
    (nextProps, prevProps) => {
      if (!prevProps) {
        // first run: initial props were already handed to GridCoreCreator
        return;
      }
      const changes = extractGridPropertyChanges(prevProps, nextProps);
      if (Object.keys(changes).length === 0) {
        return;
      }
      readyQueue.processWhenReady(() => {
        if (api) {
          _processOnChange(changes, api);
        }
      });
    },
  );

  return (
    <div
      class={props.class}
      style={{ width: "100%", height: "100%", ...props.containerStyle }}
      ref={eOutermost}
    >
      {/* IMPORTANT we need 3 layers of divs with NO class because the class is managed by the styled root */}
      <div /* do not set class here */>
        <div /* do not set class here */>
          <div /* do not set class here */ ref={eInnermost}>
            <Show when={liveContext()}>{(ctx) => <GridComp context={ctx()} />}</Show>
            <GridPortals portalManager={portalManager} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgGridSolid;

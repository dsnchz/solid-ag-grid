import type { JSX } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import type { Context, GridApi, GridOptions, GridParams, Module } from "ag-grid-community";
import {
  _combineAttributesAndGridOptions,
  _processOnChange,
  GridCoreCreator,
} from "ag-grid-community";
import {
  createEffect,
  createMemo,
  createSignal,
  NotReadyError,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import GridPortals from "./core/gridPortals";
import { PortalManager } from "./core/portalManager";
import { RenderStatusService } from "./core/renderStatusService";
import { SolidFrameworkComponentWrapper } from "./core/solidFrameworkComponentWrapper";
import { SolidFrameworkOverrides } from "./core/solidFrameworkOverrides";
import GridComp from "./gridComp";

export interface AgGridSolidRef<TData = any> {
  api: GridApi<TData>;
}

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
  ref: undefined,
};
const excludeSolidCompProps = new Set(Object.keys(solidPropsNotGridOptions));

// ASYNC GRID-OPTION PROPS VERDICT (ARCHITECTURE.md Open question 9, resolved T3.4):
// PER-KEY ISOLATION, async rowData as a zero-ceremony feature. Solid 2.0 users will pass
// async-sourced props (`rowData={data()}` from an async createMemo); a not-ready read throws
// NotReadyError. If we let it propagate, ONE pending prop suspends the whole prop-diff compute
// and stalls ALL prop-change application (footgun). Instead every prop key is read through a
// per-key try/catch: not-ready keys are simply omitted from the snapshot — at grid creation
// that means `rowData: undefined` (the grid shows its loading overlay, exactly the UX async
// data wants), and in the prop-diff compute the tracked read has already subscribed us, so the
// compute re-runs when the value resolves and the key diffs in as a normal grid-option change.
// Evidence: test/browser/rowsCells.browser.test.tsx ("async rowData").
const isNotReadyError = (e: unknown): boolean =>
  e instanceof NotReadyError ||
  // dev-mode untracked pending reads (grid creation runs in onSettled/untrack) throw a plain
  // Error carrying this diagnostic code instead of NotReadyError
  (e instanceof Error && e.message.includes("PENDING_ASYNC_UNTRACKED_READ"));

/** Reads props[key], treating a not-ready async prop as "absent" (per-key isolation). */
const readPropIfReady = (
  props: { [key: string]: any },
  key: string,
  target: { [key: string]: any },
): void => {
  try {
    target[key] = props[key];
  } catch (e) {
    if (!isNotReadyError(e)) {
      throw e;
    }
  }
};

export const AgGridSolid = <TData,>(props: AgGridSolidProps<TData>) => {
  let eOutermost!: HTMLDivElement;
  let eInnermost!: HTMLDivElement;

  let api: GridApi<TData> | undefined;
  let frameworkOverrides: SolidFrameworkOverrides | undefined;
  const destroyFuncs: (() => void)[] = [];
  const whenReadyFuncs: (() => void)[] = [];
  let ready = false;

  const [context, setContext] = createSignal<Context>();

  // constructed eagerly in the body (allocation only — no DOM, SSR-safe): reactivity lives in
  // the portals signal INSIDE the manager, so the instance itself needs no signal wrapper and
  // the portal <For> below needs no existence guard
  const portalManager = new PortalManager(untrack(() => props.componentWrappingElement));

  // reactive guard for GridComp: context exists and is alive (set once per component instance;
  // teardown unmounts the whole component, so isDestroyed is re-checked only on context change)
  const liveContext = createMemo(() => {
    const ctx = context();
    return ctx && !ctx.isDestroyed() ? ctx : undefined;
  });

  onCleanup(() => {
    ready = false;
    for (const f of destroyFuncs) {
      f();
    }
    destroyFuncs.length = 0;
  });

  // grid creation must run exactly once: reading a pending async prop inside onSettled links
  // the onSettled computation to the async node (dev warns PENDING_ASYNC_FORBIDDEN_SCOPE), so
  // onSettled RE-RUNS when the value resolves — without this guard a second grid would boot on
  // the same elements (found via the Open question 9 browser test)
  let gridCreated = false;

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
    untrack(() => {
      const modules: Module[] = [...(props.modules ?? [])];

      destroyFuncs.push(() => {
        portalManager.destroy();
      });

      // per-key isolation for async props (see the Open question 9 verdict above): not-ready
      // keys are absent from the creation snapshot and arrive later via the prop-diff effect
      const initialProps: { [key: string]: any } = {};
      for (const key of Object.keys(props)) {
        if (!excludeSolidCompProps.has(key)) {
          readPropIfReady(props, key, initialProps);
        }
      }
      const gridOptionsHolder: { gridOptions?: GridOptions<TData> } = {};
      readPropIfReady(props, "gridOptions", gridOptionsHolder);

      const mergedGridOps = _combineAttributesAndGridOptions(
        gridOptionsHolder.gridOptions,
        initialProps,
        Object.keys(initialProps),
      );

      const processQueuedUpdates = () => {
        if (ready) {
          const getFn = () =>
            frameworkOverrides?.shouldQueueUpdates() ? undefined : whenReadyFuncs.shift();
          let fn = getFn();
          while (fn) {
            fn();
            fn = getFn();
          }
        }
      };

      frameworkOverrides = new SolidFrameworkOverrides(processQueuedUpdates, false);
      const renderStatus = new RenderStatusService();
      const gridParams: GridParams = {
        providedBeanInstances: {
          frameworkCompWrapper: new SolidFrameworkComponentWrapper(portalManager, mergedGridOps),
          renderStatus,
        },
        modules,
        frameworkOverrides,
      };

      const createUiCallback = (ctx: Context) => {
        setContext(ctx);
        ctx.createBean(renderStatus);

        destroyFuncs.push(() => {
          ctx.destroy();
        });

        // because Solid 2.0 renders async, we need to wait for the UI to be initialised before exposing the API's
        ctx.getBean("ctrlsSvc").whenReady(
          {
            addDestroyFunc: (func) => {
              destroyFuncs.push(func);
            },
          },
          // eslint-disable-next-line solid/reactivity -- grid-core callback, intentionally untracked
          () => {
            if (ctx.isDestroyed()) {
              return;
            }

            if (api) {
              props.ref?.({ api });
            }
          },
        );
      };

      // this callback adds to ctrlsSvc.whenReady(), just like above, however because whenReady() executes
      // funcs in the order they were received, we know adding items here will be AFTER the grid has set columns
      // and data. this is because GridCoreCreator sets these between calling createUiCallback and acceptChangesCallback
      const acceptChangesCallback = (ctx: Context) => {
        ctx.getBean("ctrlsSvc").whenReady(
          {
            addDestroyFunc: (func) => {
              destroyFuncs.push(func);
            },
          },
          () => {
            for (const f of whenReadyFuncs) {
              f();
            }
            whenReadyFuncs.length = 0;
            ready = true;
          },
        );
      };

      const gridCoreCreator = new GridCoreCreator();
      api = gridCoreCreator.create(
        eOutermost,
        eInnermost,
        mergedGridOps,
        createUiCallback,
        acceptChangesCallback,
        gridParams,
      ) as GridApi<TData>;
      destroyFuncs.push(() => {
        api = undefined;
      });
    });
  });

  const processWhenReady = (func: () => void) => {
    if (ready && !frameworkOverrides?.shouldQueueUpdates()) {
      func();
    } else {
      whenReadyFuncs.push(func);
    }
  };

  createEffect(
    // compute: read every grid-option prop key so each one is tracked, and return the snapshot.
    // Not-ready async keys are omitted per-key (Open question 9 verdict above): the tracked
    // read already subscribed this compute, so it re-runs — and the key diffs in — on resolve.
    () => {
      const snapshot: { [key: string]: any } = {};
      for (const propKey of Object.keys(props)) {
        if (excludeSolidCompProps.has(propKey)) {
          continue;
        }
        readPropIfReady(props, propKey, snapshot);
      }
      return snapshot;
    },
    // apply: diff against the previous snapshot and route the changes through processWhenReady
    (nextProps, prevProps) => {
      if (!prevProps) {
        // first run: initial props were already handed to GridCoreCreator
        return;
      }
      const changes = extractGridPropertyChanges(prevProps, nextProps);
      if (Object.keys(changes).length === 0) {
        return;
      }
      processWhenReady(() => {
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

function extractGridPropertyChanges(
  prevProps: { [key: string]: any },
  nextProps: { [key: string]: any },
): { [p: string]: any } {
  const changes: { [p: string]: any } = {};
  for (const propKey of Object.keys(nextProps)) {
    const propValue = nextProps[propKey];
    if (prevProps[propKey] !== propValue) {
      changes[propKey] = propValue;
    }
  }

  return changes;
}

export default AgGridSolid;

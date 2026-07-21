import type { JSX } from "@solidjs/web";
import { isServer, Portal } from "@solidjs/web";
import type { Context, GridApi, GridOptions, GridParams, Module } from "ag-grid-community";
import {
  _combineAttributesAndGridOptions,
  _processOnChange,
  GridCoreCreator,
} from "ag-grid-community";
import { createEffect, createSignal, For, onCleanup, onSettled, untrack } from "solid-js";

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

export const AgGridSolid = <TData,>(props: AgGridSolidProps<TData>) => {
  let eOutermost!: HTMLDivElement;
  let eInnermost!: HTMLDivElement;

  let api: GridApi<TData> | undefined;
  let frameworkOverrides: SolidFrameworkOverrides | undefined;
  const destroyFuncs: (() => void)[] = [];
  const whenReadyFuncs: (() => void)[] = [];
  let ready = false;

  const [context, setContext] = createSignal<Context>();
  const [portalManager, setPortalManager] = createSignal<PortalManager>();

  onCleanup(() => {
    ready = false;
    for (const f of destroyFuncs) {
      f();
    }
    destroyFuncs.length = 0;
  });

  // grid creation needs both styled-root layer elements attached to the document (the core
  // measures/installs styles against them), so it runs in onSettled rather than the ref
  // callbacks — Solid refs fire while the template is still disconnected.
  onSettled(() => {
    // SSR contract: the server renders only the shell divs; the grid boots once, client-side,
    // after hydration. onSettled should already be server-inert, but the guard makes the
    // contract explicit rather than an implicit invariant of the 2.0 beta.
    if (isServer) {
      return;
    }
    untrack(() => {
      const modules: Module[] = [...(props.modules ?? [])];

      const manager = new PortalManager(props.componentWrappingElement);
      setPortalManager(manager);
      destroyFuncs.push(() => {
        manager.destroy();
      });

      const mergedGridOps = _combineAttributesAndGridOptions(
        props.gridOptions,
        props,
        Object.keys(props).filter((key) => !excludeSolidCompProps.has(key)),
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
          frameworkCompWrapper: new SolidFrameworkComponentWrapper(manager, mergedGridOps),
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
    // compute: read every grid-option prop key so each one is tracked, and return the snapshot
    () => {
      const snapshot: { [key: string]: any } = {};
      for (const propKey of Object.keys(props)) {
        if (excludeSolidCompProps.has(propKey)) {
          continue;
        }
        snapshot[propKey] = (props as any)[propKey];
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
            {context() && !context()!.isDestroyed() ? <GridComp context={context()!} /> : null}
            <For each={portalManager()?.getPortals() ?? []}>
              {(info) => (
                <Portal mount={info.mount}>
                  <info.SolidClass {...info.props} ref={info.ref} />
                </Portal>
              )}
            </For>
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

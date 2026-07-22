import type { Context, GridApi, GridOptions, GridParams, Module } from "ag-grid-community";
import {
  _combineAttributesAndGridOptions,
  _findEnterpriseCoreModule,
  GridCoreCreator,
} from "ag-grid-community";

import type { PortalManager } from "./portalManager";
import { RenderStatusService } from "./renderStatusService";
import { SolidFrameworkComponentWrapper } from "./solidFrameworkComponentWrapper";
import type { SolidFrameworkOverrides } from "./solidFrameworkOverrides";

// The grid boot sequence, extracted from AgGridSolid. Everything here is straight-line and
// non-reactive: the component resolves all reactive inputs first (prop snapshot, contexts)
// and calls bootGrid from its creation microtask, under untrack — see the onSettled block in
// src/agGridSolid.tsx for the timing rationale.
export type GridBootParams<TData> = {
  /** The user-facing container div (outermost styled-root layer element). */
  readonly eOutermost: HTMLDivElement;
  /** The innermost of the 3 unclassed layer divs — the grid UI mounts inside it. */
  readonly eInnermost: HTMLDivElement;
  /** The `modules` prop merged with provider-context modules. */
  readonly modules: Module[];
  /** License key from AgGridProvider context, if any. */
  readonly licenseKey: string | null | undefined;
  /** Creation-time snapshot of grid-option props (not-ready async keys already omitted). */
  readonly initialProps: { [key: string]: any };
  /** The `gridOptions` prop, when supplied (and ready). */
  readonly gridOptions: GridOptions<TData> | undefined;
  readonly portalManager: PortalManager;
  readonly frameworkOverrides: SolidFrameworkOverrides;
  /** ReadyQueue hook wired to the grid core's accept-changes whenReady slot. */
  readonly drainAndMarkReady: () => void;
  /** Registers teardown work with the component's onCleanup-driven destroy list. */
  readonly addDestroyFunc: (func: () => void) => void;
  /** Publishes the grid context to the component (renders GridComp via liveContext). */
  readonly setContext: (ctx: Context) => void;
  /** Grid-core callback once the UI is initialised — the component exposes `props.ref` here. */
  readonly onGridUiReady: () => void;
};

/** Creates the grid core against the layer elements and wires its lifecycle callbacks. */
export const bootGrid = <TData>(params: GridBootParams<TData>): GridApi<TData> => {
  const {
    eOutermost,
    eInnermost,
    modules,
    licenseKey,
    initialProps,
    gridOptions,
    portalManager,
    frameworkOverrides,
    drainAndMarkReady,
    addDestroyFunc,
    setContext,
    onGridUiReady,
  } = params;

  if (licenseKey) {
    // find the EnterpriseCore module which implements _ModuleWithLicenseManager; the lookup
    // runs over the merged list because the enterprise bundle may arrive via the `modules`
    // prop while the key arrives via the provider
    _findEnterpriseCoreModule(modules)?.setLicenseKey(licenseKey);
  }

  addDestroyFunc(() => {
    portalManager.destroy();
  });

  const mergedGridOps = _combineAttributesAndGridOptions(
    gridOptions,
    initialProps,
    Object.keys(initialProps),
  );

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

    addDestroyFunc(() => {
      ctx.destroy();
    });

    // because Solid 2.0 renders async, we need to wait for the UI to be initialised before exposing the API's
    ctx.getBean("ctrlsSvc").whenReady({ addDestroyFunc }, () => {
      if (ctx.isDestroyed()) {
        return;
      }
      onGridUiReady();
    });
  };

  // this callback adds to ctrlsSvc.whenReady(), just like above, however because whenReady() executes
  // funcs in the order they were received, we know adding items here will be AFTER the grid has set columns
  // and data. this is because GridCoreCreator sets these between calling createUiCallback and acceptChangesCallback
  const acceptChangesCallback = (ctx: Context) => {
    ctx.getBean("ctrlsSvc").whenReady({ addDestroyFunc }, drainAndMarkReady);
  };

  const gridCoreCreator = new GridCoreCreator();
  return gridCoreCreator.create(
    eOutermost,
    eInnermost,
    mergedGridOps,
    createUiCallback,
    acceptChangesCallback,
    gridParams,
  ) as GridApi<TData>;
};

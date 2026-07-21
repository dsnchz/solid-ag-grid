import type { JSX } from "@solidjs/web";
import type { Module } from "ag-grid-community";
import { _areEqual } from "ag-stack";
import type { Accessor } from "solid-js";
import { createContext, createMemo, useContext } from "solid-js";

export type AgGridProviderProps = {
  /**
   * The AG Grid Modules to be used by all grid instances within this provider.
   */
  readonly modules: Module[];
  /**
   * The AG Grid license key to be used by all grid instances within this provider when Enterprise features are used.
   */
  readonly licenseKey?: string;
  /**
   * The child components that will have access to the AG Grid context.
   */
  readonly children: JSX.Element;
};

// Both contexts carry ACCESSORS, not values: a Solid 2.0 context provider's `value` attribute
// is not a tracking scope, so passing `mergedModules()` directly would be an untracked read of
// a reactive value (dev diagnostic STRICT_READ_UNTRACKED) frozen at provider creation. Passing
// the accessor defers every read to a legal scope — nested providers read it inside their own
// memo compute (tracked), and AgGridSolid reads it once at grid boot under untrack.
/** Defaults to null (no AgGridProvider in the tree). When an AgGridProvider is present, it provides an accessor of Module[] (possibly empty). */
export const ModulesContext = createContext<Accessor<Module[]> | null>(null);
// null (not undefined) is the "no license key" sentinel: Solid 2.0 treats an undefined default
// AND an undefined provided value as "context not set" and makes useContext throw
export const LicenseContext = createContext<Accessor<string | null>>(() => null);

/**
 * Provide AG Grid Modules to all grid instances within this scope via Solid Context. If nested, modules are
 * accumulated from all providers and provided to each AgGridSolid instance.
 *
 * If a licenseKey is provided it will be passed to the global `LicenseManager.setLicenseKey(licenseKey)`.
 *
 * This is an alternative to providing modules globally via `ModuleRegistry.registerModules()` and setting the
 * license key via `LicenseManager.setLicenseKey()`.
 */
export const AgGridProvider = (props: AgGridProviderProps) => {
  const parentModules = useContext(ModulesContext);
  const parentLicenseKey = useContext(LicenseContext);

  // Parent modules first, own modules last (parity with React). The grid handles duplicated
  // modules so no need to worry about that here. React kept the merged array referentially
  // stable across re-renders with a ref + _areEqual dance; the Solid equivalent is a memo
  // whose equality is content-based, so a reactive `modules` prop re-evaluating to the same
  // contents never republishes.
  const mergedModules = createMemo(() => [...(parentModules?.() ?? []), ...props.modules], {
    equals: (a, b) => _areEqual(a, b),
  });

  // Use this provider's licenseKey if provided, otherwise inherit from parent. We cannot
  // safely set the licenseKey here: enterprise modules may be given to an AgGridSolid
  // instance directly via its `modules` prop, so the license manager may not be reachable
  // from the modules this provider can see — each grid sets it over its own merged list.
  const licenseKey = createMemo(() => props.licenseKey ?? parentLicenseKey());

  return (
    <ModulesContext value={mergedModules}>
      <LicenseContext value={licenseKey}>{props.children}</LicenseContext>
    </ModulesContext>
  );
};

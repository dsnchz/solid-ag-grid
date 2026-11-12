import { _PUBLIC_EVENT_HANDLERS_MAP } from "ag-grid-community";
import type { Accessor } from "solid-js";
import { createMemo, isPending, mapArray } from "solid-js";

// ASYNC GRID-OPTION PROPS VERDICT (ARCHITECTURE.md Open question 9, resolved T3.4):
// PER-KEY ISOLATION, async rowData as a zero-ceremony feature. Solid 2.0 users will pass
// async-sourced props (`rowData={data()}` from an async createMemo); a not-ready read throws
// NotReadyError. If we let it propagate, ONE pending prop suspends the whole prop-diff compute
// and stalls ALL prop-change application (footgun). Instead every prop key is guarded and read
// on its own: not-ready keys are simply omitted from the snapshot — at grid creation that means
// `rowData: undefined` (the grid shows its loading overlay, exactly the UX async data wants),
// and in the prop-diff compute the guard read has subscribed us, so the compute re-runs when
// the value lands and the key diffs in as a normal grid-option change.
// Evidence: test/browser/rowsCells.browser.test.tsx ("async rowData").
//
// HOW A KEY IS GUARDED (catch-free; solidjs/solid#4789, answered on rc.21): every grid-option
// key gets a passthrough memo `createMemo(() => props[key], { loadingValue: ABSENT })`. A memo
// with a `loadingValue` has committed its first value, so a never-loaded async prop reads as
// ABSENT instead of throwing, and nothing reading it suspends. Headless probe on rc.21:
// - never loaded: the guard reads ABSENT, isPending(guard) is false, no diagnostic;
// - landed: the guard re-runs its readers with the value;
// - refetch of a loaded source: isPending(guard) is true, so the diff omits the key (SWR); an
//   untracked read (grid creation) holds the previous value;
// - other keys change freely in every state above.
// The guards live in a mapArray over the props' own keys, so a spread props object that adds
// or drops a key creates or disposes that key's guard. The memos are per option, not per row
// or column: a few dozen per grid, whatever its size. This replaced a narrow NotReadyError
// catch that raised CAUGHT_REACTIVE_READ once per grid on rc.21.

/** What a guard reads while its prop has never produced a value. */
export const ABSENT: unique symbol = Symbol("absent");

/** One grid-option prop, read through its guard: the value, or {@link ABSENT}. */
export type PropGuard = Accessor<unknown>;

/** The guarded grid-option keys, in the props object's own key order. */
export type GridPropGuards = Accessor<(readonly [key: string, guard: PropGuard])[]>;

/** Guards one prop key (see the verdict above). Call under the component's owner. */
export const guardProp = <P extends object, K extends keyof P & string>(
  props: P,
  key: K,
): Accessor<P[K] | typeof ABSENT> =>
  createMemo<P[K] | typeof ABSENT>(() => props[key], {
    loadingValue: ABSENT,
    name: `AgGridSolid.prop.${key}`,
  });

/**
 * Guards every grid-option prop: excluded (Solid-only) keys are skipped; a key added to or
 * dropped from the props object gains or loses its guard.
 */
export const createGridPropGuards = (
  props: { [key: string]: any },
  excludeKeys: ReadonlySet<string>,
): GridPropGuards =>
  mapArray(
    () => Object.keys(props).filter((key) => !excludeKeys.has(key)),
    (key) => [key, guardProp(props, key)] as const,
    { name: "AgGridSolid.propGuards" },
  );

/**
 * Builds a per-key-isolated snapshot of the guarded props. `values` omits a key that has never
 * loaded; the prop-diff read also omits a refetching key (SWR). The creation read (`atCreation`,
 * untracked) keeps a refetching key's previous value. `keys` lists every guarded key, pending
 * ones included.
 */
export const snapshotGridProps = (
  guards: GridPropGuards,
  atCreation = false,
): { values: { [key: string]: unknown }; keys: string[] } => {
  const values: { [key: string]: unknown } = {};
  const keys: string[] = [];
  for (const [key, guard] of guards()) {
    keys.push(key);
    if (!atCreation && isPending(guard)) {
      continue;
    }
    const value = guard();
    if (value !== ABSENT) {
      values[key] = value;
    }
  }
  return { values, keys };
};

const eventHandlerProps = new Set<string>(Object.values(_PUBLIC_EVENT_HANDLERS_MAP));

/**
 * Diffs two prop snapshots by reference equality, returning only the changed keys. An event
 * handler dropped from the props object (in `prevKeys`, not in `nextKeys`) is reported as
 * `undefined` so the grid stops calling it; other dropped keys keep their value (ag-grid-react
 * parity). The key lists are the props object's own keys, NOT the snapshots': a pending async
 * key is omitted from its snapshot yet still present on props, so a pending handler keeps its
 * value like any other pending key (omitted ≠ undefined — the SWR contract of the verdict above).
 */
export const extractGridPropertyChanges = (
  prevProps: { [key: string]: any },
  nextProps: { [key: string]: any },
  prevKeys: readonly string[],
  nextKeys: readonly string[],
): { [p: string]: any } => {
  const changes: { [p: string]: any } = {};
  for (const propKey of Object.keys(nextProps)) {
    const propValue = nextProps[propKey];
    if (prevProps[propKey] !== propValue) {
      changes[propKey] = propValue;
    }
  }
  // a dropped event handler prop must stop being called; other dropped props keep their value
  for (const propKey of prevKeys) {
    if (eventHandlerProps.has(propKey) && !nextKeys.includes(propKey)) {
      changes[propKey] = undefined;
    }
  }

  return changes;
};

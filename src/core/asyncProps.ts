import { _PUBLIC_EVENT_HANDLERS_MAP } from "ag-grid-community";
import { isPending, latest, NotReadyError } from "solid-js";

// ASYNC GRID-OPTION PROPS VERDICT (ARCHITECTURE.md Open question 9, resolved T3.4):
// PER-KEY ISOLATION, async rowData as a zero-ceremony feature. Solid 2.0 users will pass
// async-sourced props (`rowData={data()}` from an async createMemo); a not-ready read throws
// NotReadyError. If we let it propagate, ONE pending prop suspends the whole prop-diff compute
// and stalls ALL prop-change application (footgun). Instead every prop key is probed and read
// on its own: not-ready keys are simply omitted from the snapshot — at grid creation that means
// `rowData: undefined` (the grid shows its loading overlay, exactly the UX async data wants),
// and in the prop-diff compute the probe/read has subscribed us, so the compute re-runs when the
// value lands and the key diffs in as a normal grid-option change.
// Evidence: test/browser/rowsCells.browser.test.tsx ("async rowData").
//
// HOW THE PROBE IS SHAPED (Solid ruling, documentation/solid-2.0/04-stores.md "A derive must
// never swallow NotReadyError" / solid#3073 — branch on readiness with isPending() rather than
// catching), measured on rc.7, re-verified on rc.11 and rc.21 (test "real async memo" below):
// - refetch of an INITIALIZED source: the read holds the previous value in one phase and throws
//   in a later one; isPending() reports true without throwing in both. So isPending() is the
//   probe: a pending key is omitted, the pending-signal companion re-runs us when it lands.
// - an UNINITIALIZED source (never resolved): the read throws — and so does isPending() itself,
//   by engine rule (an uninitialized async read inside a computation must suspend; there is no
//   previous value to hold). Per-key isolation deliberately diverges here: this is a client-only
//   effect compute (grid creation is server-inert, effects never run in SSR), the dependency
//   registers before the throw so the re-run on settle is the documented browser mechanism,
//   and "absent" is the UX we want. That one case keeps a narrow catch. Do not widen it.
// - rc.21 adds the dev diagnostic CAUGHT_REACTIVE_READ (D-42, solid#4481), which reports this
//   catch once per grid while a never-loaded async prop is pending. Behavior is unchanged on
//   rc.21 (the compute still re-runs on the landing; headless repro). The sanctioned rethrow
//   would suspend the whole compute and hold EVERY other prop until the slowest first load,
//   which is the footgun per-key isolation exists to avoid. Asked upstream for a catch-free
//   probe (solidjs/solid#4789); replace the catch with it when one ships.
const isNotReadyError = (e: unknown): boolean =>
  e instanceof NotReadyError ||
  // dev-mode untracked pending reads (grid creation runs in onSettled/untrack) throw a plain
  // Error carrying this diagnostic code instead of NotReadyError
  (e instanceof Error && e.message.includes("PENDING_ASYNC_UNTRACKED_READ"));

/** Reads props[key], treating a not-ready async prop as "absent" (per-key isolation). */
export const readPropIfReady = (
  props: { [key: string]: any },
  key: string,
  target: { [key: string]: any },
  // creation-time reads (the boot microtask off onSettled) go through latest(): it bypasses
  // the pending-link
  // machinery, so a pending async prop neither logs PENDING_ASYNC_FORBIDDEN_SCOPE nor links
  // the boot computation for a re-run (the gridCreated guard stays as backstop). The prop-diff
  // effect keeps normal tracked reads — there the subscription IS the resolve mechanism.
  viaLatest = false,
): void => {
  try {
    if (viaLatest) {
      target[key] = latest(() => props[key]);
      return;
    }
    // sanctioned probe: a refetching (initialized) async prop reads as absent, no throw
    if (isPending(() => props[key])) {
      return;
    }
    target[key] = props[key];
  } catch (e) {
    // the uninitialized case only (see the verdict above): isPending() rethrows it by design
    if (!isNotReadyError(e)) {
      throw e;
    }
  }
};

/**
 * Builds a per-key-isolated snapshot of the grid-option props: excluded (Solid-only) keys are
 * skipped, not-ready async keys are omitted (see the verdict above).
 */
export const snapshotGridProps = (
  props: { [key: string]: any },
  excludeKeys: ReadonlySet<string>,
  viaLatest = false,
): { [key: string]: any } => {
  const snapshot: { [key: string]: any } = {};
  for (const key of Object.keys(props)) {
    if (!excludeKeys.has(key)) {
      readPropIfReady(props, key, snapshot, viaLatest);
    }
  }
  return snapshot;
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

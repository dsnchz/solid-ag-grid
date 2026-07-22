// The wrapper's async-COMMIT accommodation queue (docs/field-guide/02, "Async data vs async
// commit"): grid-option changes arriving before the grid UI is ready — or while the core holds
// its refresh lock — are queued and replayed in arrival order once the grid can accept them.
//
// Plain mutables by doctrine (ARCHITECTURE §5.1, reactive doctrine point 5): nothing derives
// from `ready` or `whenReadyFuncs` — they are machinery state, not rendering state — and the
// queue needs read-after-write immediacy that batched signal writes cannot give (a func queued
// and drained within one grid-core callback must observe its own push). Code must tell the
// truth about what is reactive; none of this is.

export type ReadyQueue = {
  /** Runs `func` now if the grid is ready and not queueing; otherwise queues it. */
  readonly processWhenReady: (func: () => void) => void;
  /**
   * Drains the queue in arrival order, then marks the grid ready. Wired to the grid core's
   * acceptChangesCallback whenReady slot — the point after which updates may apply directly.
   */
  readonly drainAndMarkReady: () => void;
  /**
   * Replays queued funcs if ready, re-checking the queue gate before each one. Handed to
   * SolidFrameworkOverrides so the core can trigger a replay on releaseLockOnRefresh.
   */
  readonly processQueuedUpdates: () => void;
  /** Marks not-ready (component cleanup): queued funcs can no longer drain. */
  readonly reset: () => void;
};

export const createReadyQueue = (shouldQueueUpdates: () => boolean): ReadyQueue => {
  let ready = false;
  const whenReadyFuncs: (() => void)[] = [];

  const processWhenReady = (func: () => void): void => {
    if (ready && !shouldQueueUpdates()) {
      func();
    } else {
      whenReadyFuncs.push(func);
    }
  };

  const drainAndMarkReady = (): void => {
    // for-of picks up funcs pushed mid-drain (ready is still false, so processWhenReady
    // re-queues them into this same iteration) before the queue is cleared
    for (const f of whenReadyFuncs) {
      f();
    }
    whenReadyFuncs.length = 0;
    ready = true;
  };

  const processQueuedUpdates = (): void => {
    if (ready) {
      const getFn = () => (shouldQueueUpdates() ? undefined : whenReadyFuncs.shift());
      let fn = getFn();
      while (fn) {
        fn();
        fn = getFn();
      }
    }
  };

  const reset = (): void => {
    // only the ready flag flips: with it down, nothing can drain the queue, so clearing the
    // array would be unobservable — leaving it matches the pre-extraction semantics exactly
    ready = false;
  };

  return { processWhenReady, drainAndMarkReady, processQueuedUpdates, reset };
};

import { describe, expect, it } from "vitest";

import { createReadyQueue } from "../../src/core/readyQueue";

/**
 * The wrapper's async-commit accommodation queue in isolation (extracted from AgGridSolid):
 * grid-option changes queue until the grid core accepts changes (drainAndMarkReady, wired to
 * the acceptChangesCallback whenReady slot) and re-queue while the core's refresh lock is
 * down (shouldQueueUpdates).
 */
describe("createReadyQueue", () => {
  it("queues funcs before ready; drainAndMarkReady runs them in arrival order and marks ready", () => {
    const queue = createReadyQueue(() => false);
    const calls: number[] = [];

    queue.processWhenReady(() => calls.push(1));
    queue.processWhenReady(() => calls.push(2));
    expect(calls).toEqual([]);

    queue.drainAndMarkReady();
    expect(calls).toEqual([1, 2]);

    // once ready (and not gated), funcs run immediately instead of queueing
    queue.processWhenReady(() => calls.push(3));
    expect(calls).toEqual([1, 2, 3]);
  });

  it("funcs queued during the drain run within the same drain (grid is not yet ready)", () => {
    const queue = createReadyQueue(() => false);
    const calls: string[] = [];

    queue.processWhenReady(() => {
      calls.push("first");
      queue.processWhenReady(() => calls.push("nested"));
    });

    queue.drainAndMarkReady();
    expect(calls).toEqual(["first", "nested"]);
  });

  it("shouldQueueUpdates gates both direct execution and queue replay", () => {
    let gated = false;
    const queue = createReadyQueue(() => gated);
    const calls: number[] = [];

    queue.drainAndMarkReady();

    gated = true;
    queue.processWhenReady(() => calls.push(1));
    queue.processWhenReady(() => calls.push(2));
    expect(calls).toEqual([]);

    // replay is a no-op while the gate is down
    queue.processQueuedUpdates();
    expect(calls).toEqual([]);

    // gate released (the core's releaseLockOnRefresh path): FIFO replay
    gated = false;
    queue.processQueuedUpdates();
    expect(calls).toEqual([1, 2]);
  });

  it("processQueuedUpdates re-checks the gate before each queued func", () => {
    let gated = false;
    const queue = createReadyQueue(() => gated);
    const calls: number[] = [];

    queue.drainAndMarkReady();
    gated = true;
    queue.processWhenReady(() => {
      calls.push(1);
      // the first func re-engages the gate: the second must stay queued
      gated = true;
    });
    queue.processWhenReady(() => calls.push(2));

    gated = false;
    queue.processQueuedUpdates();
    expect(calls).toEqual([1]);

    gated = false;
    queue.processQueuedUpdates();
    expect(calls).toEqual([1, 2]);
  });

  it("processQueuedUpdates is a no-op before ready", () => {
    const queue = createReadyQueue(() => false);
    const calls: number[] = [];

    queue.processWhenReady(() => calls.push(1));
    queue.processQueuedUpdates();
    expect(calls).toEqual([]);
  });

  it("reset (component cleanup) drops readiness: nothing drains and new funcs queue again", () => {
    const queue = createReadyQueue(() => false);
    const calls: number[] = [];

    queue.drainAndMarkReady();
    queue.reset();

    queue.processWhenReady(() => calls.push(1));
    expect(calls).toEqual([]);

    queue.processQueuedUpdates();
    expect(calls).toEqual([]);
  });
});

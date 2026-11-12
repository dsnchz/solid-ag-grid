import { _areEqual } from "ag-stack";
import { flush } from "solid-js";

export const classesList = (...list: (string | null | undefined)[]): string => {
  const filtered = list.filter((s) => s != null && s !== "");

  return filtered.join(" ");
};

export class CssClasses {
  private classesMap: { [name: string]: boolean } = {};

  constructor(...initialClasses: string[]) {
    for (const className of initialClasses) {
      this.classesMap[className] = true;
    }
  }

  public setClass(className: string, on: boolean): CssClasses {
    // important to not make a copy if nothing has changed, so we
    // won't trigger a render cycle on new object instance
    const nothingHasChanged = !!this.classesMap[className] == on;
    if (nothingHasChanged) {
      return this;
    }

    const res = new CssClasses();
    res.classesMap = { ...this.classesMap };
    res.classesMap[className] = on;
    return res;
  }

  public toString(): string {
    const res = Object.keys(this.classesMap)
      .filter((key) => this.classesMap[key])
      .join(" ");
    return res;
  }
}

let suppressFlush = false;

/** Enable flush to be disabled for the callback and the next frame (via setTimeout 0) to prevent
 * flush during an existing render. Solid 2.0 analog of React's runWithoutFlushSync: grid code
 * (e.g. ensureVisible) can be invoked from inside an effect apply phase, where forcing the pending
 * batch to apply re-entrantly is the same hazard class as calling flushSync during a React render.
 */
export function runWithoutFlush<T>(func: () => T): T {
  if (!suppressFlush) {
    // We only re-enable flush asynchronously to avoid re-enabling it while Solid is still
    // applying updates related to the original call.
    setTimeout(() => (suppressFlush = false), 0);
  }
  suppressFlush = true;
  return func();
}

/**
 * Solid 2.0 batches signal writes to the microtask; when a ctrl requires the DOM to be updated
 * synchronously (scroll, keyboard nav) we run the writes then flush(). Controlled via the
 * `useFlush` param as we do not want to flush when we are likely to already be in a render cycle,
 * and via the suppress-flush latch (see runWithoutFlush).
 *
 * FLUSH VERDICT (ARCHITECTURE.md Open question 2, resolved T3.4): `flush()` is a safe
 * `flushSync` stand-in for the row/cell swap paths.
 * - Applying the whole pending batch (not just "our" writes) is consistent-by-construction and
 *   caused no misbehavior under scroll (500-row ensureIndexVisible browser test, zero console
 *   errors, virtualization intact).
 * - `flush()` IS legal mid-apply-phase in dev — no diagnostic fires (unit test
 *   "agFlush(true) called from inside an effect apply phase does not throw"). The
 *   runWithoutFlush latch is therefore a re-entrancy hygiene measure on the ensureVisible path
 *   (matching React's runWithoutFlushSync), not a hard requirement imposed by dev diagnostics;
 *   suppressed flushes are never lost — the microtask batch applies them (latch unit test).
 * - Signal writes inside effect apply phases are also legal (renderKey-bump pattern), so
 *   grid-core callbacks re-entered from apply phases can drive compProxy setters freely.
 * Evidence: test/unit/flushSemantics.test.tsx + test/browser/rowsCells.browser.test.tsx.
 */
export const agFlush = (useFlush: boolean, fn: () => void): void => {
  fn();
  if (useFlush && !suppressFlush) {
    flush();
  }
};

/**
 * The list to render for `next`, keeping values already rendered in their previous order, so the
 * keyed `<For>` moves no DOM node and CSS transitions survive. Returns `prev` when nothing
 * changed, and `next` when nothing is rendered yet or it already has that order, so an unchanged
 * reference skips the signal write; otherwise builds the kept values in `prev` order with the new
 * ones added.
 * Each list must hold distinct values.
 * @param maintainOrder Follow `next`'s order, as the DOM must for accessibility
 * @param placeNewInOrder Put each new value before the kept value that follows it in `next`, not
 * last
 */
export function getNextValueIfDifferent<T extends { diffIndex: number }>(
  prev: T[] | undefined,
  next: T[],
  maintainOrder: boolean,
  placeNewInOrder = false,
): T[] {
  if (prev === undefined) {
    return next;
  }
  const prevLen = prev.length;
  const nextLen = next.length;

  // If same array instance nothing to do.
  // If both empty arrays maintain reference of prev.
  if (prev === next || (nextLen === 0 && prevLen === 0)) {
    return prev;
  }

  // If maintaining dom order just return next
  // If either side is empty there is no previous order to maintain
  if (maintainOrder || prevLen === 0 || nextLen === 0) {
    return next;
  }

  if (_areEqual(prev, next)) {
    return prev;
  }

  // Values are matched by a `diffIndex` stamp instead of a map: each `prev` value is stamped with
  // its index, and a value is kept exactly when `prev[value.diffIndex] === value`, so a stamp left
  // by another list never matches. One pass over `next` counts the kept values and notes whether
  // they are in `prev` order and whether a new one precedes a kept one. Only a result that has to
  // be built restamps `next` and walks `prev`.
  for (let i = 0; i < prevLen; ++i) {
    prev[i]!.diffIndex = i;
  }

  let kept = 0;
  let lastPrevIndex = -1;
  let keptInOrder = true;
  let newBeforeKept = false;
  for (let i = 0; i < nextLen; ++i) {
    const value = next[i]!;
    const prevIndex = value.diffIndex;
    if (prevIndex >= prevLen || prev[prevIndex] !== value) {
      continue;
    }
    if (prevIndex < lastPrevIndex) {
      keptInOrder = false;
    }
    lastPrevIndex = prevIndex;
    if (kept !== i) {
      newBeforeKept = true;
    }
    ++kept;
  }

  // All the same values exist just in a different order so maintain the existing reference
  if (kept === prevLen && kept === nextLen) {
    return prev;
  }

  // kept values in their previous order: `next` is the result, unless new values must go last and
  // one doesn't
  if (kept === 0 || (keptInOrder && (placeNewInOrder || !newBeforeKept))) {
    return next;
  }

  // restamped by index in `next`, a kept value moved past `nextLen` to tell it from a new one
  for (let i = 0; i < nextLen; ++i) {
    next[i]!.diffIndex = i;
  }
  for (let i = 0; i < prevLen; ++i) {
    const value: T = prev[i]!;
    const nextIndex = value.diffIndex;
    if (nextIndex < nextLen && next[nextIndex] === value) {
      value.diffIndex = nextLen + nextIndex;
    }
  }

  const result: T[] = [];
  for (let i = 0; i < prevLen; ++i) {
    const value: T = prev[i]!;
    const nextIndex = value.diffIndex - nextLen;
    if (nextIndex < 0 || nextIndex >= nextLen || next[nextIndex] !== value) {
      continue;
    }
    if (placeNewInOrder) {
      // each kept value brings the new values between it and the kept value before it in `next`
      pushNewBefore(result, next, nextIndex);
    }
    result.push(value);
  }
  if (placeNewInOrder) {
    pushNewBefore(result, next, nextLen);
    return result;
  }
  for (let i = 0; i < nextLen; ++i) {
    const value = next[i]!;
    if (value.diffIndex === i) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Pushes the new values `next` has straight before `end`, a new value being one still stamped
 * with its own index.
 */
const pushNewBefore = <T extends { diffIndex: number }>(
  result: T[],
  next: T[],
  end: number,
): void => {
  let lastKept = end - 1;
  while (lastKept >= 0 && next[lastKept]!.diffIndex === lastKept) {
    --lastKept;
  }
  for (let i = lastKept + 1; i < end; ++i) {
    result.push(next[i]!);
  }
};

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
 */
export const agFlush = (useFlush: boolean, fn: () => void): void => {
  fn();
  if (useFlush && !suppressFlush) {
    flush();
  }
};

/**
 * The aim of this function is to maintain references to prev or next values where possible.
 * If there are not real changes then return the prev value to avoid unnecessary renders.
 * @param maintainOrder If we want to maintain the order of the elements in the dom in line with the next array
 * @returns
 */
export function getNextValueIfDifferent<T extends { instanceId: string }>(
  prev: T[] | null,
  next: T[] | null,
  maintainOrder: boolean,
): T[] | null {
  if (next == null || prev == null) {
    return next;
  }

  // If same array instance nothing to do.
  // If both empty arrays maintain reference of prev.
  if (prev === next || (next.length === 0 && prev.length === 0)) {
    return prev;
  }

  // If maintaining dom order just return next
  // If prev is empty just return next immediately as no previous order to maintain
  // If prev was not empty but next is empty return next immediately
  if (
    maintainOrder ||
    (prev.length === 0 && next.length > 0) ||
    (prev.length > 0 && next.length === 0)
  ) {
    return next;
  }

  // if dom order not important, we don't want to change the order
  // of the elements in the dom, as this would break transition styles
  const oldValues: T[] = [];
  const newValues: T[] = [];
  const prevMap: Map<string, T> = new Map();
  const nextMap: Map<string, T> = new Map();

  for (let i = 0; i < next.length; i++) {
    const c = next[i]!;
    nextMap.set(c.instanceId, c);
  }

  for (let i = 0; i < prev.length; i++) {
    const c = prev[i]!;
    prevMap.set(c.instanceId, c);
    if (nextMap.has(c.instanceId)) {
      oldValues.push(c);
    }
  }

  for (let i = 0; i < next.length; i++) {
    const c = next[i]!;
    const instanceId = c.instanceId;

    if (!prevMap.has(instanceId)) {
      newValues.push(c);
    }
  }

  // All the same values exist just maybe in a different order so maintain the existing reference
  if (oldValues.length === prev.length && newValues.length === 0) {
    return prev;
  }

  // All new values so avoid spreading the new array to maintain the reference
  if (oldValues.length === 0 && newValues.length === next.length) {
    return next;
  }
  // Spread as required to combine the old and new values
  if (oldValues.length === 0) {
    return newValues;
  }

  if (newValues.length === 0) {
    return oldValues;
  }

  return [...oldValues, ...newValues];
}

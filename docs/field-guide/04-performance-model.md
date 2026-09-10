# Chapter 4 — The performance model (what costs what, and how we know)

This chapter lands with the per-cell diet and the benchmark harness (36.0.0-next.6).
It answers three questions a maintainer will be asked: _where does the time go_,
_why does the port write to the DOM imperatively in places_, and _how do we know
a change made anything faster_. Every number here was measured on Solid
2.0.0-rc.7 with the production runtime, headless Chromium, on one machine;
ratios travel, milliseconds do not.

## Where the time goes

The grid core owns data, sorting, filtering and virtualization. Our Solid layer
renders the **viewport**: the ~20 rows and ~10 columns on screen. So the
reactive graph's size scales with the viewport, never with the row count — and
that is why 100k rows cost the same per swap as 1k.

Three phases matter, and only one is ours:

| phase                                | who pays | scales with                  |
| ------------------------------------ | -------- | ---------------------------- |
| boot (`createGrid`, beans)           | core     | constant (~1 ms)             |
| row model (setRowData, sort, filter) | core     | rows (2 ms @1k, 45 ms @100k) |
| **viewport mount / row swap**        | **us**   | cells on screen              |

The viewport mount runs at first paint and again on **every scroll frame** that
replaces rows. That is the path every performance change in this package
targets. After the diet it costs ~2.5 ms per viewport over vanilla; before it
cost ~3–5 ms and the ratio to vanilla was 1.3–1.5×.

## Why imperative writes are not "escaping Solid"

Reactivity is a **subscription mechanism**. It pays for itself when a value has
readers that derive from it — a memo, a `Show` condition, a JSX binding that
several things depend on. It costs an allocation per node, a link per
dependency, and a scheduled run per change.

Now look at a row's `top`. One writer (the ctrl, through `compProxy.setTop`),
zero readers in our graph (nothing derives from it; no branch depends on it).
Modeling it as a signal plus a binding effect is a pipe with one inlet and one
outlet — the pipe does exactly what `el.style.top = value` does, after paying for
a signal, an effect, a subscription and a queued run per row. The React wrapper
needs the pipe because React owns the DOM and must be told through state; Solid
hands us the element, so the setter can write it, exactly as vanilla's `RowComp`
does.

That is the **core-jurisdiction rule**, and it is the same rule the port has
applied to CSS classes since T3 (`toggleCss` → `CssClassManager`, never a
reactive `class` binding):

> A value with a single external writer and no reader in our graph is written at
> the write site. A value that anything derives from is a signal.

It is not a performance hack layered on top of the doctrine; it _is_ Chapter 2's
doctrine ("code must tell the truth about what is reactive") applied to
attributes. Reactivity for state that fans out; direct writes for pushes that
terminate in the DOM. The list today: row index / id / business key, top,
transform, user row/cell styles, and the four editing classes. Each is pinned
against vanilla in `test/browser/rowCellStyles.browser.test.tsx` and
`cellStateTransitions.browser.test.tsx`.

The corollary for `createEffect`: before adding one to a hot component, ask
which `Show` branch owns the state it reacts to, and whether that state has a
single writer we control. If a branch owns it, create the effect inside the
branch (it exists only while the branch does, and branch disposal is its
cleanup). If a single writer owns it, write there. The four effects the diet
removed from every cell were React `useLayoutEffect`s translated literally;
each had one of those two answers.

## The reactive graph budget

"What can be derived, should be derived" is enforced by a test, not by review.
`test/unit/reactiveGraphBudget.test.tsx` walks Solid's dev owner tree under
mounted grids and derives the **marginal** nodes one cell and one row add, by
differencing grid sizes (header cells scale with columns, so rows are
differenced at two column counts). The counts are deterministic, so the budget
is pinned exactly:

|                       | before the diet | now                                                  |
| --------------------- | --------------- | ---------------------------------------------------- |
| computations per cell | 41              | 23                                                   |
| signals per cell      | 11              | 11 (three `renderDetails` parts replaced one object) |
| computations per row  | 40              | 32                                                   |
| signals per row       | 11              | 5                                                    |

Raise a budget only with a design note. A change that adds an effect, memo or
`Show` branch to the cell or row mount fails here first — before it shows up as
scroll jank on a wide grid.

What is left per cell is load-bearing: four `Show` branches (wrapper,
value-visible, framework renderer, editor — the value-visible and editor
branches cannot merge, a single insert would remount the value when a popup
editor opens), two memos with equality cuts, and the JSX inserts. The remaining
~2.5 ms per viewport is the graph's floor plus allocation; the CDP profile puts
Solid runtime mount + dispose at ~1.6 ms, our component bodies at ~0.7 ms, GC
and V8 internals for the rest. Recycling components across swaps would remove
most of it and is rejected: it breaks the ctrl→comp `setComp` contract the whole
port rests on, and neither vanilla nor React recycles.

## How to measure (and the two traps)

Everything runs in the `perf` vitest project (`pnpm test:perf`; weekly in CI),
which resolves Solid's **production** build — the dev build carries attribution
and diagnostics instrumentation that folds out of prod, and vanilla pays no such
tax. `perfHarness.browser.test.tsx` fails if `DEV` is defined. Never set
`mode: "production"` or a `process.env.NODE_ENV` define on a vitest project: both
leak into the shared Node process and silently switch the jsdom unit project
onto the prod build (it happened; the harness pins both directions now).

The comparison harness (`perfCompare.browser.test.tsx`) reports two numbers per
op:

- **CPU**: `performance.now()` around the call plus an explicit reactive settle
  (`flush()` → one microtask → `flush()`). Solid's DOM work lands inside; nothing
  else does.
- **wall**: CPU plus two animation frames — what the user perceives, and the
  only number the harness had before. It sits on a ~17 ms floor that hides
  everything smaller, which is how the initial-render "gap" was misread for a
  week.

Two traps, each pinned by an assertion because each produced a flattering lie
the first time:

1. **Solid's auto-flush is a chain of microtasks.** One queued microtask lands
   between its stages and misses the DOM work. Settle with `flush()`.
2. **`ensureIndexVisible` only sets `scrollTop`.** The grid swaps rows in its
   scroll-event handler on the _next frame_, for both renderers. A naive window
   read Solid's swap at 0.31× vanilla — it was timing the `scrollTop` write. The
   harness dispatches the scroll event itself under `suppressAnimationFrame` and
   asserts the target row's cells exist inside the window.

Methodology borrowed from solid-flow's campaign: warm both renderers, alternate
order per iteration, discard the first measured iteration, report median _and_
p95/worst (a spike that hides in medians is what a scroll user feels), assert
`document.visibilityState === "visible"` (hidden tabs suspend rAF and look like
a regression).

Diagnostics for attribution, on demand: `perfSwapProfile` (CDP CPU sampling
over 20 swaps, self time by owner and dispose/mount side), `perfSwapAlloc`
(sampling heap profiler, bytes per function), `perfProfile` (viewport mount),
`perfTimeline` (render() → first cell, MutationObserver-timed). Read them before
touching a hot path; the diet was ordered by what they showed.

## Current standing vs vanilla (medians, n=7)

| op                                           | ratio                     |
| -------------------------------------------- | ------------------------- |
| initial render (tall 100k×10 / wide 20k×100) | 1.07 / 1.02               |
| 500-row transaction (sync / async burst)     | ~1.04 / 1.00              |
| force refresh                                | ≤ 1.0                     |
| row swap per viewport                        | 1.17 (tall) / 1.49 (wide) |

The row swap is the only real gap left, and it is fixed per viewport, not per
row.

## Guided reading (do this by hand, in order)

1. `src/rows/rowComp.tsx` — the block above `initialRowIndex` and the
   `compProxy` in `setRef`. Notice which pushes are direct writes and that the
   first render still carries index/top/transform as static attributes (no
   empty-row flash).
2. `src/cells/cellComp.tsx` — `applyEditClasses` and its three call sites;
   then the keyed editor `Show` and the wrapper `Show`. Notice that each branch
   creates its own effect and that branch disposal is its cleanup.
3. `test/unit/reactiveGraphBudget.test.tsx` — how the marginal counts are
   derived. Run it with `--silent=false --disableConsoleIntercept` to see them.
4. `test/browser/perfCompare.browser.test.tsx` — `settle()`, `scrollTo()` and
   the assertion in the row-swap loop. These three lines are the harness's
   honesty.

## Checkpoints

1. A PR replaces `setRowIndex: (v) => setAttr("row-index", v)` with a signal and
   `row-index={rowIndex()}` "so it's reactive". What does the graph budget say,
   and what question should the reviewer ask about `rowIndex`'s readers?
2. Why can `top` be written imperatively but `showCellWrapper` must stay a memo?
   Name the reader that makes the difference.
3. The harness reports Solid's row swap at 0.3× vanilla after someone
   "simplified" the swap loop. Which assertion should have failed, and what was
   probably removed?
4. A profile shows dispose at 1.1 ms and mount at 2.6 ms per swap. Someone
   proposes optimizing `onCleanup` ordering. Is that the right target? What
   would you optimize instead, and what does the budget test do for you while
   you try?
5. Why is `renderDetails` three signals when the core pushes them together?
   Which reader benefits, and which op in the harness would you expect to move
   (and by how little, and why)?

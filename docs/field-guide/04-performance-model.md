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
transform, user row/cell styles, pinned lane widths (36.3 port), and the four
editing classes. Each is pinned against vanilla in
`test/browser/rowCellStyles.browser.test.tsx`,
`cellStateTransitions.browser.test.tsx` and (lane widths, including a resize)
`rowsCells.browser.test.tsx`.

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

|                       | before the diet | now                                                 |
| --------------------- | --------------- | --------------------------------------------------- |
| computations per cell | 41              | 9 (2026-11-12 Show diet + renderer hole, see below) |
| signals per cell      | 11              | 12 (the renderer slot is its own signal, see below) |
| computations per row  | 40              | 10 (2026-11-12 row lanes, see below)                |
| signals per row       | 11              | 6 (one boolean per pinned lane, see below)          |

Raise a budget only with a design note. A change that adds an effect, memo or
`Show` branch to the cell or row mount fails here first — before it shows up as
scroll jank on a wide grid.

What is left per cell: two memos with equality cuts (wrapper decision,
renderer identity) and the JSX holes. No `<Show>` remains on a plain cell's
mount path; the one left in the cell (the `ag-cell-value` span) exists only on
wrapper cells. The 2026-11-12 Show diet removed four `<Show>`s, each a stack of
two or three memos over a condition that was already cheap:

- **value visibility** (React's `showCellValue`) is one more read in the
  framework-renderer memo and in `rawValue`: with no details both already
  render nothing, so only "not inline-editing" had to be folded in;
- the **editor branch**, the **wrapper/no-wrapper** decision and the
  **framework renderer** are one hole each: `() => cond() ? untrack(branch) : …`.
  The hole's computation re-runs only when its input changes (the editor on
  `editDetails` identity — keyed semantics; the wrapper on the boolean memo;
  the renderer on `frameworkRendererInfo`, which cuts on class + `renderKey`
  exactly where the keyed `Show` remounted), builds the branch untracked, and
  owns everything the branch creates, disposing it on the next run, which is
  what the `Show` gave us. The renderer hole also returns the raw value or the
  JS renderer's element when there is no framework renderer, replacing the
  `Show`'s fallback. A `Show` is still the tool when the condition reads async
  data (its guards handle held transitions); these conditions are plain signals
  the ctrl writes, and the renderer's async reads stay inside its `<Loading>`.

Measured (prod posture, interleaved A/B, medians of 3): row swap 6.2 → 5.5 ms
tall (vanilla 4.1; ×1.51 → ×1.31) and 6.1 → 5.4 ms wide (vanilla 4.0), about a
third of the overhead over vanilla; allocation 92 → 73 KB per swap; streaming
ticks 0.93 → 0.80 ms. The rest of the gap is the graph's floor plus
allocation. Recycling components across swaps would remove most of it and is
rejected: it breaks the ctrl→comp `setComp` contract the whole port rests on,
and neither vanilla nor React recycles.

The renderer hole (cell 12 → 9 computations) was measured on its own, against
the Show-diet build (prod posture, interleaved A/B, medians of 3): row swap 6.1
→ 5.6 ms tall and 5.9 → 5.6 ms wide (vanilla 4.5 / 4.3; the runs do not
overlap), allocation 71.9 → 67.2 KB per swap; initial render and streaming
ticks unchanged within noise. Value ticks re-run the same scopes as before (4
for a Solid-renderer cell, 2 for a plain one): the hole is the `Show`'s
fallback memo under another name, so the saving is all at mount. A remount
trades re-runs for creations, which a re-run budget cannot see, so the
diagnostics test also pins the renderer's element identity across a value
tick.

**Signals per cell, 11 → 12 (2026-11-12).** `hasDetails` was a plain function,
`compDetails() !== undefined`. The ctrl replaces the `compDetails` object on
every value refresh, so the wrapper memo and the `ag-cell-value` `Show` re-ran
on every tick to produce the same boolean. CI's diagnostics test caught it as
`WASTED_RECOMPUTE` on `showCellWrapper`. Solid's guide puts the equality
boundary at the source, not on the reader: the flag is now a boolean signal,
written beside `compDetails` at its three write sites, and notifies only when
it flips (first push, inline-edit start). In the diagnostics scenario,
`showCellWrapper` re-runs drop from 104 to 0. The A/B is neutral (prod
posture, interleaved, medians of 3): row swap 5.7 / 5.7 ms tall, 5.7 / 5.6
wide; streaming and sync transactions within the harness's 0.1 ms noise.

The same CI test later flagged `frameworkRendererInfo` (it read `compDetails`
for the renderer class). The flag became `rendererSlot` instead, at no extra
signal: `undefined` (no details), `null` (no framework renderer) or the
framework component class. "Has details" is `slot !== undefined`, and the
renderer memo reads the slot. A class's identity changes only with the
renderer, so value ticks reach neither reader: a Solid-renderer cell's tick
re-runs 3 scopes (props merge, refresh bridge, text), pinned with both memos at 0. Writes use the updater form, since a component class is a function.

**Rows, 27 → 10 computations and 5 → 6 signals (2026-11-12).** Sixteen of the
27 were four `<Show>`s at four nodes each (the `Show`, its `condition`,
`condition value` and `value` memos). Two had constant conditions: lanes vs
the full-width anchor never changes for a ctrl's life (a change rebuilds the
RowCtrl), so each branch is now built once in the body and inserted as a value.
The pinned-lane `Show`s read one `pinnedWidths` object; each lane is now one
hole over its own boolean signal (the +1 signal), so pinning a column on one
side never re-runs the other side's lane. Two Solid details decide the cost:

- a hole passed as a **function value** (`{leftLane}` where `leftLane` is
  `() => …`) is the insert's own render effect, one node; written as a JSX
  ternary the compiler adds a condition memo and an expression memo on top;
- function children inside **one fragment array are re-run together**: with
  the two pinned holes in a fragment, a right-lane flip rebuilt the left lane's
  cells. Each hole is its own child of the row element. The rowsCells test
  "pinning and unpinning a column on the right" pins the left cell's identity
  (vanilla keeps it too).

Measured (prod posture, interleaved A/B vs the previous build, medians of 3):
row swap 5.8 → 5.5 ms tall (runs 5.7–5.8 vs 5.5–5.6) and 5.6 → 5.5 ms wide
(vanilla 4.6 / 4.4); allocation 67.2 → 62.8 KB per swap (runs do not
overlap); initial render 46.9 → 44.1 ms tall and 16.4 → 15.1 ms wide, now at
vanilla's 45.6 / 15.2; scroll and streaming unchanged.

**Rejected: three direct cell holes (2026-11-12).** The same move on the cell
(value, editor and wrapper as three direct children of the cell element, each
switched off by the wrapper decision, instead of the wrapper hole over a
fragment whose two holes each need a compiler memo) cut the cell to 8
computations and allocation 61.8 → 60.0 KB per swap, yet row swap got slower:
5.3 → 5.5 ms tall and 5.2 → 5.5 ms wide (interleaved, medians of 3; runs
mostly do not overlap). Several dynamic children of one element need DOM
markers and positioned inserts where one child is a plain append. The node
count is a proxy; the A/B decides.

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

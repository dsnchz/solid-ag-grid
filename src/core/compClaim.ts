// ONE LIVE COMP PER CTRL — React's commit order, translated. React commits deletions before
// insertions, so when a ctrl moves to another container (a column pinned or unpinned moves its
// header ctrl between header containers) the old comp's teardown — destroying its compBean,
// whose destroy funcs clearComponent() the ctrl — always runs before the new comp's setComp.
// Solid mounts and disposes per <For>, in whichever order the containers update: on unpin the
// new header comp called setComp first, then the old comp's cleanup cleared the NEW comp off
// the ctrl. The next column change threw inside the grid's event dispatch
// (HeaderCellCtrl.refreshSpanHeaderHeight → comp.toggleCss on null), and unmount threw in
// stopMeasuring. Claiming restores React's order whichever side runs first: a comp claims its
// ctrl right before setComp, which first runs the previous holder's teardown; a comp's own
// cleanup tears down only while it still holds the claim.
// Evidence: test/browser/rowsCells.browser.test.tsx ("pinning and unpinning a column").
const holders = new WeakMap<object, () => void>();

/**
 * Claims `ctrl` for the calling comp: runs the previous holder's teardown (if any) now, then
 * registers `teardown` as the current one. Call right before `ctrl.setComp`. Returns the
 * release to call from the comp's cleanup — it runs `teardown` only while this comp still holds
 * the claim.
 */
export const claimCtrl = (ctrl: object, teardown: () => void): (() => void) => {
  const previous = holders.get(ctrl);
  if (previous) {
    holders.delete(ctrl);
    previous();
  }
  holders.set(ctrl, teardown);
  return () => {
    if (holders.get(ctrl) === teardown) {
      holders.delete(ctrl);
      teardown();
    }
  };
};

---
"@dschz/solid-ag-grid": patch
---

`rowStore`: the adapter's structural effect now subscribes to the array's `$TRACK` node alone instead of tracking every index, so a 100k-row store no longer materializes 100k index nodes per structural pass (dev-build medians: adapter boot 338 → 282 ms, structural pass 106 → 82 ms, dispose 29 → 17 ms). The store rule it rests on — arrays bump `$TRACK` on any index or length change and never on a field write, read through optimistic views — is pinned per operation in the delta tests.

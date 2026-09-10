---
"@dschz/solid-ag-grid": patch
---

Column-resize operations queued after data events (the `autoSizeColumns`-from-an-event-handler DX) now drain through one timer per macrotask instead of one per updated row: a 500-row update transaction scheduled 501 timers and 500 macrotask turns per tick. Streaming ticks reaching custom cell renderers dropped from x1.50 to x1.29 (lean) and x1.59 to x1.41 (rich) of vanilla.

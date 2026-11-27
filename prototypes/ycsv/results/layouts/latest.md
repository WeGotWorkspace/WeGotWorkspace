# Spike 4 scale run — 2026-11-27T00:59:14.289Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `1:59  up 16 days, 11:45, 1 user, load averages: 3.25 7.89 9.63`
- Load at end: `1:59  up 16 days, 11:46, 1 user, load averages: 3.24 7.57 9.48`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|

## Yjs layouts

| rows×cols | notation | layout | build | Yjs v1 | Yjs v2 | applyUpdate | heap (doc) | bytes/edit | after edits |
|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | absolute | L1-current | 31.0 | 4586 KB | 3274 KB | 62.0 | 23.6 MB | 35 | 4601 KB (+1000) |
| 10000×10 | absolute | L2-flat-row-map | 27.5 | 4401 KB | 3128 KB | 56.7 | 21.0 MB | 34 | 4415 KB (+1000) |
| 10000×10 | absolute | L3-one-cell-map | 28.7 | 4525 KB | 4290 KB | 67.7 | 15.8 MB | 35 | 4539 KB (+1000) |
| 10000×10 | absolute | L4-flat-row-map-short-ids | 21.5 | 3268 KB | 2230 KB | 46.1 | 19.0 MB | 34 | 3282 KB (+1000) |
| 10000×10 | absolute | L5-columnar | 1.8 | 1829 KB | 1829 KB | 13.5 | -0.6 MB | 43 | 1871 KB (+1000) |
| 10000×30 | absolute | L1-current | 49.3 | 13327 KB | 9681 KB | 158.8 | 54.3 MB | 35 | 13341 KB (+1000) |
| 10000×30 | absolute | L2-flat-row-map | 54.9 | 13141 KB | 9534 KB | 155.1 | 51.7 MB | 35 | 13156 KB (+1000) |
| 10000×30 | absolute | L3-one-cell-map | 105.7 | 15413 KB | 14593 KB | 237.1 | 51.3 MB | 35 | 15428 KB (+1000) |
| 10000×30 | absolute | L4-flat-row-map-short-ids | 56.0 | 10153 KB | 7064 KB | 143.0 | 49.8 MB | 33 | 10167 KB (+1000) |
| 10000×30 | absolute | L5-columnar | 4.2 | 5883 KB | 5882 KB | 39.6 | -2.6 MB | 43 | 5925 KB (+1000) |
| 50000×10 | absolute | L1-current | 155.3 | 22997 KB | 16372 KB | 296.8 | 117.2 MB | 35 | 23012 KB (+1000) |
| 50000×10 | absolute | L2-flat-row-map | 130.8 | 22069 KB | 15640 KB | 274.9 | 104.1 MB | 35 | 22084 KB (+1000) |
| 50000×10 | absolute | L3-one-cell-map | 198.3 | 22623 KB | 21451 KB | 367.7 | 70.4 MB | 35 | 22637 KB (+1000) |
| 50000×10 | absolute | L4-flat-row-map-short-ids | 121.7 | 16405 KB | 11148 KB | 235.2 | 94.3 MB | 35 | 16420 KB (+1000) |
| 50000×10 | absolute | L5-columnar | 6.3 | 9146 KB | 9146 KB | 66.6 | -3.6 MB | 43 | 9188 KB (+1000) |
| 10000×10 | current | L1-current | 21.2 | 3952 KB | 2640 KB | 56.7 | 23.1 MB | 35 | 3966 KB (+1000) |
| 10000×10 | current | L2-flat-row-map | 18.6 | 3766 KB | 2493 KB | 51.4 | 20.5 MB | 34 | 3781 KB (+1000) |
| 10000×10 | current | L3-one-cell-map | 23.9 | 3890 KB | 3655 KB | 57.5 | 14.4 MB | 35 | 3904 KB (+1000) |
| 10000×10 | current | L4-flat-row-map-short-ids | 19.3 | 2633 KB | 1595 KB | 43.9 | 18.5 MB | 34 | 2648 KB (+1000) |
| 10000×10 | current | L5-columnar | 1.7 | 1195 KB | 1195 KB | 10.1 | -1.1 MB | 43 | 1237 KB (+1000) |
| 10000×30 | current | L1-current | 50.9 | 10153 KB | 6507 KB | 135.6 | 53.6 MB | 35 | 10168 KB (+1000) |
| 10000×30 | current | L2-flat-row-map | 50.8 | 9967 KB | 6360 KB | 132.8 | 51.0 MB | 35 | 9982 KB (+1000) |
| 10000×30 | current | L3-one-cell-map | 97.8 | 12239 KB | 11419 KB | 220.1 | 50.6 MB | 35 | 12254 KB (+1000) |
| 10000×30 | current | L4-flat-row-map-short-ids | 52.7 | 7272 KB | 3890 KB | 120.5 | 52.3 MB | 35 | 7287 KB (+1000) |
| 10000×30 | current | L5-columnar | 6.4 | 2709 KB | 2709 KB | 27.3 | -3.2 MB | 43 | 2751 KB (+1000) |

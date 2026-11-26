# Spike 4 scale run — 2026-11-26T22:54:16.477Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `23:54  up 16 days,  9:40, 1 user, load averages: 16.61 17.13 15.78`
- Load at end: `23:59  up 16 days,  9:45, 1 user, load averages: 29.71 25.63 20.04`
- Runs per configuration: 1 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000×10 | baseline | 3.6 | 11.5 | 449 KB | 328 KB | 7.3 | — (in render) | 4.8 / 6.0 | 92.4 | 21.0 MB | 11139 | 3.2 / 3.9 |
| 1000×10 | win-full | 3.6 | 11.2 | 436 KB | 328 KB | 7.0 | 16.8 (1.7/0.0/15.1) | 5.3 / 6.2 | 33.9 | 14.5 MB | 423 | 2.5 / 3.8 |
| 1000×10 | win-incr | 3.8 | 12.2 | 449 KB | 328 KB | 8.5 | 21.4 (2.6/8.2/10.5) | 5.4 / 7.5 | 41.2 | 16.1 MB | 423 | 2.7 / 3.7 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000×10 | baseline | 19.5 / 25.4 | — | 24.8 / 27.3 | — | 28.7 / 32.5 | 28.1 / 32.7 | 25.2 / 27.3 | 60.0 | 0 | 0 (0) | 0.25 / 0.00 |
| 1000×10 | win-full | 16.7 / 18.3 | 10000 | 16.6 / 18.4 | 10000 | 16.4 / 18.2 | 16.8 / 17.4 | 16.6 / 17.5 | 60.0 | 0 | 0 (0) | 0.20 / 0.00 |
| 1000×10 | win-incr | 16.6 / 18.4 | 6 | 16.7 / 18.5 | 1002 | 16.6 / 18.2 | 16.6 / 18.3 | 17.0 / 18.4 | 60.0 | 0 | 0 (0) | 0.25 / 0.00 |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 1000×10 | baseline | 0.10 / 0.20 | 0.10 / 0.20 | 0.10 / 0.20 | 0.10 / 0.30 | 1.20 / 2.00 |
| 1000×10 | win-full | 6.25 / 6.90 | 6.15 / 6.50 | 6.00 / 6.20 | 6.20 / 6.50 | 7.40 / 8.10 |
| 1000×10 | win-incr | 0.60 / 0.80 | 1.60 / 2.10 | 0.85 / 1.10 | 0.80 / 1.20 | 3.10 / 4.40 |

## Worker (incremental engine in a Web Worker)

| rows×cols | init wall | worker build | main receive | formula values | edit wall | edit main | edit worker | worst wall | worst main | worst worker | worst changed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | 525.2 | 488.1 | 5.8 | 30002 | 8.9 / 11.1 | 0.2 / 0.5 | 8.5 / 10.5 | 43.3 / 61.9 | 1.1 / 1.2 | 41.9 / 60.2 | 10002 |
| 50000×10 | 4829.6 | 4341.6 | 260.2 | 150002 | 76.2 / 137.3 | 2.1 / 60.5 | 74.2 / 95.5 | 540.2 / 725.4 | 28.6 / 61.9 | 508.1 / 658.1 | 50002 |
| 50000×30 | 23211.4 | 21556.6 | 526.8 | 650002 | 85.5 / 206.5 | 1.8 / 13.8 | 82.3 / 113.2 | 866.7 / 2115.2 | 51.3 / 175.1 | 798.6 / 1930.4 | 50002 |

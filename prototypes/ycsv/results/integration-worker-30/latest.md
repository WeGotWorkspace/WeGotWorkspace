# Spike 4 scale run — 2026-11-27T13:24:33.530Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:24  up 17 days, 11 mins, 1 user, load averages: 3.61 5.02 6.73`
- Load at end: `14:25  up 17 days, 11 mins, 1 user, load averages: 3.06 4.74 6.57`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | int-worker | 32.4 | 317.4 | 10420 KB | 7202 KB | 152.1 | 866.8 (—/—/—) | 567.0 / 608.4 | 1037.9 | 88.2 MB | 510 | 514.1 / 525.3 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | int-worker | 16.7 / 18.4 | — | 20.8 / 33.6 | — | 16.7 / 21.1 | 16.7 / 18.0 | 16.6 / 18.2 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×30 | int-worker | 0.00 / 0.20 | 0.00 / 0.20 | 0.80 / 2.30 | 0.80 / 1.30 | 1.20 / 3.00 |

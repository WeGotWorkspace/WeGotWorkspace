# Spike 4 scale run — 2026-11-27T13:23:42.332Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:23  up 17 days, 10 mins, 1 user, load averages: 2.34 5.17 6.89`
- Load at end: `14:24  up 17 days, 11 mins, 1 user, load averages: 3.61 5.02 6.73`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | int-worker | 13.8 | 66.2 | 3242 KB | 2366 KB | 50.8 | 248.4 (—/—/—) | 132.1 / 145.1 | 315.3 | 35.1 MB | 458 | 46.7 / 52.4 |
| 50000×10 | int-worker | 61.5 | 289.8 | 16262 KB | 11831 KB | 280.2 | 1298.5 (—/—/—) | 823.9 / 876.0 | 1602.6 | 134.4 MB | 458 | 241.9 / 251.5 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | int-worker | 16.6 / 18.2 | — | 16.7 / 18.7 | — | 16.6 / 18.1 | 16.7 / 17.8 | 16.7 / 18.2 | 60.0 | 0 | 0 (0) | — / — |
| 50000×10 | int-worker | 16.6 / 18.3 | — | 112.1 / 143.8 | — | 33.3 / 34.8 | 33.3 / 34.2 | 16.7 / 18.2 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×10 | int-worker | 0.00 / 0.20 | 0.10 / 0.20 | 0.60 / 1.60 | 0.70 / 1.10 | 1.00 / 2.70 |
| 50000×10 | int-worker | 0.10 / 0.10 | 0.10 / 0.20 | 4.05 / 6.60 | 4.20 / 4.80 | 1.20 / 6.80 |

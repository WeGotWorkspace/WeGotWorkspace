# Spike 4 scale run — 2026-11-27T13:25:43.811Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:25  up 17 days, 12 mins, 1 user, load averages: 2.74 4.47 6.39`
- Load at end: `14:26  up 17 days, 12 mins, 1 user, load averages: 2.53 4.16 6.17`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | int-main | 13.7 | 57.8 | 3242 KB | 2366 KB | 49.5 | 145.5 (—/—/—) | 130.2 / 141.5 | 212.9 | 58.0 MB | 458 | 25.3 / 27.7 |
| 50000×10 | int-main | 61.5 | 255.6 | 16262 KB | 11831 KB | 270.3 | 837.6 (—/—/—) | 796.2 / 841.7 | 1138.1 | 252.0 MB | 458 | 139.4 / 143.9 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | int-main | 16.6 / 18.0 | — | 16.7 / 33.4 | — | 16.6 / 17.6 | 16.7 / 18.6 | 16.7 / 17.7 | 60.0 | 0 | 0 (0) | — / — |
| 50000×10 | int-main | 16.6 / 18.3 | — | 83.9 / 94.6 | — | 35.8 / 44.2 | 30.9 / 40.4 | 16.4 / 18.6 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×10 | int-main | 0.10 / 0.20 | 9.60 / 16.00 | 3.10 / 5.70 | 3.10 / 5.10 | 3.20 / 5.80 |
| 50000×10 | int-main | 0.20 / 0.50 | 82.90 / 93.60 | 19.15 / 26.90 | 19.35 / 22.20 | 4.00 / 13.00 |

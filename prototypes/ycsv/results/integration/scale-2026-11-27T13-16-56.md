# Spike 4 scale run — 2026-11-27T13:16:59.659Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:16  up 17 days, 3 mins, 1 user, load averages: 5.83 6.12 7.77`
- Load at end: `14:21  up 17 days, 8 mins, 1 user, load averages: 5.50 6.84 7.68`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | win-incr | 12.6 | 359.5 | 4588 KB | 3275 KB | 62.6 | 137.3 (17.9/71.1/48.2) | 112.6 / 142.6 | 210.5 | 65.7 MB | 430 | 25.5 / 29.3 |
| 10000×10 | int-main | 13.7 | 66.1 | 3242 KB | 2366 KB | 50.1 | 148.2 (—/—/—) | 138.4 / 150.4 | 216.6 | 58.6 MB | 458 | 49.0 / 53.6 |
| 10000×10 | int-worker | 14.0 | 67.0 | 3242 KB | 2366 KB | 51.0 | 259.9 (—/—/—) | 149.2 / 190.6 | 328.1 | 35.1 MB | 458 | 50.9 / 61.3 |
| 50000×10 | win-incr | 60.4 | 17537.0 | 22998 KB | 16373 KB | 375.3 | 881.0 (125.1/421.9/333.8) | 838.0 / 1454.9 | 1274.7 | 288.7 MB | 430 | 139.1 / 167.4 |
| 50000×10 | int-main | 61.8 | 294.7 | 16262 KB | 11831 KB | 280.3 | 886.5 (—/—/—) | 804.5 / 928.8 | 1197.6 | 252.0 MB | 458 | 253.3 / 324.1 |
| 50000×10 | int-worker | 62.9 | 289.6 | 16262 KB | 11831 KB | 279.5 | 1373.3 (—/—/—) | 834.1 / 894.4 | 1681.3 | 134.4 MB | 458 | 244.0 / 249.1 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×10 | win-incr | 16.7 / 18.1 | 6 | 16.6 / 18.4 | 10002 | 16.6 / 18.0 | 16.7 / 18.2 | 16.7 / 22.6 | 60.0 | 0 | 0 (0) | 1.10 / 0.00 |
| 10000×10 | int-main | 16.6 / 18.0 | — | 16.7 / 18.6 | — | 16.6 / 18.5 | 16.6 / 18.2 | 16.7 / 18.5 | 60.0 | 0 | 0 (0) | — / — |
| 10000×10 | int-worker | 50.0 / 51.9 | — | 50.0 / 66.6 | — | 49.9 / 51.0 | 50.1 / 51.8 | 50.0 / 51.7 | 60.0 | 0 | 0 (0) | — / — |
| 50000×10 | win-incr | 16.6 / 18.4 | 6 | 77.8 / 92.0 | 50002 | 25.6 / 44.7 | 25.8 / 41.6 | 63.7 / 281.2 | 60.0 | 0 | 0 (0) | 13.15 / 0.00 |
| 50000×10 | int-main | 16.6 / 18.5 | — | 92.8 / 108.0 | — | 34.5 / 42.3 | 33.5 / 49.2 | 16.5 / 18.5 | 60.0 | 0 | 0 (0) | — / — |
| 50000×10 | int-worker | 50.0 / 51.6 | — | 134.3 / 167.5 | — | 66.6 / 67.8 | 66.7 / 68.5 | 50.0 / 51.7 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×10 | win-incr | 0.10 / 0.90 | 8.05 / 12.70 | 3.40 / 6.50 | 3.30 / 5.70 | 8.80 / 22.10 |
| 10000×10 | int-main | 0.10 / 0.20 | 10.10 / 15.80 | 3.10 / 5.60 | 3.15 / 4.90 | 3.30 / 5.40 |
| 10000×10 | int-worker | 0.10 / 0.30 | 0.10 / 0.20 | 0.85 / 1.80 | 0.90 / 1.30 | 1.20 / 3.50 |
| 50000×10 | win-incr | 0.60 / 1.30 | 77.00 / 91.20 | 23.25 / 30.80 | 23.45 / 27.80 | 63.10 / 280.50 |
| 50000×10 | int-main | 0.30 / 0.40 | 91.75 / 107.10 | 19.90 / 25.90 | 19.80 / 25.50 | 3.90 / 10.60 |
| 50000×10 | int-worker | 0.10 / 0.30 | 0.10 / 0.20 | 4.20 / 6.70 | 4.40 / 5.10 | 1.30 / 8.10 |

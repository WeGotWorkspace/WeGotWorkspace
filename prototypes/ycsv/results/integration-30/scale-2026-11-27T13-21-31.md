# Spike 4 scale run — 2026-11-27T13:21:31.705Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:21  up 17 days, 8 mins, 1 user, load averages: 5.50 6.84 7.68`
- Load at end: `14:23  up 17 days, 9 mins, 1 user, load averages: 2.92 5.61 7.11`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | win-incr | 30.8 | 556.6 | 13330 KB | 9683 KB | 187.8 | 519.6 (47.9/304.6/163.9) | 472.0 / 506.8 | 716.7 | 188.3 MB | 490 | 80.7 / 87.3 |
| 10000×30 | int-main | 31.2 | 315.1 | 10420 KB | 7202 KB | 150.1 | 614.6 (—/—/—) | 543.3 / 577.4 | 789.3 | 185.2 MB | 510 | 516.6 / 528.9 |
| 10000×30 | int-worker | 32.6 | 318.8 | 10420 KB | 7202 KB | 150.9 | 862.2 (—/—/—) | 566.9 / 607.6 | 1036.8 | 88.2 MB | 510 | 519.5 / 531.6 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | win-incr | 16.6 / 17.6 | 16 | 16.7 / 22.0 | 10002 | 16.6 / 17.5 | 16.7 / 18.3 | 17.0 / 22.6 | 60.0 | 0 | 0 (0) | 1.90 / 0.00 |
| 10000×30 | int-main | 16.6 / 18.1 | — | 17.8 / 33.4 | — | 16.6 / 16.9 | 16.7 / 18.3 | 16.7 / 18.7 | 60.0 | 0 | 0 (0) | — / — |
| 10000×30 | int-worker | 50.0 / 51.5 | — | 50.1 / 66.6 | — | 50.0 / 51.3 | 50.0 / 50.3 | 50.0 / 51.8 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×30 | win-incr | 0.10 / 0.50 | 12.00 / 21.20 | 5.20 / 9.90 | 5.00 / 9.10 | 12.30 / 22.20 |
| 10000×30 | int-main | 0.10 / 0.30 | 16.50 / 26.90 | 5.35 / 9.00 | 5.45 / 7.80 | 7.10 / 9.80 |
| 10000×30 | int-worker | 0.00 / 0.20 | 0.10 / 0.20 | 0.90 / 2.30 | 0.95 / 1.30 | 1.20 / 3.20 |

# Spike 4 scale run — 2026-11-27T13:26:30.074Z

- Machine: Apple M5 Pro, 15 cores, 24 GB, darwin 25.6.0, Now drawing from 'AC Power'
- Browser: Chromium 158.0.8127.18 headless (Playwright), production Storybook build, StrictMode off
- Load at start: `14:26  up 17 days, 13 mins, 1 user, load averages: 2.53 4.16 6.17`
- Load at end: `14:26  up 17 days, 13 mins, 1 user, load averages: 2.42 4.00 6.05`
- Runs per configuration: 3 (fresh page each). Load metrics: median over runs. Interaction metrics: samples pooled over runs, median / p95.

## Load and model

| rows×cols | variant | parse | fileToDoc | Yjs v1 | Yjs v2 | applyUpdate | engine build (read/graph/eval) | evaluateAll | open→paint | heap | DOM nodes | serialize |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | int-main | 32.7 | 287.5 | 10420 KB | 7202 KB | 153.9 | 609.2 (—/—/—) | 542.8 / 558.9 | 788.9 | 185.1 MB | 510 | 93.4 / 97.3 |

All times ms. `open→paint` = applyUpdate + engine build + mount + first frame.

## Interaction (median / p95, ms)

| rows×cols | variant | edit typical | cells eval'd | edit worst (rate cell) | cells eval'd | insert row | delete row | paste 1,000 | scroll fps | frames >50 ms | long tasks (ms) | setCell / setCellAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10000×30 | int-main | 16.6 / 18.2 | — | 17.8 / 36.8 | — | 16.7 / 18.5 | 16.6 / 18.4 | 16.5 / 18.4 | 60.0 | 0 | 0 (0) | — / — |

Sync part of the same interactions (mutation + Yjs observers + engine; baseline evaluates during render, so its sync part is small and the cost shows in the paint numbers):

| rows×cols | variant | edit typical | edit worst | insert row | delete row | paste 1,000 |
|---|---|---|---|---|---|---|
| 10000×30 | int-main | 0.15 / 0.40 | 16.80 / 27.60 | 5.30 / 9.00 | 5.20 / 8.10 | 7.70 / 10.70 |

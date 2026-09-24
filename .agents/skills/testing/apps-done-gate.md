# Apps done gate

Use this checklist before calling substantial `packages/apps` UI work **done** or merging feature slices that touch panes, hooks, or stories.

## Package reuse guides

Per-domain maps (exports, Storybook paths, shell pattern, API hooks): [packages/apps/docs/README.md](../../../packages/apps/docs/README.md) and package READMEs under `packages/apps/src/*-core/`.

## One command

From the repo root:

```bash
pnpm test:apps-done-gate
```

**Husky pre-push** runs the **local** profile automatically when `packages/apps/**` changed in the commits being pushed (vs the remote tip): typecheck, OpenAPI contract, Storybook smoke, story coverage. Vitest unit and jsdom are not in that profile.

**CI** `apps-quality` runs `pnpm run ci:quality:apps` on **PR HEAD** only, with `APPS_DONE_GATE_FULL=1`. That includes `pnpm run check:agent-docs` (agent-doc links + English-only prose) and the full UI gate (local steps plus Vitest unit and jsdom). Jsdom shards run in a pool sized for a GitHub-hosted runner (4 vCPU, 16 GB): up to 3 packed shards at once, then up to 2 solo heap-heavy processes. Outside CI the pool stays at 1 unless `JSDOM_CONCURRENCY` / `JSDOM_SOLO_CONCURRENCY` is set. Intermediate commits in the PR are not gated ([#250](https://github.com/WeGotWorkspace/wegotworkspace/issues/250)).

Force the full profile locally (jsdom stays serial unless you also set `CI=true` or the concurrency vars):

```bash
APPS_DONE_GATE_FULL=1 pnpm test:apps-done-gate
```

Or inside `packages/apps`:

```bash
pnpm run test:done-gate
```

Local profile runs, in order:

1. **`typecheck`** — `tsc -p tsconfig.typecheck.json`
2. **`test:contract`** — UI ↔ OpenAPI adapter + type parity (`src/lib/api/contract/`)
3. **Storybook Vitest smoke** — stories tagged `vitest-ci` (browser + `play` + a11y `error`)
4. **Storybook coverage** — `check:storybook-coverage` (no new export gaps)

Full profile (`APPS_DONE_GATE_FULL=1`, set by CI) inserts these after the contract step, before Storybook smoke:

- **Vitest unit** — pure logic (`*.test.ts`, Node)
- **Vitest jsdom** — hooks and RTL (`*.test.tsx`). `scripts/run-jsdom.mjs` rotates files per package (`JSDOM_SHARDS`, default 24) and gives each heap-heavy RTL file its own process (`use-calendar-controller*`, `use-contacts-*`, `contacts-detail-view`, `workspace-live-app-shell`). In CI, packed shards run with concurrency from `scripts/jsdom-concurrency.mjs` (3 on a 4-core / 16 GB runner); solo files then run at a lower cap (2 on that runner). Every shard runs; the runner prints ✓/✗ then exits non-zero if any failed.

Full CI-quality stack (typegen, lint, format, API done gate, apps done gate):

```bash
pnpm run ci:quality
```

`ci:quality` ends with `pnpm test:apps-done-gate` (same script as `pnpm run test:done-gate` in `packages/apps`). On GitHub, `apps-quality` exports `APPS_DONE_GATE_FULL=1`, so that job includes unit and jsdom. A local `pnpm run ci:quality` uses the local profile unless you export the same variable. Playwright Chromium must be installed first (CI does this before the quality gate; locally: `pnpm --filter @wgw/apps exec playwright install chromium`).

## Reading the output

`pnpm run test:done-gate` prints labeled steps and a final summary. **Exit code 0 = passed.**

## What each layer means

| Layer | Enforces |
|-------|----------|
| **Typecheck** | TS contracts compile; OpenAPI-generated types (`@wgw/openapi-types`) match consumers. |
| **Contract (`test:contract`)** | Settings + list-app mappers preserve required OpenAPI fields; `expectTypeOf` documents UI-only vs API-derived shapes. |
| **Vitest unit** | Pure parsers, mappers, RTC/session helpers — co-located `*.test.ts`. Non-meet domains with unit coverage: `lib/api/wgw/*-utils`, `route-guard`, `mail-core/*-utils`, `drive-core/*-utils`, `notes-core/*-utils`, `admin-core/*-utils`, `hooks/collection-controller-utils`. Offline multi-domain registry/migration tests use the neutral app-#2 template at [`lib/offline/__tests__/fixtures/notes-offline-fixture.ts`](../../../packages/apps/src/lib/offline/__tests__/fixtures/notes-offline-fixture.ts) (see [`offline-db-multi-domain.test.ts`](../../../packages/apps/src/lib/offline/core/__tests__/offline-db-multi-domain.test.ts)). |
| **Vitest jsdom** | Hook and pane RTL with **mock `operations`** — co-located `*.test.tsx`. CI only. Rotate-per-package shards recycle the Node process (`JSDOM_SHARDS` is the lever). Package `p` starts at shard `p % N` so one-file packages do not pile onto shard 1; heap-heavy RTL files (`use-calendar-controller*`, `use-contacts-*`, `contacts-detail-view`, `workspace-live-app-shell`) each get a solo process. CI runs packed shards in a small pool, then solo files in a smaller one — see `scripts/jsdom-concurrency.mjs`. The runner finishes every shard and prints a ✓/✗ summary. `isolate: true` does not reclaim jsdom/Lit/TipTap/Yjs heap — do not “fix” the next OOM with a bigger heap or a wider pool. A single huge RTL file can still OOM a shard — split that file or keep the heavy path in Storybook `vitest-ci`. |
| **Storybook `vitest-ci`** | Offline mock-tier stories render; `play` asserts critical interactions; a11y `error` via `STORYBOOK_A11Y_GATE=1` (set by gate and CI). |
| **Storybook coverage** | Every exported pane/component has a mock-tier story ([storybook/offline-first.md](../storybook/offline-first.md)). |

## Interaction test targets (ongoing)

Baseline audit (expand over time — not a hard gate count yet):

| Signal | Current (post #81) | Near-term target |
|--------|--------------------|------------------|
| Story files | ~101 | + mock-tier for every new export |
| `vitest-ci` tagged story files | **18** (primitives + all 7 product verticals) | **25+** — deeper flows per app |
| `play` functions | **14** | One `play` per touched pane in new work |
| WCAG gate | **On** in CI smoke + done gate | Keep `vitest-ci` stories violation-free |

Tag product-pane smoke stories at **meta** or **story** level with `vitest-ci`. Every major vertical (Drive, Mail, Settings, Install, Notes, Meet, Docs, Admin) has at least one `play` flow — keep it that way for new verticals.

## Type contracts (UI ↔ API)

1. **HTTP shapes** come from `packages/api/openapi/openapi.json` → `@wgw/openapi-types/*`.
2. **Form → request** mappers must use OpenAPI Zod helpers (e.g. `settingsProfileRequestOpenapiSchema.parse`) — see `settings-profile-form-schema.ts`.
3. After OpenAPI changes: `pnpm --filter @wgw/openapi-types typegen`, then apps `typecheck`.
4. Do **not** hand-roll request types that duplicate generated schemas.

### UI vs API shape policy

| Layer | Role | Example |
|-------|------|---------|
| **`@wgw/openapi-types/*`** | Canonical HTTP request/response types from OpenAPI | `SettingsStateResponse`, `MailMessageListItem` |
| **`lib/api/wgw/types.ts`** | App narrowing on generated types (optional fields, wire aliases) | `WgwMailMessageListItem` adds required `folder` + `uid` |
| **`*UIData` / `*Operations`** | Hand-maintained UI contract consumed by panes/hooks | `SettingsUIData`, `MailUIData` |
| **Mappers** (`lib/api/wgw/*.ts`) | OpenAPI JSON → `*UIData`; must preserve every **required** API field | `mapWgwSettingsStateToUI`, `mailFromWgwListItem` |

**When to narrow or rename**

- **1:1 copy** — keep the OpenAPI field name on `*UIData` when the pane displays it directly (settings profile, mail server fields).
- **Rename for UI** — allowed when the semantic mapping is stable and documented in contract tests (e.g. `subject` → `Mail.title`, `read` → inverted `Mail.unread`, `starred`/`flagged` → `Mail.starred`).
- **UI-only fields** — enrich in the mapper (excerpt, wordCount, mailbox display label); document via `expectTypeOf` in `src/lib/api/contract/` so they are not mistaken for API fields.
- **Request bodies** — always use generated types or OpenAPI Zod schemas; never duplicate with hand-rolled interfaces.

**Contract tests** (`pnpm --filter @wgw/apps run test:contract`, also in done gate):

- `expectTypeOf` / `satisfies` — API-derived slices of `*UIData` stay aligned with generated types.
- Adapter round-trip — OpenAPI-shaped fixtures → mapper → `assertFieldMappings` on required fields; **CI fails if a mapper drops a listed field**.

Add contract coverage when introducing a new `*UIData` mapper or changing OpenAPI response shapes for settings or list apps.

## When implementing UI

1. **Mock-tier story first** for new exports ([test-first.md](test-first.md)).
2. **Vitest** for non-trivial hooks/parsers ([ui-architecture.md](ui-architecture.md)).
3. **`vitest-ci` + `play`** for one critical interaction per touched product pane.
4. Run **`pnpm run test:done-gate`** before handoff.

## Chromatic (optional — out of done gate)

Visual regression via [Chromatic](https://www.chromatic.com/) is wired as a dedicated CI job ([#85](https://github.com/WeGotWorkspace/wegotworkspace/issues/85)). It is not run by `pnpm test:apps-done-gate`.

| Aspect | Policy |
|--------|--------|
| Required for merge | **No** — not a branch-protection required check until maintainers add it |
| CI gating | **`exitZeroOnChanges: true`** — a successful publish stays green; unaccepted visual diffs are reviewed in Chromatic |
| Baselines | **`autoAcceptChanges: "main"`** only — `main` updates baselines; PRs still need review |
| Snapshot scope | Dedicated job uses **`onlyChanged: true`** (TurboSnap); Live stories excluded |
| Enablement | Repo variable `CHROMATIC_ENABLED=true` + secret `CHROMATIC_PROJECT_TOKEN` |

Setup, CI wiring, and maintainer checklist: [storybook/chromatic.md](../storybook/chromatic.md).

## Out of scope for this gate

- **Live-tier stories** (`Live …`) — manual smoke only; also excluded from Chromatic snapshots.
- **Apps Playwright e2e** — optional local smoke (`pnpm test:apps-e2e`); not in CI. Phase 1 loads mock-tier Storybook stories (e.g. `Features/Workspace` login shell). Reuse a running Storybook with `WGW_APPS_E2E_NO_SERVER=1` when `pnpm dev:storybook` is already up.
- **Chromatic** — optional CI job; enable with repo variable `CHROMATIC_ENABLED=true` and `CHROMATIC_PROJECT_TOKEN` secret (see `.github/workflows/ci.yml`).
- **Full Storybook Vitest catalog** — run locally: `pnpm --filter @wgw/apps run test:storybook`.

## Definition of done (UI slice)

- `pnpm run test:done-gate` green
- `pnpm check:storybook-coverage` green (included in gate)
- Mock-tier stories for changed exports; a11y panel checked in dev
- No `@/lib/api/wgw/http` imports in panes ([apps-ui/components.md](../apps-ui/components.md))

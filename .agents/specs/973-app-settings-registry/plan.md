# App settings registry and dual host

Derived from [spec.md](./spec.md). Sequential chunks. Source Task #973.

## Goal

Registry-driven Settings nav and a shared panel host, with Mail IMAP as the first app panel and an in-app dialog/footer chrome.

## Budget

Identified Goal #971 — not on a release milestone. Displaces nothing on Adopted v0.9 packing.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Settings sections are a five-id union. `path: packages/apps/src/settings-core/src/settings-section.ts:1`
- Account sidebar currently hides Mail. `path: packages/apps/src/settings-core/src/use-settings-sidebar-model.tsx:54`
- Footer is avatar + logout only. `path: packages/apps/src/workspace-shell/src/workspace-app-layout.tsx`
- `GET /capabilities` is login-only. `path: packages/apps/src/lib/api/wgw/http.ts`

## Considered

Considered: Calendar-first proof panel — rejected because it needs new settings content and an API, which is a non-goal. Mail IMAP already lives in Settings.

## Affected packages

- packages/apps | packages/apps/docs/workspace-shells.md

## Dependencies

1. Chunk 0 specs exist (this folder).
2. Registry + Settings app host (A) before dialog/footer (B).
3. Stories/tests (C) after A–B.

## Open decisions

None — every choice for this work is made.

## Invariants

- Unknown `/settings/$section` falls back to Profile. Proof: `path: packages/apps/src/settings-core/src/settings-section.test.ts`
- Assistants hidden when MCP off. Proof: `path: packages/apps/src/settings-core/src/use-settings-sidebar-model.test.tsx`
- After chunk A, `/settings/mail` still renders Mail IMAP. Proof: route-click tests plus sidebar Apps → Mail.

## Chunks

### Chunk 0: File issues and spec

- **id:** `file-issues`
- **Skill:** plan-feature
- **Inputs:** Task #973
- **Done when:** spec/plan/tasks exist with Source body-hash `751c8d1a`
- **Verify with:** `gh issue view 973 --json body`
- **Parallel with:** none

### Chunk A: Registry + panel host

- **id:** `registry-host`
- **Skill:** workspace, apps-ui
- **Inputs:** this spec
- **Done when:** named ctx; `registerBuiltinSettings()`; reset clears builtin flag; slice+panel `reachable`; Settings nav from registry; Mail under Apps
- **Verify with:** `pnpm --dir packages/apps test -- src/settings-core/src/settings-registry.test.ts src/settings-core/src/settings-section.test.ts src/settings-core/src/use-settings-sidebar-model.test.tsx src/settings-core/src/settings-app-route-click.test.tsx`
- **Parallel with:** none

### Chunk B: Dialog provider + footer chrome

- **id:** `dialog-footer`
- **Skill:** workspace, apps-ui
- **Inputs:** Chunk A
- **Done when:** providers at SPA shell; Mail dialog; dismiss vs navigate focus; onSaved notify; product workspaces pass `appId`; empty apps hide the row
- **Verify with:** RTL Mail footer + dialog + both focus paths; Notes footer negative
- **Parallel with:** none

### Chunk C: Stories + tests

- **id:** `tests-stories`
- **Skill:** testing, storybook
- **Inputs:** Chunks A–B
- **Done when:** mock-tier stories; no Notifications nav item; no new source/CSS-read tests
- **Verify with:** targeted Vitest + Storybook; `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Registry unit tests (hide-empty, slice gate, MCP `=== true`, duplicate throw, reset then register)
- [ ] Dual-placement test-only fixture
- [ ] Route and sidebar tests
- [ ] RTL footer/dialog/focus
- [ ] `notifySettingsSliceSaved` unit
- [ ] Storybook mock-tier
- [ ] No API / OpenAPI

## Doc updates

- Short note in `packages/apps/docs/workspace-shells.md`

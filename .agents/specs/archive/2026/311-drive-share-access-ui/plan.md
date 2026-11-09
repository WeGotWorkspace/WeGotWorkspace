# Drive guest / link sharing — access UI

Derived from [spec.md](./spec.md). Chunk layout reflects work already delivered on `feat/drive-share-access-ui` (retroactive spec for feat/ gate).

## Goal

Ship Drive/Docs share access UI: dialog, public guest flow, Shared with me, access indicators, and rights-gated collab — closing Task #311 delivery for the UI layer.

## Non-goals

- Expiry UI (Goal #388 follow-up)
- Rate-limiting WIP
- E2EE / vault guest shares

## Affected packages

- packages/apps | packages/api (OpenAPI share schemas / session routes)

## Dependencies

1. Drive share API + OpenAPI types (create / patch / at-path / shared-with-me / public session)
2. Apps share-ui + Drive/Docs wiring
3. Guest public route + session hydration
4. Polish, rights gating, password once-show

## Chunks

### Chunk A: Share API client + fixtures

- **id:** `chunk-share-api-client`
- **Skill:** apps-ui / api
- **Inputs:** OpenAPI drive-share schemas
- **Done when:** WGW + mock `DriveShareOperations`; fixtures match `DriveShareAtPath`
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/api`
- **Parallel with:** none (foundation)

### Chunk B: Share dialog module

- **id:** `chunk-share-ui-dialog`
- **Skill:** apps-ui / workspace
- **Inputs:** chunk A operations
- **Done when:** Share dialog stories + principal search / team / public link flows
- **Verify with:** Storybook + Vitest for share-ui
- **Parallel with:** chunk-access-manager after A

### Chunk C: Drive / Docs workspace wiring

- **id:** `chunk-workspace-wiring`
- **Skill:** workspace
- **Inputs:** chunk B
- **Done when:** Share menu in Drive + Docs; Shared with me; indicators from `hasShares`
- **Verify with:** drive/docs Vitest + `pnpm test:apps-done-gate`
- **Parallel with:** chunk-guest-public after B

### Chunk D: Guest public route + session

- **id:** `chunk-guest-public`
- **Skill:** workspace
- **Inputs:** share public token API
- **Done when:** `SharePublicRoute` / guest Drive state; re-auth after password change
- **Verify with:** guest routing tests
- **Parallel with:** chunk-workspace-wiring

### Chunk E: Access manager + rights gating

- **id:** `chunk-access-manager`
- **Skill:** workspace
- **Inputs:** chunk A
- **Done when:** Access pane/filters (disconnected from primary product chrome as decided); Docs collab gated on `myRights`
- **Verify with:** access + collab permission tests
- **Parallel with:** chunk-workspace-wiring

### Chunk V: Cross-chunk verify

- **id:** `chunk-verify`
- **Skill:** testing / code-review
- **Done when:** apps done gate green; feat/spec present; rate-limiting WIP excluded
- **Verify with:** `pnpm test:apps-done-gate` (+ `pnpm test:api-done-gate` if API touched)

## Test plan

- [x] Apps typecheck via `tsconfig.typecheck.json`
- [x] Vitest unit/jsdom for share hooks, Shared with me, guest routing
- [ ] Manual: create public/guest share → open link as guest → view-only Doc/Drive
- [ ] Confirm expiry remains out of scope until Goal #388 follow-up

## Doc updates (only if user wants)

- None required beyond this spec folder for the feat/ gate

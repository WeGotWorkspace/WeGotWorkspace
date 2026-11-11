# Break the import cycles between app packages

Derived from [spec.md](./spec.md). One chunk per pull request, stacked in order.

## Goal

Lower the #1632 warning count with mechanical moves into `src/lib/`, starting with the move that removes the most edges. See spec.md.

## Budget

Technical debt milestone, night of 2026-11-10. Displaces nothing on the pioneer list: renames and import paths only.

## Non-goals

- Behavior changes, the #1642 error-level flip, moves the issue does not name.

## What exists

- Count on the #1632 branch before any move: 437 warnings in 252 files, 21 two-way pairs; `lib` → `drive-core` 25 files, `lib` → `share-ui` 12. `path: packages/apps/scripts/lint-boundaries.mjs:1`
- The Drive model files depend only on `lib` and OpenAPI types. `path: packages/apps/src/lib/files/drive-types.ts:1`
- `drive-file-utils.ts` imports Drive labels; `drive-batch-utils.ts` imports React state setters. `path: packages/apps/src/drive-core/src/drive-file-utils.ts:3`
- Domain types import the sharing model from `share-ui` (`CollectionShareWith`, `CollectionSharePrincipal`, `SharePrincipalKind`). `path: packages/apps/src/tasks-core/src/tasks-types.ts:1`
- `calendar-meet-link.ts` imports Meet's invite and public-id helpers. `path: packages/apps/src/calendar-core/src/calendar-meet-link.ts:3`

## Considered

- Re-export shims at the old paths: rejected, see spec.
- One large pull request: rejected. Four import/export sessions edit Docs and Drive files tonight; small renames keep their conflicts small and reviewable.
- Moving `drive-file-utils.ts` whole with Drive's labels: rejected. Labels are app copy and belong to the app.

## Affected packages

- packages/apps | .agents

## Dependencies

1. #1632 (rule and report) lands first; every chunk is stacked on it.
2. Chunk B needs chunk A (`lib/files/drive-models.ts`). Chunk D needs chunk C (sharing types in `lib`). Chunk E needs chunk D (calendar types in `lib`).

## Open decisions

None — every choice for this work is made.

## Invariants

- No behavior change: every moved symbol keeps its name and body. A wrong change breaks a caller. Proof: `cmd: pnpm --filter @wgw/apps run typecheck && pnpm --filter @wgw/apps exec vitest run --project unit && pnpm --filter @wgw/apps run test:jsdom`
- Each chunk lowers the boundary count and adds no new edge. Proof: `cmd: pnpm --filter @wgw/apps run lint:boundaries`
- Lint stays at 0 errors. Proof: `cmd: pnpm --filter @wgw/apps run lint`

## Chunks

### Chunk A: Drive file model

- **id:** `chunk-a-files-model`
- **Skill:** apps-ui
- **Inputs:** `drive-models.ts`, `drive-types.ts`, `drive-path-utils.ts` — `path: packages/apps/src/lib/files/drive-models.ts:1`
- **Done when:** the three files and the path-utils test live in `src/lib/files/`; no importer uses the old path.
- **Verify with:** invariants above; count 437 → 398.
- **Parallel with:** none

### Chunk B: pure file helpers

- **id:** `chunk-b-file-helpers`
- **Skill:** apps-ui
- **Inputs:** the label-free helpers of `drive-file-utils.ts` (kind, extension, size) and the entry-name helpers of `drive-batch-utils.ts` (free name, trash listing, trash folder); `docs-collab-text-files.ts`, which needs only `extensionFromFileName`.
- **Done when:** those helpers and their tests live in `src/lib/files/`; `lib`, `share-ui`, `file-preview` and `text-editor-core` import them from there.
- **Verify with:** invariants above.
- **Parallel with:** none

### Chunk C: sharing model

- **id:** `chunk-c-sharing-model`
- **Skill:** apps-ui
- **Inputs:** `share-ui/collection-share.ts` (pure), `ShareUIPermission` helpers in `share-ui/share-access-map.ts`, `SharePrincipalKind`.
- **Done when:** the pure sharing model lives in `src/lib/sharing/`; components stay in `share-ui`.
- **Verify with:** invariants above.
- **Parallel with:** none

### Chunk D: domain types

- **id:** `chunk-d-domain-types`
- **Skill:** apps-ui
- **Inputs:** `contacts-types.ts`, `tasks-types.ts`, `notes-types.ts`, `calendar-types.ts` (with the attendee types it needs), `meet-types.ts`.
- **Done when:** each lives in `src/lib/models/`; `lib` imports none of them from an app. One pull request per type file when the diff is large.
- **Verify with:** invariants above.
- **Parallel with:** none

### Chunk E: meeting links

- **id:** `chunk-e-meeting-links`
- **Skill:** apps-ui
- **Inputs:** `calendar-meet-link.ts` and the Meet helpers it imports.
- **Done when:** it lives in `src/lib/meetings/`; `meet-core` does not import `calendar-core` for it.
- **Verify with:** invariants above.
- **Parallel with:** none

## Test plan

- [ ] Per chunk: typecheck, unit, jsdom, lint, `lint:boundaries` before and after, and a browser smoke of every app whose files moved.

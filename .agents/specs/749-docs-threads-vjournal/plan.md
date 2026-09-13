# Docs threads VJOURNAL

Derived from [spec.md](./spec.md). Sequential implementation: API storage first, then client cutover, then Task #750 archive lifecycle.

## Goal

Persist comment and suggestion **discussion** sidecars as VJOURNAL using chat’s converter/repository pattern, cut the review panel over to REST in one step, then archive suggestion journals on accept/reject without changing TipTap mark commands.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/api
- packages/apps
- .agents/specs/749-docs-threads-vjournal/

## Dependencies

1. GitHub Tasks #749 / #750 under Goal #548 (done before this spec).
2. Chunk A (OpenAPI + API storage + tests) before client cutover.
3. Chunk C (archive) after A+B — needs REST PATCH archived and client accept/reject hooks.

## Chunks

### Chunk A: API storage and contract

- **id:** `api-threads`
- **Skill:** api
- **Inputs:** chat converter/repository, DriveShareAuthorizer, ChatHiddenCalendarBackend, OpenAPI `/files/collaboration`
- **Done when:** GET/POST `/files/threads`, replies, reactions, PATCH resolve/archive, GET `/files/threads/changes`; pool + index; DAV hide; producer events; comment-grant 201 / view-only 403; no calendar share roster; converter unit tests
- **Verify with:** `pnpm test:api-done-gate` (or targeted PHPUnit) and `pnpm --filter @wgw/api run typegen`
- **Parallel with:** none

### Chunk B: Client one-shot cutover

- **id:** `client-cutover`
- **Skill:** workspace
- **Inputs:** Chunk A REST + existing `DocsCommentThread` / suggestion domain types
- **Done when:** review panel + `use-docs-comments*` / suggestion discussion hooks read REST; Y.Maps `comments` and `suggestionThreads` are not SoT; poll while mounted; Vitest + mock-tier Storybook
- **Verify with:** targeted Vitest under `packages/apps/src/text-editor-core/docs-collab/`
- **Parallel with:** none (needs A)

### Chunk C: Suggestion archive lifecycle (Task #750)

- **id:** `task2-archive`
- **Skill:** workspace + api
- **Inputs:** Chunk A `X-WGW-ARCHIVED` + PATCH; Chunk B REST client
- **Done when:** accept/reject still uses TipTap commands; matching suggestion journal is archived; Open/Resolved UX unchanged; orphan prune archives
- **Verify with:** API feature test + Vitest on accept/reject / prune
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → feature tests (comment sharee 201, view-only 403, DAV hide, RELATED-TO assembly, producer event, no calendar share roster, restart list) → converter unit tests → `composer done-gate` / `pnpm test:api-done-gate`
- [ ] UI: Vitest on REST assembly and `filterReviewItemsByTab` contract; mock-tier review panel Storybook
- [ ] Task 2: accept/reject editor behavior unchanged; journal archived not deleted

## Doc updates (only if user wants)

- None required beyond this spec folder.

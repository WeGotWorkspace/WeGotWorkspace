# ICS/vCard payload bounds

Derived from [spec.md](./spec.md). Sequential chunks — A and B share files; B depends on A’s tests. One PR, two commits.

## Goal

Close #162: per-object ICS/vCard caps, partial imports, JMAP `tooLarge`, and isolated reads of over-cap stored objects.

## Non-goals

Same as [spec.md](./spec.md).

## Affected packages

- `packages/api`
- `packages/openapi-types`

## Dependencies

1. Chunk A (contract + failing tests)
2. Chunk B (enforcement) — same PR, second commit
3. Chunk C (done gate + parity doc + follow-up issue)

## Chunks

### Chunk A: Spec, contract, failing tests

- **id:** `chunk-a-contract-tests`
- **Skill:** api
- **Inputs:** issue #162, approved plan decisions
- **Done when:** Spec files exist; OpenAPI documents bounds, import codes, `tooLarge`, read isolation; `pnpm typegen` regenerated; feature/unit tests rewritten/added as in the approved plan (new cases may be red)
- **Verify with:** `cd packages/api && php artisan test --filter='VObjectPayloadGuardTest|JmapRestPayloadBoundsTest|JmapCalendarPayloadBoundsTest|JmapContactsPayloadBoundsTest'`
- **Parallel with:** none

### Chunk B: Enforce on write and read paths

- **id:** `chunk-b-enforce`
- **Skill:** api
- **Inputs:** Chunk A commit
- **Done when:** Nested component counter; per-group calendar import checks; contact import body cap + per-card guard codes; JMAP get / task list isolation; `JmapSetErrors` → `tooLarge`; log levels as specified; same PHPUnit filter green
- **Verify with:** same filter as Chunk A (green)
- **Parallel with:** none

### Chunk C: Done gate

- **id:** `chunk-c-verify`
- **Skill:** testing
- **Inputs:** both commits
- **Done when:** `pnpm test:api-done-gate` green; parity-doc #162 row updated; follow-up issue filed and linked; all four #162 AC `PASS`
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

## Test plan

- Unit: byte boundaries; combined 64 including nested alarm; VTIMEZONE not counted; 512 properties
- REST: single-object writes/GET 413; list 200 omitting over-cap; calendar/contact import body and per-item errors
- JMAP: set HTTP 200 `tooLarge`; query omits over-cap id; get `notFound` for that id
- `post_too_large` tests unchanged

# Undo as a compensating write — plan

## Goal

See [spec.md](spec.md): one contract in `useQueuedMutation`, every call site migrated, two live bugs fixed.

## Budget

Draws from Epic #1659 (live push). Displaces nothing.

## Non-goals

See spec.md.

## What exists

- `useQueuedMutation` defers by default, `executeImmediately` runs at once but Undo only rolls the screen back. `path: packages/apps/src/hooks/use-queued-mutation.ts:58`
- Run-now-then-revert already exists for Drive batches. `path: packages/apps/src/drive-core/src/run-immediate-drive-batch.ts:29`
- Calendar editor mutations are immediate and undo with server writes (create → delete, update → patch back). `path: packages/apps/src/calendar-core/src/use-calendar-controller.ts:563`
- Tasks complete is immediate with a screen-only Undo (bug). `path: packages/apps/src/tasks-core/src/use-tasks-mutations.tsx:207`
- Docs permanent delete is immediate and offers Undo (bug). `path: packages/apps/src/docs-core/src/use-docs-home-actions.tsx:293`
- Drive permanent delete and the Drive hard delete of items shared with you are immediate and offer Undo (bug). `path: packages/apps/src/drive-core/src/use-drive-batch-actions.tsx:182`
- Notes upserts coalesce in the outbox, archive/restore do not. `path: packages/apps/src/lib/offline/notes-hybrid-operations.ts:1`
- Notes archive/restore is an idempotent status PATCH, so swapping a queued row's op is safe. `path: packages/apps/src/lib/api/wgw/notes.ts:432`

## Considered

- **Keep the grace period, shorten it** — rejected by product (2026-11-02): any delay is visible with push.
- **Per-app opt-in** — rejected: one suite-wide contract, enforced by the type.
- **Abort the request on Undo** (as `executeImmediately` did) — rejected for reversible writes: an aborted fetch may still land, and the client then never reverts it.
- **Revert by writing the before-snapshot** — rejected: it overwrites someone else's concurrent edit. Reverts are deltas.
- **Offline: delete the queued row on Undo** — rejected for archive/restore: if the flush is sending it at that moment the server applies it and nothing restores it. Rewriting the row in place lets `settleSentOutboxMutation` send it again.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (contract) before every app chunk.
2. App chunks B–E are independent of each other.

## Open decisions

None.

## Invariants

- A deferred (irreversible) write is still sent on page exit (#1794). Proof: `path: packages/apps/src/hooks/use-queued-mutation.test.tsx` "sends a pending write right away when the page is hidden".
- Undo of a reversible write sends the revert only after `execute` settled. Proof: `path: packages/apps/src/hooks/use-queued-mutation.test.tsx` "waits for the write to settle before reverting".
- Grandfathered hooks do not grow. Proof: `cmd: pnpm check:hook-size && pnpm check:file-size`.

## Chunks

### Chunk A: Contract
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/hooks/use-queued-mutation.ts:1`
- **Done when:** union type, reversible/irreversible runners, tests.
- **Verify with:** `pnpm --filter apps exec vitest run src/hooks/use-queued-mutation.test.tsx`
- **Parallel with:** none

### Chunk B: Notes (+ notes outbox archive/restore swap)
- **Skill:** workspace
- **Done when:** star, archive, move, tag, tag-toggle, batch star/archive, tag rename reversible; delete irreversible.
- **Parallel with:** C, D, E

### Chunk C: Tasks, Drive, Docs
- **Done when:** tasks complete/move reversible, delete irreversible; drive/docs star, batch star, trash, move reversible; permanent deletes and foreign removal irreversible.
- **Parallel with:** B, D, E

### Chunk D: Contacts
- **Done when:** group membership, rename, create, move reversible; card and group delete irreversible; hook does not grow.
- **Parallel with:** B, C, E

### Chunk E: Calendar
- **Done when:** editor and split-drag undo go through `revert` (waits for the created/forked id); event delete irreversible; hook does not grow.
- **Parallel with:** B, C, D

### Chunk V: Cross-chunk verify
- Read-only verifier; then a two-browser e2e on a production build (Notes: tag, star, archive, move undo seen by the other person).

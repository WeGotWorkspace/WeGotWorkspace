# Tasks — 1854 undo compensating writes

| Chunk | Task | Key paths | Verify |
|-------|------|-----------|--------|
| A | Reversible/irreversible union, runners, batch helper | `hooks/use-queued-mutation.ts`, `hooks/use-batch-actions.ts` | `vitest run src/hooks/use-queued-mutation.test.tsx` |
| B | Notes call sites, revert helpers, outbox archive/restore swap | `notes-core/src/*`, `lib/offline/notes-hybrid-operations.ts`, `lib/offline/notes-outbox-flush.ts` | `vitest run src/notes-core src/lib/offline/notes-*` |
| C | Tasks complete (bug) / move / delete | `tasks-core/src/use-tasks-mutations.tsx` | `vitest run src/tasks-core` |
| C | Drive + Docs star, batch star, trash, move; permanent deletes deferred (bugs) | `drive-core/src/*`, `docs-core/src/use-docs-home-actions.tsx` | `vitest run src/drive-core src/docs-core` |
| D | Contacts call sites via helpers outside the hook | `contacts-core/src/*` | `vitest run src/contacts-core` |
| E | Calendar editor / split-drag through `revert`, delete deferred | `calendar-core/src/*` | `vitest run src/calendar-core` |
| V | Ratchets, typecheck, lint, two-browser e2e | — | `pnpm check:hook-size`, `pnpm --filter apps typecheck` |

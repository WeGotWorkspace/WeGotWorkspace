# One inbound sync engine for the offline collections

Derived from [spec.md](./spec.md). Sequential pull requests, one domain at a time, plus one independent JMAP chunking pull request.

## Goal

Extract the inbound half of offline sync from Notes (the most complete copy) into `lib/offline/core/inbound-sync.ts`. Move Notes onto it unchanged, move Tasks onto it as the proof, then Contacts, Calendars and Meet chat. Each of those gains the Notes protections it lacks today.

## Budget

Draws from the Pioneer programme's sync-correctness work (#1565 stays in that milestone). It is also #1641's offline family: the "Offline domains" step moved from #1641 to #1565 on 2026-10-26. Displaces further one-off inbound fixes per app: each new inbound bug in a migrated domain is fixed once, in the engine.

## Non-goals

- Outbox executor unification and the `lib/offline/` folder moves (#1565 checklist items, own chunks after this plan)
- Drive and Docs inbound for now (path-keyed tree crawl). Their move onto the engine stays on #1565 with its own binding design.
- Any visible change in Notes or Tasks

## What exists

- The shared contract has store functions only, no inbound abstraction. `path: packages/apps/src/lib/offline/core/types.ts:48`
- Notes REST inbound: notebooks first, then per-notebook changes. It falls back to a full list with no token or on `cannotCalculateChanges`, prunes missing notes except queued or `createPending` ones, and holds the notebook token when a skipped id still has an outbox row that is not a `stateMismatch`. `path: packages/apps/src/lib/offline/notes-inbound-sync.ts:76`
- Notes reports a conflict only when the server moved since the write was queued; an unknown base counts as moved. `path: packages/apps/src/lib/offline/notes-jmap-inbound.ts:81`
- Tasks uses the same rule with an unknown base counted as not moved, one account-wide token, and a full re-list of every touched list. `path: packages/apps/src/lib/offline/tasks-inbound.ts:65`
- Contacts protects `pendingSync` rows only and reports any inbound change to a pending id as a conflict. `path: packages/apps/src/lib/offline/contacts-offline-store.ts:118` `path: packages/apps/src/lib/offline/contacts-jmap-inbound.ts:21`
- Calendars has a token reader and writer that only the domain contract uses; inbound runs from in-memory JMAP state. `path: packages/apps/src/lib/offline/calendars-offline-store.ts:157`
- Meet chat merges an edit into a queued send outside a transaction, the #1711 pattern. `path: packages/apps/src/lib/offline/meet-chat-offline-store.ts:114`
- Two private copies of chunked JMAP get exist: `#getContactCardsByIds` in `JmapContactsClient` (pages at `min(maxObjectsInGet, CONTACT_CARD_GET_MAX_IDS_PER_REQUEST)` = 40) and `#maxObjectsInGet` in `JmapFileNodesClient`. `path: packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts` `path: packages/apps/src/lib/jmap-client/filenodes/JmapFileNodesClient.ts`
- Notes, Calendar and Chat fetch changed ids in one unchunked get. `path: packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:63` `path: packages/apps/src/lib/jmap-client/calendars/JmapCalendarsClient.ts:89` `path: packages/apps/src/lib/jmap-client/chat/JmapChatClient.ts:56`
- PR [#1785](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1785) (#1661, open) moves the four JMAP adapters onto a shared `JmapInboundAdapter` base with `pullChanges()` / `refetchAll()`.

## Considered

Considered:

- **Extend `OfflineDomainStore` with inbound methods and let the core call the store directly.** Rejected. The ingest decision (merge, skip, conflict) differs per domain only in a few policy bits, while the store functions differ in shape (field merge, list membership, notebook rows). A binding object with a small policy keeps the core free of domain types.
- **One policy for an unknown base right away.** Rejected for the Notes and Tasks chunks, because both must stay unchanged. The engine takes the policy as a binding option. Contacts and Calendars choose "not moved" when they migrate, because their queued updates already carry a base.
- **A generic React hook that owns polling.** Rejected. Polling and triggers stay in the app hooks and the JMAP adapter base from #1785; the engine is called by them.
- **Chosen:** a pure core (pending-write reader, conflict decision, scope reconcile, token hold) plus one runner for "changes per scope with a full-list fallback". Tasks keeps its own pull (one account-wide state, then a full re-list of each touched list) and uses the core pieces only: forcing it through the per-scope runner would change when its state advances.

## Affected packages

- packages/apps

## Dependencies

1. `jmap-get-chunks` is independent and can merge first.
2. `inbound-core` lands with `notes-on-core` in one pull request, so the engine never ships without a user.
3. `tasks-on-core` after `notes-on-core`.
4. `adapters-on-core` after #1785 is merged.
5. `contacts-on-core`, `calendars-on-core` and `chat-on-core` after `adapters-on-core`, one at a time. Contacts waits for #1749 and #1747.

## Open decisions

None. The unknown-base policy is a binding option (Notes moved, Tasks not moved, Contacts and Calendars not moved). Conflict reporting on a remote destroy stays per binding. Drive and Docs are not covered by this note yet. Polling stays where it is.

## Invariants

- A note queued for create or edit survives a full list that lacks it, and is not reported as a conflict. A wrong change deletes unsent notes. Proof: `path: packages/apps/src/lib/offline/notes-inbound-sync.test.ts` assertion `does not prune a note that is still queued, so it is not reported as a conflict`.
- A note that moved between notebooks in one poll is kept. A wrong change deletes it. Proof: `path: packages/apps/src/lib/offline/notes-inbound-sync.test.ts` assertion `does not destroy a note that moved into another notebook in the same poll`.
- The notebook token is held while a skipped destroy can still be sent, and advances for a non-retryable stateMismatch. A wrong change either loses the server's delete or pins the token forever. Proof: `path: packages/apps/src/lib/offline/notes-inbound-sync.test.ts` assertion `does not advance the sync token when a destroy is still pending` and `advances the sync token when the skipped destroy is a non-retryable stateMismatch`.
- A queued Notes field keeps the local value; other fields are adopted; a conflict needs a moved server version. Proof: `path: packages/apps/src/lib/offline/notes-jmap-inbound.test.ts` assertion `merges an inbound tag change when the queued write is an archive` and `does not report a conflict for a queued change the server has not seen yet`.
- A queued Tasks delete is not brought back, and a queued edit is not a conflict while the server has its base version. Proof: `path: packages/apps/src/lib/offline/tasks-inbound-sync.test.ts` assertion `a queued delete is not brought back by the re-list` and `a queued edit is not a conflict when the server copy did not change`.
- A failed Tasks pull or lock timeout leaves cache and state alone. Proof: `path: packages/apps/src/lib/offline/tasks-inbound-sync.test.ts` assertion `a failed pull leaves the cache and the state as they are` and `a lock timeout writes neither the snapshot nor the state`.
- Notes behaves the same end to end across tabs and network states. Proof: `cmd: pnpm --dir packages/apps exec playwright test -c playwright.matrix.config.mjs notes-sync-matrix`.
- Tasks behaves the same end to end across tabs and network states: changes token, full-list fallback, conflict check, list deletes and queued writes after a reconnect. Proof: `cmd: pnpm --dir packages/apps exec playwright test -c playwright.matrix.config.mjs tasks-sync-matrix`.
- After each chunk, main works without the next chunk: each migrated domain keeps its public sync function name and signature. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline src/notes-core src/tasks-core`.

## Chunks

### Chunk A: Chunked JMAP get

- **id:** `jmap-get-chunks`
- **Skill:** workspace
- **Inputs:** the two private copies and the three unchunked callers — `path: packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts:25` `path: packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:63`
- **Done when:** `lib/jmap-client/core` exports one chunked-get helper that reads `maxObjectsInGet` from the session core capability. `JmapNotesClient.getNotes`, `JmapCalendarsClient.getCalendarEvents` and `JmapChatClient.getMessages` use it for id lists over the limit. Contacts uses it in place of its private copy and keeps its 40-id page cap (`CONTACT_CARD_GET_MAX_IDS_PER_REQUEST`). FileNodes switches once #1781 has merged. Each client has a test with more ids than the limit.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/jmap-client`
- **Parallel with:** `inbound-core`

### Chunk B: Engine core

- **id:** `inbound-core`
- **Skill:** workspace
- **Inputs:** Notes and Tasks rules above — `path: packages/apps/src/lib/offline/notes-inbound-sync.ts:76` `path: packages/apps/src/lib/offline/tasks-inbound.ts:65`
- **Done when:** `lib/offline/core/inbound-sync.ts` exports the pending-write reader, `serverMovedSince(bases, remoteVersion, policy)` (the policy also covers a missing remote version), the scope reconcile (removals except pending and `createPending`) and `runScopedInbound(binding)` with token hold and the full-list fallback. Its own unit tests cover every Notes and Tasks invariant above against a fake binding.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline/core/inbound-sync.test.ts`
- **Parallel with:** `jmap-get-chunks`

### Chunk C: Notes on the engine

- **id:** `notes-on-core`
- **Skill:** workspace
- **Inputs:** engine from chunk B
- **Done when:** `syncNotesInboundFromRest` runs its note scopes as a binding over `runScopedInbound`; `syncNotebooks` stays as it is (writes its token first, prunes no notebooks). `ingestRemoteNote` / `ingestRemoteNoteDestroyed` use the engine's pending-write reader and conflict decision, so the JMAP adapter path shares it without touching adapter files. All existing Notes tests pass unchanged, and so do the Notes sync matrix and the live Notes e2e specs.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/notes-core` and `pnpm --dir packages/apps exec playwright test -c playwright.matrix.config.mjs notes-sync-matrix`
- **Parallel with:** none

### Chunk D: Tasks on the engine

- **id:** `tasks-on-core`
- **Skill:** workspace
- **Inputs:** engine from chunk B, Notes binding from chunk C as the reference
- **Done when:** `syncTasksInbound` keeps its lock handling and its pull. `readTasksPendingWrites` is built on the engine's pending-write reader, and the conflict check is the engine's `serverMovedSince` with the "not moved" policy. The snapshot and per-list reconciles use the engine's scope reconcile. A queued list delete still skips that list's resync and its tasks (`deletingLists`). Tasks unit tests and `tasks-inbound-sync.spec.ts` pass unchanged.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/tasks-core` and the live `tasks-inbound-sync` spec
- **Parallel with:** none

### Chunk E: JMAP adapters on the engine

- **id:** `adapters-on-core`
- **Skill:** workspace
- **Inputs:** `JmapInboundAdapter` base from #1785
- **Done when:** the base's `pullChanges()` / `refetchAll()` apply through the engine, with full-list removal except pending. The Notes adapter keeps its current hold exactly: it rewinds note state only when a destroy returns `skipped-pending`, including a `stateMismatch` row, and not for a skipped upsert. A domain gains the engine's token hold only in its own chunk. `sync()` and `syncIfStale()` behave as before for callers.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/jmap-client/adapter`
- **Parallel with:** none

### Chunk F: Contacts on the engine

- **id:** `contacts-on-core`
- **Skill:** workspace
- **Inputs:** engine, adapters from chunk E, #1749 and #1747 merged
- **Done when:** Contacts reads pending writes from the outbox as well as `pendingSync`, so a queued delete is not brought back. Conflicts need a moved server version. A new e2e covers both.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/lib/api/wgw/contacts-sync.test.ts src/contacts-core`
- **Parallel with:** none

### Chunk G: Calendars on the engine

- **id:** `calendars-on-core`
- **Skill:** workspace
- **Inputs:** engine, adapters from chunk E
- **Done when:** the Calendar token persists through `readCalendarSyncToken` / `writeCalendarSyncToken`. Pending writes include outbox rows. `cannotCalculateChanges` removes events missing from the loaded window and no others.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/calendar-core`
- **Parallel with:** none

### Chunk H: Meet chat on the engine

- **id:** `chat-on-core`
- **Skill:** workspace
- **Inputs:** engine, adapters from chunk E
- **Done when:** chat ingest uses the engine's pending-write reader. `enqueueChatEdit` merges into a queued send inside one transaction, and the flush settles the sent row through `settleSentOutboxMutation`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/meet-core`
- **Parallel with:** none

## Test plan

- [ ] Engine unit tests: queued item survives a full list; move between scopes in one run; token held for every outbox row except `stateMismatch`; unknown-base and missing-remote-version policy both ways; a failed changes request writes no token
- [ ] Notes: existing unit tests unchanged, sync matrix green, live Notes specs green
- [ ] Tasks: existing unit tests unchanged, live `tasks-inbound-sync` green, Tasks sync matrix green
- [ ] JMAP get: a client test per domain with more ids than `maxObjectsInGet`
- [ ] `pnpm test:apps-done-gate` before each push

## Doc updates (only if user wants)

- `packages/apps/docs/offline-platform.md` names the engine and the binding shape when Notes and Tasks are on it, so new domains bind instead of copying.

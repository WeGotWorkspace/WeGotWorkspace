Source: #1565 (body-hash: 6d373c5d)

# One inbound sync engine for the offline collections

## Goal

Move the inbound half of offline sync (pull what changed on the server and fold it into the local cache without losing queued local writes) out of the per-app copies into one engine in `packages/apps/src/lib/offline/core/`. Each app keeps only a binding: how to fetch its changes and full lists, how to read its queued writes, and how to write one item into its cache. Notes moves first with no behaviour change, then Tasks as the proof app. Tasks keeps its own account-wide pull and uses only the core pieces (pending-write reader, conflict decision, scope reconcile), because the per-scope runner would change when its state advances. Contacts, Calendars and Meet chat follow one at a time; each gains the protections Notes already has.

## Non-goals

- The outbound side. The outbox store, the cross-tab lock, retry after 429/5xx and the sent-row settle (#1711) are already shared in `lib/offline/core/`.
- Folding the seven `*-outbox-flush.ts` files into one executor, and moving the flat files of `lib/offline/` into domain folders. Both stay on #1565's checklist and get their own chunks after the inbound engine; this spec does not design them.
- The rest of #1565's proposal: a shared queued-write executor with shared conflict and gone handling, idempotent create as the default, extending the domain contract to Tasks, Drive, Docs and Meet chat, and hoisting the renamed mirror-store functions (`read*BootstrapFromCache`, `*OutboxId`, `createTemp*Id`) into generics. They stay on #1565 and get their own design note; this note is the inbound half only.
- Drive and Docs inbound, for now. They key on paths and crawl a tree, so this note gives them only the chunked JMAP get and the queued-path protection. Moving them onto the engine (step 5 of #1565) needs its own binding design and is not dropped.
- Client-chosen ids for Tasks, Calendar and Contacts (closed as #1564; see the amendment on #1565).
- Any user-visible change in Notes or Tasks. Contacts, Calendars and Meet chat do change behaviour, on purpose and per chunk, as listed under Edge cases.

## Affected packages

- packages/apps

## Technical constraints

- One engine, many bindings. The engine is plain TypeScript with no React and no Dexie import. Bindings pass in their store functions, which is how `OfflineDomainStore` in `lib/offline/core/types.ts` already works.
- The JMAP adapters keep `sync()` as their public entry point. PR #1785 (#1661) moves the four adapters onto a shared `JmapInboundAdapter` base with a `protected pullChanges()` / `refetchAll()` seam, and `syncIfStale` needs only `sync()` to resolve true or false. The adapter chunk builds on that base after #1785 merges and does not touch adapter files before then.
- JMAP `*/get` calls with many ids must stay under the server's `maxObjectsInGet` (500 by default). Today only `JmapContactsClient` and `JmapFileNodesClient` chunk, each with its own private copy. #1726 and #1780 were this limit on two Drive call paths.
- Inbound runs under the domain's outbox lock where it does today (Tasks, Contacts). It must never run in the middle of a flush of the same domain.
- No new IndexedDB schema version for the engine itself. Tokens stay where each domain stores them today. Calendars gets a persisted token in its own chunk (its store already has `readCalendarSyncToken` / `writeCalendarSyncToken`, unused outside the contract).

## Behaviour the engine owns

1. **Pending writes.** One reader turns a domain's outbox rows plus its `pendingSync` cache rows into `id → { bases, fields, deleting, blocksToken, queued }`.
   - `bases`: the `ifInState` of each queued write.
   - `fields`: which fields the queued writes own, or "all".
   - `deleting`: a delete is queued.
   - `queued`: the id has any outbox row, including a `stateMismatch` one (what `listOutboxNoteIds` returns today). It differs from `blocksToken`: a remote destroy of a `stateMismatch` row is still skipped, but does not hold the token.
   - `blocksToken`: the id has an outbox row whose `lastError` is not `stateMismatch`. That includes a fresh row and a permanent 403/404, exactly as `listNoteIdsBlockingSyncToken` does today. It is not `isRetryableOutboxRow`, which is false for a row with no retries yet.
   - The outbox row, not only the cache flag, is what keeps a queued delete from being brought back.
2. **Conflict only when the server moved.**
   - A remote change to an id with a pending write is a conflict only when the remote version differs from a base the queued write started from.
   - What an unknown base or a missing remote version means is a per-binding policy. Notes counts either as moved (`serverMovedSinceQueued`). Tasks counts either as not moved and compares only its first queued base (`tasks-inbound.ts`). Both keep their current policy.
   - Whether a remote destroy of a queued id is reported stays with the binding. Tasks does not report it when the queued write is a delete. Notes reports any destroy of an id still in its outbox (`ingestRemoteNoteDestroyed`). Neither changes.
3. **Per-field merge.** A binding can name the fields its queued writes own (Notes). The engine adopts every other field from the remote copy. A binding without field ownership (Tasks) skips the whole item.
4. **Full list with removal.**
   - After a full list of a scope, every cached item of that scope missing from the list is removed. This is the item collection only: Notes' REST notebook fallback (`syncNotebooks`) upserts the listed notebooks and prunes none. The JMAP snapshot (`reconcileNotesSnapshot`) does remove notebooks missing from it. Both stay as they are.
   - The exceptions are items with a pending write and items still waiting for their create (`createPending`).
   - Scopes are de-duplicated across one run, so an item that moved between two scopes in the same poll is upserted, not destroyed.
5. **Token handling.**
   - A scope token advances only after its changes are applied.
   - It is held when an id it names was skipped because of a pending write with `blocksToken`.
   - With no token, or on `cannotCalculateChanges`, the scope falls back to a full list. Where the resume state is read is the binding's: Notes reads it after the list (`listNoteChanges(notebookId, null)`), as today; the Tasks pull reads it before its snapshot. The runner calls the binding's `currentState` after `list`, which is the Notes order.
6. **Chunked get.** One `getInChunks(ids, pageSize, fetch)` helper in `lib/jmap-client/core` is used by every client that fetches changed ids. The page size is the caller's: Notes, Calendar and Chat pass the session's `maxObjectsInGet`; Contacts keeps its 40-id cap (`CONTACT_CARD_GET_MAX_IDS_PER_REQUEST`, because a 500-card get exceeds the php -S time limit); FileNodes stays on the session limit.

## Edge cases

- A note moved from notebook A to B in one poll: A's delta destroys it and B's creates it. The engine upserts it once and never removes it (`notes-inbound-sync.test.ts`, "does not destroy a note that moved into another notebook in the same poll").
- A 404 on a scope's changes call means the scope was deleted. Notes treats it as a destroyed notebook; the engine passes it to the binding's `scopeGone`.
- A skipped destroy whose outbox row is a non-retryable stateMismatch does not hold the token (`"advances the sync token when the skipped destroy is a non-retryable stateMismatch"`).
- A lock timeout or a failed request leaves cache and state as they were in the Tasks pull, which fetches everything before it writes ("a lock timeout writes neither the snapshot nor the state", "a failed pull leaves the cache and the state as they are").
- In Notes, as today: `syncNotebooks` writes the notebooks token before the note scopes run, and a failed note changes request writes no note token. A failed fetch while applying leaves the items applied so far and writes no token, so the next run applies the rest.
- **Contacts, when it moves:** a queued delete whose cache row is gone must not come back (today only `pendingSync` rows are protected). A queued edit is no longer reported as a conflict when the server still has its base version.
- **Calendars, when it moves:** the token persists across reloads, so a reload no longer starts from in-memory state. `cannotCalculateChanges` removes events the server no longer has inside the loaded window. It must not remove events outside that window.
- **Meet chat, when it moves:** an edit of a message whose send is still queued must merge in one transaction. This is the #1711 pattern still present in `enqueueChatEdit`.
- More than 500 changed ids in one poll: Notes, Calendar and Chat clients must chunk their `*/get` (the latent form of #1726 / #1780).

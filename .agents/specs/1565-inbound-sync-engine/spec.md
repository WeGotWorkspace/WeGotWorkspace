Source: #1565 (body-hash: 6d373c5d)

# One inbound sync engine for the offline collections

## Goal

Move the inbound half of offline sync (pull what changed on the server and fold it into the local cache without losing queued local writes) out of the per-app copies into one engine in `packages/apps/src/lib/offline/core/`. Each app keeps only a binding: how to fetch its changes and full lists, how to read its queued writes, and how to write one item into its cache. Notes moves first with no behaviour change, then Tasks as the proof app. Contacts, Calendars and Meet chat follow one at a time; each gains the protections Notes already has.

## Non-goals

- The outbound side. The outbox store, the cross-tab lock, retry after 429/5xx and the sent-row settle (#1711) are already shared in `lib/offline/core/`.
- Folding the seven `*-outbox-flush.ts` files into one executor, and moving the flat files of `lib/offline/` into domain folders. Both stay on #1565's checklist and get their own chunks after the inbound engine; this spec does not design them.
- Drive and Docs inbound. They key on paths and crawl a tree, so they share only the chunked JMAP get and the queued-path protection, not the scoped engine.
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

1. **Pending writes.** One reader turns a domain's outbox rows plus its `pendingSync` cache rows into `id → { bases, fields, deleting, blocksToken }`.
   - `bases`: the `ifInState` of each queued write.
   - `fields`: which fields the queued writes own, or "all".
   - `deleting`: a delete is queued.
   - `blocksToken`: a row that can still be sent (retryable, not a stateMismatch or a permanent 403/404).
   - The outbox row, not only the cache flag, is what keeps a queued delete from being brought back.
2. **Conflict only when the server moved.**
   - A remote change to an id with a pending write is a conflict only when the remote version differs from a base the queued write started from.
   - What an unknown base means is a per-binding policy. Notes counts it as moved, Tasks as not moved. Both keep their current policy.
   - Deleted on both sides is never a conflict.
3. **Per-field merge.** A binding can name the fields its queued writes own (Notes). The engine adopts every other field from the remote copy. A binding without field ownership (Tasks) skips the whole item.
4. **Full list with removal.**
   - After a full list of a scope, every cached item of that scope missing from the list is removed.
   - The exceptions are items with a pending write and items still waiting for their create (`createPending`).
   - Scopes are de-duplicated across one run, so an item that moved between two scopes in the same poll is upserted, not destroyed.
5. **Token handling.**
   - A scope token advances only after its changes are applied.
   - It is held when an id it names was skipped because of a pending write with `blocksToken`.
   - With no token, or on `cannotCalculateChanges`, the scope falls back to a full list. The token for that list comes from a state taken before the list, so a change in between shows up again on the next pull.
6. **Chunked get.** One `getInChunks(ids, maxObjectsInGet, fetch)` helper in `lib/jmap-client/` replaces the two private copies and is used by every client that fetches changed ids.

## Edge cases

- A note moved from notebook A to B in one poll: A's delta destroys it and B's creates it. The engine upserts it once and never removes it (`notes-inbound-sync.test.ts`, "does not destroy a note that moved into another notebook in the same poll").
- A 404 on a scope's changes call means the scope was deleted. Notes treats it as a destroyed notebook; the engine passes it to the binding's `onScopeGone`.
- A skipped destroy whose outbox row is a non-retryable stateMismatch does not hold the token (`"advances the sync token when the skipped destroy is a non-retryable stateMismatch"`).
- A lock timeout or a failed request leaves cache and token as they were (Tasks: "a lock timeout writes neither the snapshot nor the state", "a failed pull leaves the cache and the state as they are").
- **Contacts, when it moves:** a queued delete whose cache row is gone must not come back (today only `pendingSync` rows are protected). A queued edit is no longer reported as a conflict when the server still has its base version.
- **Calendars, when it moves:** the token persists across reloads, so a reload no longer starts from in-memory state. `cannotCalculateChanges` removes events the server no longer has inside the loaded window. It must not remove events outside that window.
- **Meet chat, when it moves:** an edit of a message whose send is still queued must merge in one transaction. This is the #1711 pattern still present in `enqueueChatEdit`.
- More than 500 changed ids in one poll: Notes, Calendar and Chat clients must chunk their `*/get` (the latent form of #1726 / #1780).

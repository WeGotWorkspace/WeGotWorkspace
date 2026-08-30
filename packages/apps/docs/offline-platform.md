# Offline platform — adding offline support to a new app

The generic offline platform lives under [`packages/apps/src/lib/offline/core/`](../src/lib/offline/core). It is **app-agnostic**: it owns the per-account Dexie database, a domain table/version registry, generic outbox + meta stores, connectivity detection, serialized sync runners, the hybrid-bootstrap hook, the account-session helpers, a generic conflict channel, outbox coalescing, and the shell offline indicator.

A **domain plugin** registers its tables, implements a small store/flush/operations layer on top of the core, and wires the shared hooks. Contacts + Notes are live Dexie domains that illustrate the patterns.

Docs now uses the collaboration stack for editable text files:

- `Y.Doc` + `y-indexeddb` persistence in `text-editor-core/docs-collab`
- Deferred server save + reconnect flush via `use-docs-collab`
- Drive REST operations only for browse/rename/non-text file actions (`docs-drive-operations.ts`)

## What the core gives you

| Concern                                                                   | Module                                                                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Dexie factory + version/migration registry                                | [`core/offline-db.ts`](../src/lib/offline/core/offline-db.ts)                                                                      |
| Enforced per-domain Dexie version blocks                                  | [`core/offline-version-allocation.ts`](../src/lib/offline/core/offline-version-allocation.ts)                                      |
| Generic outbox CRUD (`enqueue`/`list`/`remove`/`markError`/`isRetryable`) | [`core/outbox-store.ts`](../src/lib/offline/core/outbox-store.ts)                                                                  |
| Coalesce pending update rows for the same entity                          | [`core/outbox-coalescing.ts`](../src/lib/offline/core/outbox-coalescing.ts)                                                        |
| Key/value meta + sync tokens                                              | [`core/meta-store.ts`](../src/lib/offline/core/meta-store.ts)                                                                      |
| Online/offline detection + snapshots                                      | [`core/browser-online.ts`](../src/lib/offline/core/browser-online.ts) (via [`use-connectivity`](../src/hooks/use-connectivity.ts)) |
| Serialized flush runner + per-account registry                            | [`core/connectivity-sync-runner.ts`](../src/lib/offline/core/connectivity-sync-runner.ts)                                          |
| Cache-then-network bootstrap                                              | [`core/use-hybrid-bootstrap.ts`](../src/lib/offline/core/use-hybrid-bootstrap.ts)                                                  |
| Per-domain account session (`wgw.offline.<domain>.username`)              | [`core/offline-account.ts`](../src/lib/offline/core/offline-account.ts)                                                            |
| Generic conflict channel `createSyncConflictChannel<TId>()`               | [`core/sync-conflicts.ts`](../src/lib/offline/core/sync-conflicts.ts)                                                              |
| Shell "Offline" pill                                                      | [`core/offline-status-indicator.tsx`](../src/lib/offline/core/offline-status-indicator.tsx)                                        |
| Shared type contracts                                                     | [`core/types.ts`](../src/lib/offline/core/types.ts)                                                                                |

The core defines Dexie **version 1** = `{ meta, outbox }`. Each domain owns a **non-overlapping version block** enforced at registration time (see [Version allocation](#version-allocation)). Contacts uses **2–9**, Notes **10–19**.

## Version allocation

Before registering tables, claim a version block in `OFFLINE_DOMAIN_VERSION_RANGES` inside [`offline-version-allocation.ts`](../src/lib/offline/core/offline-version-allocation.ts):

| Domain    | Dexie versions |
| --------- | -------------- |
| core      | 1              |
| contacts  | 2–9            |
| notes     | 10–19          |
| docs      | 20–29          |
| drive     | 30–39          |
| tasks     | 40–49          |
| calendars | 50–59          |

Claim the next free block for a new domain before registering tables. Each version step you register must fall inside your block. `registerOfflineDomainTables` calls `claimOfflineDomainVersions`, which **throws** if:

- the domain has no entry in `OFFLINE_DOMAIN_VERSION_RANGES`;
- a version is outside the allocated range;
- two domains declare the same version number.

Define named constants for your steps (contacts uses `CONTACTS_OFFLINE_VERSION`, notes `NOTES_OFFLINE_VERSION`) so migrations stay readable and stay inside the block.

## Reference implementations

Two shipped Dexie domains cover the main offline shapes. Pick the one closest to your API and copy its file layout.

| Domain   | API shape                                  | Cache model                                                                                                                                   | Cross-tab sync                                                                                                                                               | Key files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts | Entity REST (cards, address books)         | Bootstrap + per-entity rows                                                                                                                   | —                                                                                                                                                            | [`contacts-schema.ts`](../src/lib/offline/contacts/contacts-schema.ts), [`contacts-offline-store.ts`](../src/lib/offline/contacts-offline-store.ts), [`contacts-outbox-flush.ts`](../src/lib/offline/contacts-outbox-flush.ts), [`contacts-hybrid-operations.ts`](../src/lib/offline/contacts-hybrid-operations.ts), [`contacts/contacts-patch-merge.ts`](../src/lib/offline/contacts/contacts-patch-merge.ts)                                                                                                                                                              |
| Notes    | VJOURNAL + Dexie + UID collab session      | Dexie is the only UI working set; inbound `Note/changes` / REST `/changes` upserts Dexie and skips pending; `Y.Doc` + `y-indexeddb` keyed by UID | [`notes-bootstrap-sync.ts`](../src/lib/offline/notes-bootstrap-sync.ts) — BroadcastChannel + localStorage fallback notifies other tabs after flush/reconnect | [`notes/notes-schema.ts`](../src/lib/offline/notes/notes-schema.ts), [`notes-offline-store.ts`](../src/lib/offline/notes-offline-store.ts), [`notes-jmap-inbound.ts`](../src/lib/offline/notes-jmap-inbound.ts), [`notes-outbox-flush.ts`](../src/lib/offline/notes-outbox-flush.ts), [`notes-hybrid-operations.ts`](../src/lib/offline/notes-hybrid-operations.ts), [`use-notes-api.ts`](../src/notes-core/src/use-notes-api.ts), [`note-text-editor-body.tsx`](../src/note-detail-view/src/note-text-editor-body.tsx) — see [Notes VJOURNAL + Dexie](#notes-vjournal--dexie)                                                       |
| Docs     | Text collaboration + REST sidecar          | `Y.Doc` + `y-indexeddb` per collab room; Dexie `docs_availability` auto-sync index + `docs_listing_rows` home cache                           | Yjs provider sync + room-scoped registry (`docs-collab-sync-registry.ts`)                                                                                    | [`use-docs-collab.ts`](../src/text-editor-core/docs-collab/use-docs-collab.ts), [`docs-availability-store.ts`](../src/lib/offline/docs/docs-availability-store.ts), [`docs-pin-hydrate.ts`](../src/lib/offline/docs/docs-pin-hydrate.ts), [`docs-hybrid-operations.ts`](../src/lib/offline/docs/docs-hybrid-operations.ts), [`docs-outbox-flush.ts`](../src/lib/offline/docs/docs-outbox-flush.ts), [`use-offline-sync-toast.ts`](../src/lib/offline/use-offline-sync-toast.ts), [`docs-conflict-dialog.tsx`](../src/text-editor-core/docs-collab/docs-conflict-dialog.tsx) |
| Drive    | Full tree REST + binary/text content       | Dexie `drive_entries` metadata (always synced); `drive_content_blobs` for binaries; text → shared y-indexeddb; `drive_availability` index     | —                                                                                                                                                            | [`drive-schema.ts`](../src/lib/offline/drive/drive-schema.ts), [`drive-metadata-sync.ts`](../src/lib/offline/drive/drive-metadata-sync.ts), [`drive-content-sync.ts`](../src/lib/offline/drive/drive-content-sync.ts), [`drive-hybrid-operations.ts`](../src/lib/offline/drive/drive-hybrid-operations.ts), [`offline-device-settings.ts`](../src/lib/offline/core/offline-device-settings.ts), [`use-drive-api.ts`](../src/drive-core/src/use-drive-api.ts)                                                                                                                |
| Calendar | JMAP CalendarEvent + hybrid outbox         | Dexie calendars/events/groups/inbox (50–52); Lit working set is the only EventsAPI; inbound `/changes` upserts Dexie and skips pending outbox | —                                                                                                                                                            | [`calendars-schema.ts`](../src/lib/offline/calendars/calendars-schema.ts), [`calendars-offline-store.ts`](../src/lib/offline/calendars-offline-store.ts), [`calendars-hybrid-operations.ts`](../src/lib/offline/calendars-hybrid-operations.ts), [`calendars-jmap-inbound.ts`](../src/lib/offline/calendars-jmap-inbound.ts), [`calendar-events-api.ts`](../src/calendar-core/src/calendar-events-api.ts), [`use-calendar-surface.ts`](../src/calendar-core/src/use-calendar-surface.ts)                                                                                    |

**Contacts** is the original reference for patch-merge coalescing and field-level conflict merge. Address book metadata sync uses `GET /contacts/addressbooks/changes` (IndexedDB token in `contacts-offline-store`) and complements per-book card deltas via `GET /contacts/cards/changes`. **Notes** uses Calendar-shaped inbound (`POST /jmap` `Note/changes` → `Note/get`, REST `/changes` as fallback) into Dexie. **Docs** uses collab-first offline persistence with Yjs + y-indexeddb for editable text files. **Drive** adds full-tree metadata crawl (always on) plus size-gated content sync and manual pin for large files; device settings in Settings → Offline apply to Drive and Docs content sync.

## Notes VJOURNAL + Dexie

CalDAV **VJOURNAL** is the document of record. **Dexie is the only UI working set.**
Inbound `/changes` (then vendor `Note/*` on `POST /jmap`) updates that cache.
The workspace must not remount from a full live GET.

| Concern                                                 | Path                         | Storage                                      | Transport                                                      | Conflict model                                                       |
| ------------------------------------------------------- | ---------------------------- | -------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Working set** (title, tags, body, starred, notebook)  | Dexie `notes_notes`          | Full note row including DESCRIPTION          | `POST /jmap` `Note/changes` → `Note/get` (REST `/changes` P0)  | Skip pending outbox ids; optional `stateMismatch` dialog             |
| **Collab session** (live mesh while a room is open)     | TipTap + Yjs, room = **UID** | `y-indexeddb` crash buffer keyed by UID      | Persist = `PATCH /notes/items/{uid}` + `If-Match`              | CRDT merge in-room; reconnect 412 → conflict dialog                  |
| **Metadata outbox** (offline title/tags/star/notebook)  | Dexie outbox                 | Metadata only (no body bytes required)       | REST `PATCH` / create / star                                   | Last-writer-wins with an optional `stateMismatch` dialog             |

There is **no** `PUT /files/collaboration` and **no** `users/…/.notes/…` path for
notes. [`note-text-editor-body.tsx`](../src/note-detail-view/src/note-text-editor-body.tsx)
mounts `NoteCollabBody`; the room is the VJOURNAL UID from
[`note-collab-path.ts`](../src/notes-core/src/note-collab-path.ts)
(`buildNoteCollabUrls`).

**Metadata path modules.** [`wgwNoteMetadataFromNote`](../src/lib/api/wgw/notes.ts)
builds the metadata request; [`notes-hybrid-operations.ts`](../src/lib/offline/notes-hybrid-operations.ts)
queues/flushes it and [`notes-outbox-flush.ts`](../src/lib/offline/notes-outbox-flush.ts)
drains the outbox against `PUT /notes/items/{id}`.

### Contract nuance: the metadata PUT must OMIT the `body` key

`PUT /notes/items/{id}` treats `body` as **optional**, but because Laravel's
`ConvertEmptyStringsToNull` middleware normalizes `""`/`null` to a _present_
value, the API only **preserves** the on-disk body when the `body` key is
**absent entirely**. A request with `body: ""` or `body: null` is treated as
"clear the body" and would wipe text written through the collab path.

Therefore the metadata builders deliberately construct the request object
**without a `body` property** (not `body: undefined`, which would still appear as
`null` after JSON round-trips for some shapes). This is enforced by tests in
[`notes.test.ts`](../src/lib/api/wgw/notes.ts) and
[`notes-outbox-flush.test.ts`](../src/lib/offline/notes-outbox-flush.ts)
(`expect(request).not.toHaveProperty("body")`). The full-body request
([`wgwNoteUpsertFromNote`](../src/lib/api/wgw/notes.ts)) is used **only** for the
`POST /notes/items` create / 404-create fallback, where seeding an (empty) body
once is correct.

### State decision: metadata `updatedAt` is body-edit-invariant

The Notes API derives a note's `updatedAt` from VJOURNAL `LAST-MODIFIED` /
`DTSTAMP` (and optional content mtime). A body-only `PATCH /notes/items/{uid}`
updates `DESCRIPTION` and may refresh content mtime without treating the
metadata outbox `ifInState` as stale.

This closes a false-conflict seam: the offline metadata flush uses the note's
`updatedAt`-at-enqueue as its `ifInState` guard and raises a `stateMismatch`
when the server looks newer. Without the marker, the sequence _edit body
(bumps mtime) → later flush a queued metadata change with a now-stale
`ifInState`_ would falsely look "server newer" and pop a spurious
[`NotesConflictDialog`](../src/notes-core/src/notes-conflict-dialog.tsx). With
the marker, a `stateMismatch` only ever reflects a genuine frontmatter
divergence. (Consequence: body edits no longer re-sort the note list by
modified time; body freshness is surfaced by the collab pending-sync dot,
[`use-docs-collab-pending-sync.ts`](../src/text-editor-core/docs-collab/use-docs-collab-pending-sync.ts),
not by `updatedAt`.) Legacy notes that predate the marker fall back to file
mtime, and the first collab save freezes the marker at the pre-write mtime so
even they do not trip the guard.

### History

VJOURNAL + Dexie inbound **supersedes the body-offline portion of #225**
([Notes whole-entity offline](https://github.com/WeGotWorkspace/wegotworkspace/issues/225)),
which originally pushed body, title, tags, and starred through a single
debounced upsert + outbox + binary conflict dialog. #225 still correctly
describes the **metadata** Dexie domain; only body editing moved to the Docs
Yjs path. See the alignment epic [#234](https://github.com/WeGotWorkspace/wegotworkspace/issues/234),
the body collab stack [#230](https://github.com/WeGotWorkspace/wegotworkspace/issues/230),
the editor/mutation wiring [#237](https://github.com/WeGotWorkspace/wegotworkspace/issues/237),
and the metadata outbox + slim conflict handling [#238](https://github.com/WeGotWorkspace/wegotworkspace/issues/238).
Do **not** reopen #225 — it is correctly closed and superseded here.

## Domain contract adapters

`OfflineDomainStore` and `OfflineDomainOperations` in [`core/types.ts`](../src/lib/offline/core/types.ts) are **TypeScript contracts**, not runtime validators. Wire your domain with thin adapters that `satisfies` the contract so drift is caught at compile time:

```ts
export const notesOfflineDomainStore = {
  readBootstrap: readNotesBootstrapFromCache,
  writeBootstrap: writeNotesBootstrapToCache,
  upsertEntity: upsertNoteInCache,
  removeEntity: removeNoteFromCache,
  readSyncToken,
  writeSyncToken,
} satisfies OfflineDomainStore<NotesBootstrap, Note>;

export const notesHybridDomainOperations: OfflineDomainOperations<NotesAPIOperations> =
  createHybridNotesOperations;
```

Domain contract adapters: [`contacts/contacts-domain-contract.ts`](../src/lib/offline/contacts/contacts-domain-contract.ts), [`notes/notes-domain-contract.ts`](../src/lib/offline/notes/notes-domain-contract.ts). Domain-specific helpers (outbox coalescing wrappers, token scopes, etc.) stay on your `*-offline-store.ts` module.

## Steps to add offline to a new app

### 1. Register your Dexie tables + version

Create a schema module that registers your tables as a side effect at import time, **before** the database opens. First add your domain to `OFFLINE_DOMAIN_VERSION_RANGES`, then register only version numbers inside that block. Add new indexes later by appending a higher version with an `upgrade()` callback — never edit a shipped version in place.

References: [`contacts/contacts-schema.ts`](../src/lib/offline/contacts/contacts-schema.ts) (tables at `CONTACTS_OFFLINE_VERSION.tables`, additive `updatedAt` index at `CONTACTS_OFFLINE_VERSION.updatedAtIndex`), [`notes/notes-schema.ts`](../src/lib/offline/notes/notes-schema.ts).

```ts
import { registerOfflineDomainTables } from "@/lib/offline/core/offline-db";
// 1. Claim { notes: { min: 10, max: 19 } } in offline-version-allocation.ts first.

const NOTES_OFFLINE_VERSION = { tables: 10, updatedAtIndex: 11 } as const;

registerOfflineDomainTables({
  domain: "notes",
  versions: [
    { version: NOTES_OFFLINE_VERSION.tables, stores: { notes_notes: "id, notebookId" } },
    // Additive index later: bump the version and backfill in upgrade().
    {
      version: NOTES_OFFLINE_VERSION.updatedAtIndex,
      stores: { notes_notes: "id, notebookId, updatedAt" },
      upgrade: async (tx) => {
        await tx
          .table("notes_notes")
          .toCollection()
          .modify((row) => {
            row.updatedAt ??= Date.now();
          });
      },
    },
  ],
});
```

> The registry merges each version's `stores` delta onto the running schema and composes the cumulative Dexie versions, so you only declare what changes. Import this module from your store and any other module that touches the DB so registration always runs first.

### 2. Implement the domain store

Wrap the core DB with your read/write helpers — bootstrap read/write, entity upsert/remove, sync tokens — and reuse the generic outbox helpers for queued mutations. Model after [`contacts-offline-store.ts`](../src/lib/offline/contacts-offline-store.ts) or [`notes-offline-store.ts`](../src/lib/offline/notes-offline-store.ts). Export a contract adapter (step above) that `satisfies` `OfflineDomainStore<TBootstrap, TEntity>`.

### 3. Implement the outbox flush

Drain queued mutations against the live API, mark `stateMismatch` rows for the conflict channel, record transient failures via `markOutboxError`, and return the result. Model after [`contacts-outbox-flush.ts`](../src/lib/offline/contacts-outbox-flush.ts) or [`notes-outbox-flush.ts`](../src/lib/offline/notes-outbox-flush.ts).

### 4. Implement hybrid operations + the sync runner

Expose the operations the UI calls. When offline (or on a network error), queue to the outbox and update the cache optimistically; when online, hit the live API and `flush()` the per-account runner.

**Per-account sync runner.** Keep one module-level [`ConnectivitySyncRunnerRegistry`](../src/lib/offline/core/connectivity-sync-runner.ts) and call `getOrCreate(username, flushTask)` so concurrent reconnects or UI triggers never overlap flushes for the same account:

```ts
const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>();

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushNotesOutbox(username));
}
```

`ConnectivitySyncRunner` itself serializes a single flush; the registry holds one runner per username. Model after [`contacts-hybrid-operations.ts`](../src/lib/offline/contacts-hybrid-operations.ts) or [`notes-hybrid-operations.ts`](../src/lib/offline/notes-hybrid-operations.ts) and wire the factory through `OfflineDomainOperations<TOperations>` in your domain contract adapter.

**Cross-tab sync (Dexie domains).** After flush, reconnect, or conflict resolve, notify other tabs so they re-read the cache. Notes uses [`notifyNotesBootstrapUpdated`](../src/lib/offline/notes-bootstrap-sync.ts).

### 5. Wire the UI

- **Bootstrap:** call [`useHybridBootstrap`](../src/lib/offline/core/use-hybrid-bootstrap.ts) with `load` (live) + `readCache` (offline). See [`use-notes-api.ts`](../src/notes-core/src/use-notes-api.ts) and [`use-docs-api.ts`](../src/docs-core/src/use-docs-api.ts).
- **Reconnect flush:** use [`useOnReconnect`](../src/hooks/use-connectivity.ts) to flush and re-read the cache; bump a `syncRevision` counter so pending/failed hooks refresh (Notes and Docs pattern).
- **Sync toast:** show a "Changes synced" toast when reconnect flush completes via [`use-offline-sync-toast.ts`](../src/lib/offline/use-offline-sync-toast.ts) (`useOfflineSyncToast` / `useOfflinePendingToast`). Notes: [`notes-app.tsx`](../src/notes-core/src/notes-app.tsx); Docs collab pending: [`docs-app.tsx`](../src/docs-core/src/docs-app.tsx).
- **Conflicts:** create one `createSyncConflictChannel<string>()` instance; report from flush/save, set the listener from your screen, and resolve in a modal. Docs collab save failures after CRDT re-merge attempt use [`docs-sync-conflicts.ts`](../src/lib/offline/docs/docs-sync-conflicts.ts) and [`docs-conflict-dialog.tsx`](../src/text-editor-core/docs-collab/docs-conflict-dialog.tsx) (Keep mine / Use server).
- **Pending badge:** poll your "pending" selector and render a dot. Docs home shows amber badges on drive rows only while body auto-sync or collab/outbox flush is pending — not a green "available offline" dot when synced (`drive-browser` optional props).
- **Retry callout:** Docs collab wires [`useDocsCollabFailedSync`](../src/text-editor-core/docs-collab/use-docs-collab-failed-sync.ts) in [`docs-collab-workspace.tsx`](../src/text-editor-core/docs-collab/docs-collab-workspace.tsx) with `saveNow` retry.
- **Body auto-sync:** Docs runs progressive home-list hydration (`docs-body-sync.ts`) and uses Dexie `docs_availability` (v21) as the auto-sync index.

### 6. Mount nothing extra for the shell indicator

The shell already renders [`OfflineStatusIndicator`](../src/lib/offline/core/offline-status-indicator.tsx). It reads `useConnectivity()` and shows automatically when offline — no per-app wiring needed.

## Outbox coalescing

When the user edits the same entity several times while offline, queue **one** outbox row instead of many. The core helper [`enqueueCoalescedOutboxUpdate`](../src/lib/offline/core/outbox-coalescing.ts) finds an existing pending `update` row for the same domain + entity, merges patches via your `mergePatches` callback, and preserves the original `ifInState`. If no row exists, it enqueues a new mutation.

Wrap it in a domain-specific function on your offline store. Contacts example — [`enqueueCoalescedContactUpdate`](../src/lib/offline/contacts-offline-store.ts) passes `coalesceContactPatches` as `mergePatches` and domain payload builders.

## Patch merge (optimistic cache vs outbox)

Domains with partial updates need **two** merge functions:

1. **`apply*Patch`** — merge a patch into the cached entity for the optimistic UI. `null` in sparse maps means "delete this key" (resolved view).
2. **`coalesce*Patches`** — merge two pending patches for the outbox. `null` entries are **kept** so the flush payload still tells the server to delete the id.

Contacts implements this pattern in [`contacts/contacts-patch-merge.ts`](../src/lib/offline/contacts/contacts-patch-merge.ts): `applyContactPatch` for cache updates, `coalesceContactPatches` for `enqueueCoalescedOutboxUpdate`. Notes follows the same shape for note fields.

## Testing multi-domain isolation

Core tests prove that contacts, notes, and docs share one Dexie database without table or outbox collisions:

- **Notes fixture:** [`__tests__/fixtures/notes-offline-fixture.ts`](../src/lib/offline/__tests__/fixtures/notes-offline-fixture.ts) — re-exports the production [`notes/notes-schema.ts`](../src/lib/offline/notes/notes-schema.ts) types and version constants (no duplicate registration).
- **Multi-domain test:** [`core/__tests__/offline-db-multi-domain.test.ts`](../src/lib/offline/core/__tests__/offline-db-multi-domain.test.ts) — opens a DB with core + contacts + notes tables and asserts isolated writes and composed upgrades.

Import fixtures and production schema modules only from tests — not from app runtime.

## Account session

Persist the username per domain so the cache can be found while offline:

```ts
import {
  rememberOfflineUsername,
  resolveOfflineUsername,
} from "@/lib/offline/core/offline-account";

rememberOfflineUsername("notes", username);
const username = resolveOfflineUsername("notes", session?.user.username);
```

Contacts keeps a thin wrapper ([`offline-session.ts`](../src/lib/offline/offline-session.ts)) for back-compat; new apps can call the core helpers directly.

## Definition of "ready to ship"

A new offline app is ready when it:

1. Claims a block in `OFFLINE_DOMAIN_VERSION_RANGES` and registers tables via `registerOfflineDomainTables` (enforced at registration — out-of-range or duplicate versions throw).
2. Implements store / flush / hybrid operations following the closest reference domain (Contacts for patch-merge entities, Notes for entity-list bootstrap, Docs for file-path content).
3. Uses `satisfies OfflineDomainStore` / `OfflineDomainOperations` adapters for compile-time contract checks (not runtime-enforced).
4. Reuses core connectivity, hybrid bootstrap, `ConnectivitySyncRunnerRegistry`, outbox coalescing, the conflict channel, and the shell offline indicator — with **no cross-domain coupling**.

**Examples:** Notes (app #2) ships with bootstrap sync, reconnect UX, hook tests, and live e2e. Docs (app #3) ships editable text offline via Yjs + y-indexeddb with reconnect flush and pending-sync indicators in the collab workspace.

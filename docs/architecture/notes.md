# Notes module architecture

Canonical reference for engineers (human and AI) working on the WeGotWorkspace Notes product surface, REST API, and CalDAV VJOURNAL store.

**Tracker:** [Goal #661](https://github.com/WeGotWorkspace/wegotworkspace/issues/661) · **Epic:** [#662](https://github.com/WeGotWorkspace/wegotworkspace/issues/662) · **Product Goals:** [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1)

**Delivery Tasks:** isolation [#663](https://github.com/WeGotWorkspace/wegotworkspace/issues/663) · REST [#664](https://github.com/WeGotWorkspace/wegotworkspace/issues/664) · ACL [#665](https://github.com/WeGotWorkspace/wegotworkspace/issues/665) · collection-sidebar [#666](https://github.com/WeGotWorkspace/wegotworkspace/issues/666) · apps/collab [#667](https://github.com/WeGotWorkspace/wegotworkspace/issues/667) · migration [#668](https://github.com/WeGotWorkspace/wegotworkspace/issues/668) · teardown [#669](https://github.com/WeGotWorkspace/wegotworkspace/issues/669)

This replaces YAML-frontmatter `.md` files, FileNode `note` projection, `PUT /files/collaboration` for `.notes` paths, and per-note Drive grants.

---

## Introduction

WeGotWorkspace assigns each datatype the most suitable **open protocol**, not one uniform format across the suite.

| Domain | Sync protocol | On-disk / wire format | REST shape |
|--------|---------------|----------------------|------------|
| Calendar | CalDAV | VEVENT (RFC 5545) | JMAP-shaped `Calendar` / `CalendarEvent` |
| Tasks | CalDAV | VTODO (RFC 5545) | JMAP-shaped `TaskList` / `Task` |
| Contacts | CardDAV | vCard | JMAP-shaped JSContact |
| **Notes** | **CalDAV** | **VJOURNAL (RFC 5545)** | JMAP-shaped `Notebook` / `Note` (`id` = `UID`) |

**Product:** Notes stay a **document** app (TipTap, All / Starred / Archive, tags). Notebooks are **collections** — same chrome as Calendar calendars and Tasks lists. Notes **leave Drive**.

Persistence reuses the existing Sabre CalDAV PDO backend (`calendars`, `calendarinstances`, `calendarobjects`, `calendarchanges`) — no separate Notes storage tier, no Yjs in the ICS.

---

## Decision 1 — Sync protocol: CalDAV VJOURNAL

**Decision:** Notes sync via **CalDAV VJOURNAL**, not WebDAV/Markdown files.

**Why:** Same Sabre server as Calendar and Tasks. VJOURNAL is the RFC document component (`SUMMARY` = title, `DESCRIPTION` = markdown, `CATEGORIES` = tags). No HTML, no `X-` prop, no Yjs in the ICS.

**Sabre / REST implication:**

- Notebooks = CalDAV calendar collections whose `supported-calendar-component-set` is **VJOURNAL only** (not `VEVENT`, not `VTODO`).
- Note items = `calendarobjects` rows containing a single VJOURNAL.
- Web client uses JMAP-shaped REST; a foreign CalDAV `PUT` of a journal is accepted by Sabre but is **not** a v1 product (no journal-client UX).

---

## Decision 2 — Isolation: notebooks vs event calendars vs task lists

**Decision:** New event calendars are **`VEVENT` only**. Existing event and group calendars have `VJOURNAL` stripped. Notebooks are provisioned separately (`notes-general`, display name `General`) per user and per group principal.

**Why:** Mixing VJOURNAL into event calendars or task lists is a non-goal. Calendar REST stays `scopeSupportsVevent()` and must not list notebooks. `scopeVjournalOnly()` = has `VJOURNAL`, not `VEVENT`/`VTODO`.

**Installer / URIs:** `CalendarCollectionUris::NOTE_GENERAL` + `notes-{groupSlug}` / `group-` API ids. Group-principal VJOURNAL collections, not `groups/{slug}/.notes`.

---

## Decision 3 — Canonical id is `UID`

**Decision:** REST `noteId`, collab room key, stars table, and the migration map all use the VJOURNAL `UID`. Object uri (`.ics` filename) is CalDAV plumbing only.

**Why:** RFC identity is `UID`. A foreign `PUT` that uses another href but the same `UID` is the same note. A client that changes `UID` is a new object. WGW create may write `{uid}.ics` as a convenience; **lookup is never by filename**.

**Implication:**

- `GET/PATCH/DELETE /notes/items/{uid}` hits `calendarobjects.uid`. **Never** scan `calendardata`. Tasks still resolve by `uri`; Notes must not copy that.
- Routes: `/notes/$notebookId/$noteId` with `noteId` = `UID` (not object-uri-without-ics).
- **Do not** use object-uri as REST id.

---

## Decision 4 — UID uniqueness

**Decision:** Schema guarantee is **`UNIQUE (calendarid, uid)`**, not a non-unique index. Duplicate create / foreign `PUT` of a second href with the same UID → **409**.

**Why:** RFC 4791 §5.3.2.1 (no-uid-conflict) is not assumed for VJOURNAL. The unique key is the guarantee. Verify Sabre in a test, but do not rely on it alone.

**Implication:**

- Pre-index: detect existing duplicate `(calendarid, uid)` rows and **fail the migration with a report** (do not pick a winner silently).
- `MOVE` between notebooks is fine (same UID, new `calendarid`).
- Empty `uid` should not occur on notes (we always mint RFC UIDs).
- Optional `INDEX (note_uid)` on the stars table for the global starred list (lookup without `calendarid`) is a **scale note**, not a v1 blocker. `UNIQUE (calendarid, uid)` stays the identity key.

---

## Decision 5 — JMAP wire vs JMAP-shaped REST

**Decision:**

- **Vendor JMAP envelope** `urn:wgw:jmap:notes` on `POST /jmap` — `Notebook/get|changes|set` and `Note/get|changes|set`. Not IETF `urn:ietf:params:jmap:notes` (no such type).
- **JMAP-shaped REST DTOs remain** — `Notebook`, `Note` (`id` = `UID`, `title`, `body`, `categories`, `notebookId`, `status`, `etag`) for non-sync CRUD.
- **Dexie inbound:** the Notes app working set is Dexie. Inbound `Note/changes` → `Note/get` (account-wide fan-out) writes the cache; the UI does not remount from a full live GET.

**Why:** Calendar-shaped sync. CalDAV VJOURNAL stays the document of record. REST `/notes/*` is unchanged.

**Implication:** Converters under `app/Services/Notes/Conversion/`. Create always writes a single-VJOURNAL object. href may be `{uid}.ics`. Envelope handlers call `NoteRepository` / `NotebookRepository` only.

---

## Decision 6 — Concurrency: If-Match (not last-write-wins)

**Decision:** Every persist uses `If-Match` ([tasks optimistic concurrency](../../packages/api/docs/tasks/optimistic-concurrency.md)). 412 `precondition_failed` on stale etag.

**Why:** Required for two WGW writers (tabs, offline, second device). Not an investment in Thunderbird Journals.

**Reconnect / focus matrix** (also applies to **offline reconnect**, not only a live mesh vs another tab):

| Local | Server etag | Action |
|-------|-------------|--------|
| Clean | Unchanged | Continue |
| Clean | Changed | Silent reseed from `DESCRIPTION` |
| Dirty | Unchanged | `PATCH` with `If-Match` |
| Dirty | Changed | **Conflict dialog.** Never discard the dirty Y.Doc by reseeding first. Keep mine = `PUT`/`PATCH` with the *new* etag (overwrite). Use theirs = then reseed. |

IndexedDB may hold the session (`pendingServerSave` / local-dirty flag, same as Docs). **Never silent-reseed a dirty Y.Doc.** No server Yjs cache in v1 — that does **not** mean “throw away IDB on etag mismatch.”

---

## Decision 7 — Collab is a session

**Decision:** Live collab stays TipTap + Yjs mesh while WGW clients are in the room. Room key = `UID` = REST `noteId`. Persist = `PATCH /notes/items/{uid}` + `If-Match`. No server Yjs sidecar. No path-keyed rooms.

**Why:** The document of record is VJOURNAL `DESCRIPTION`, not a `.yjs` file.

**Title UX:** Editable `SUMMARY` field. Auto-fill once from first heading or first non-empty line; user edit sticks. Title/tags/move = REST PATCH + `If-Match` **without** opening a room. PATCH must not clobber `DESCRIPTION` (read-modify-write ICS or field-level replace).

---

## Decision 8 — Mid-session ACL (v1 = Docs)

**Decision:** Join is authorized; the mesh is **not** re-checked after join. If the owner unshares the notebook or the note is moved to a notebook the user cannot access: their next `PATCH` is **403** (REST is the persist authority). They may still see/type in the RTC mesh until they disconnect — **same gap as Docs**.

**Notes-only, cheap:** on persist **403**, the client **leaves the room**, stops sending updates, and **shows a visible message** that they no longer have access and unsaved edits were not stored. Editor goes read-only or closes the note so it does not look like typing still saves. Does not evict them from other peers’ meshes until they drop; does not roll back Yjs they already injected.

**Parked:** server-side kick / room re-auth on `shareWith` change (platform collab, not this rewrite).

---

## Decision 9 — Share unit is the notebook

**Decision:** Notebook collection ACL only (`CalendarShareInvites` / same extract as Calendar and Tasks). Per-note Drive grants are a **breaking removal**, not a quiet non-goal.

**Why:** Calendars and task lists already share this way. Notes must not invent object-level ACL.

**Implication:**

- Share a notebook = `CollectionShareSection` + `searchCollectionSharePrincipals`. Not Drive `ShareDialog` on a file.
- Group-principal notebooks inherit membership.
- Inviting unknown emails / guest principals is **post-v1**. Email of an existing principal already works once `shareWith` lands (`share_href` as `mailto:`). True external (no account yet) needs the Drive guest-invite pattern later.

**Breaking:** A Drive grant on `…/.notes/{notebook}/{id}.md` does not become a notebook share and is not recreated. After cutover the note is only visible via notebook ACL / group membership. Mark the teardown PR `feat(apps)!:` / `BREAKING CHANGE:` + changelog. Migration may emit a one-time owner notice (“these notes were shared individually”) but must not invent object-level ACL.

---

## Decision 10 — Leave Drive

**Decision:** No `.notes/` product path, no `.{id}.md.yjs`, no `/files/star` on notes, no `shared-with-me?includeNotes`. Notes leave Drive.

**Why:** The store is CalDAV. Dual-write with files / FileNode projection is a non-goal.

**Breaking:** WebDAV/Finder `.md` edit, `includeNotes` inbox, and path-keyed collab rooms go away. Same `!` + changelog on the teardown PR (or the same PR as sharing).

---

## Decision 11 — Stars

**Decision:** Table `(username, calendar_object_id, note_uid)` with **`calendar_object_id` FK → `calendarobjects.id` ON DELETE CASCADE**. Unique `(username, calendar_object_id)`. `note_uid` is denormalized for API/listing.

**Why:** Object delete and notebook delete (if it deletes `calendarobjects` rows) then **atomically** drop stars — no “list UIDs after the collection is gone.” App-level delete-before is only a fallback if some path bypasses SQL delete of objects. Starred list still inner-joins `calendarobjects`.

**Implication:**

- Routes are **not** `/files/star`.
- Stars are **not** dropped on cutover: they backfill through the path→UID map (opposite of FileNode’s “no star backfill”).
- Optional `INDEX (note_uid)` for the global starred list.

---

## Decision 12 — Notebook move = one helper, two side effects

**Decision:** In-place `UPDATE calendarobjects.calendarid` (same `id` / `uid` / star FK) **and** Sabre-equivalent changelog: `calendarchanges` **removed** on the source calendar, **added** on the dest, both `calendars.synctoken` bumped.

**Why:** A raw `UPDATE calendarid` without those rows is **forbidden** — `/changes` poll (reconnect) would miss the move (stale on source, invisible on dest until full resync).

**Implication:**

- REST `PATCH` notebook **must** call this helper (not Eloquent `save` on `calendarid` alone).
- CalDAV `MOVE`: if Sabre already does in-place + dual changelog, call/wrap that. If it delete+recreates, **replace that path** with the same helper (plugin or backend override). No second implementation.
- Tests: after move, `calendarobjects.id` unchanged; star row unchanged; `GET /notes/items/changes` on **source** lists the uid as destroyed/removed; on **dest** as created; both synctokens advanced.

---

## Decision 13 — Archive and search

**Decision:** Archive = same notebook, `STATUS:CANCELLED` (active = `FINAL` or omitted). Search indexes `SUMMARY` + `DESCRIPTION` on note write. **Archived notes stay in the index** (user can find them) unless product later wants them excluded.

**Why:** Cancelled is the RFC “this journal is no longer current” signal. Keeping archived notes findable matches “I archived it but I still search for it.”

**Implication:** Chunk 5 **bulk-reindexes** imported notes (do not wait for per-row write hooks only).

---

## Decision 14 — ICS size (capacity risk)

**Decision:** Enforce a **soft markdown limit** on `PATCH` (start from Docs collab `MAX_MARKDOWN_BYTES` = 2 MiB) and return **413** before Sabre/PDO fail.

**Why:** `DESCRIPTION` is RFC 5545 `TEXT`: `\n` / `\,` / `\\` escaping and 75-octet folding. Folded ICS is larger than the markdown file. Schema today: MySQL `calendarobjects.calendardata` **MEDIUMBLOB** (~16 MiB), SQLite `blob`. Drive files had no such cap.

**Implication:** Migrator: skip or truncate-and-log notes that would exceed the limit; **do not silently clip**.

---

## Decision 15 — Media (v1)

**Decision:** v1 has no `ATTACH` / upload UI. Markdown image syntax, if present, is just text in `DESCRIPTION` (HTTPS or otherwise).

**Import:** count `![` / markdown images during import and log the count (and note id). No rewrite, no ATTACH, do not skip the note. Links that pointed at Drive / `.notes` siblings may die because notes leave Drive — accepted, not a silent mystery.

---

## Decision 16 — Sidebar / collection UX

**Decision:** Reuse **`@/collection-sidebar`** — the same package Calendar and Tasks already use. Do **not** invent a third pattern. Do **not** copy Calendar *or* Tasks privately.

**Why:** Notebooks are the same kind of object as calendars and task lists (CalDAV collections with ACL).

**Implication:**

- Notes calls `partitionOwnedAndShared` + `CollectionSidebarRow` like Tasks. Thin calendar wrappers (`calendar-sidebar-order.ts`) stay calendar-only.
- Any missing shared API is a collection-sidebar gap (Task #666), not invented in Notes. **#666 verify (2026-08-28):** `@/collection-sidebar` already exposes `partitionOwnedAndShared`, `CollectionSidebarRow` (color / visibility / select / edit), and hidden-ids. Calendar and Tasks wrap drop targets at the workspace (same `sidebarDropZoneProps` pattern Notes already uses). Share lives in `CollectionShareSection`, not the row. No shared-API gap — Notes chunk 4 imports this module only.
- **Drop** the primary “Shared with me” item that listed **per-note** Drive grants. Shared **notebooks** live in the notebooks section (same as a shared calendar / task list).
- Color / display name / drag-to-move between notebooks = same affordances as list/calendar rows where they already exist; do not add Notes-only chrome for those.
- Keep Notes-only: All, Starred, Archive, Tags, title+excerpt list, editor.

**Forbidden:** a Notes-only owned/shared splitter or row component.

---

## Decision 17 — Foreign CalDAV / journal clients

**Decision:** Foreign CalDAV is not a v1 product. Sabre will accept a journal `PUT`; we do not design extra journal-client UX. `If-Match` + `UID` exist for **WGW multi-writer**.

**Implication:** Calendar ICS import keeps skipping `VJOURNAL`. v1 does **not** add journal-specific interop (SEQUENCE policy beyond “do not reset,” custom X-prop round-trip, extra conflict copy). A CalDAV `PUT` is the same as an unknown second writer: 412 / Keep mine.

---

## Property mapping (VJOURNAL ↔ REST Note)

| VJOURNAL (RFC 5545) | REST `Note` field | Notes |
|---------------------|-------------------|-------|
| `UID` | `id` | Canonical; never object-uri |
| `SUMMARY` | `title` | Auto-fill once from first heading/line |
| `DESCRIPTION` | `body` | Markdown; soft 2 MiB cap → 413 |
| `CATEGORIES` | `categories` | Tags |
| `STATUS` | `status` | `CANCELLED` = archived; active = `FINAL` or omitted |
| collection | `notebookId` | Exactly one notebook per note |
| object etag | `etag` | `If-Match` on writes |

Unknown / `X-*` properties are not a v1 product (no `icsProps` requirement for notes).

---

## CalDAV collection structure

```
/calendars/{username}/                      ← calendar-home-set
/calendars/{username}/{notebook-uri}/       ← Notebook (VJOURNAL-only)
/calendars/{username}/{notebook-uri}/{uid}.ics  ← VJOURNAL (href convenience)
```

- **Principal:** `principals/users/{username}`; group principals `notes-{groupSlug}`.
- **ACL:** `calendarinstances.access` (1=owner, 2=read, 3=read-write); CalDAV sharing plugin.
- **REST paths:** `/api/v1/notes/notebooks`, `/api/v1/notes/items`, `/api/v1/notes/items/{uid}`, `/changes`.
- **Default notebook:** `notes-general` (`General`) per user and per group principal.
- **Synctoken / changes:** Per-collection `calendarchanges` + `synctoken` — same as Calendar/Tasks. Moves must write dual changelog rows (Decision 12).

---

## Offline and collaboration

| | v1 Notes |
|---|----------|
| Primary artifact | Long-form **markdown body** (`DESCRIPTION`) + metadata (`SUMMARY`, `CATEGORIES`, notebook, archive) |
| Offline path | IDB Y.Doc session + etag outbox; dirty+stale → conflict dialog |
| Transport | Body persist: `PATCH /notes/items/{uid}` + `If-Match`; metadata same |
| Stars | Notes stars table (not Drive `/files/star`) |
| Collab | Yjs + RTC mesh; room = `UID`; no server sidecar |

See Decision 6 (reconnect matrix) and Decision 8 (mid-session ACL).

---

## Migration (one-way)

One Artisan/migrator pass that **builds `oldVirtualPath → newUid` first**, then:

- Each `.md` → VJOURNAL in a collection named after the folder; mint RFC `UID`; write `{uid}.ics`
- Body → `DESCRIPTION` **verbatim**; title → `SUMMARY`; tags → `CATEGORIES`; `.archive/` → `CANCELLED`
- Image syntax counted and logged; no rewrite
- Stars: `drive_starred_items` rows whose path is in the map → insert `(username, calendar_object_id, newUid)`. Paths not in the map = skip + log. Do not star by filename stem alone.
- Over-limit bodies: skip or fail that row + log; no silent clip
- Discard `.{id}.md.yjs`; drop per-note grants; optional owner notice
- Bulk search reindex of imported UIDs
- Duplicate `(calendarid, uid)` pre-check fails the migration with a report

Old tree stays **read-only one release**; no dual-write. Drain FileNode Dexie outbox before migrate (fail-closed).

---

## Known limitations / parked

- **IETF `urn:ietf:params:jmap:notes`** — no such type; vendor `urn:wgw:jmap:notes` is Decision 5.
- **Foreign journal clients** — Sabre accepts PUT; no product UX (Decision 17).
- **Guest email invite** — post-v1 (existing principal `mailto:` works once shareWith lands).
- **Server-side collab kick** — parked (platform).
- **ATTACH / upload** — not v1 (Decision 15).
- **Task comments as VJOURNALS** — parked.
- **Mid-session mesh after revoke** — Docs gap; client leaves on persist 403 (Decision 8).
- **ICS size** — 2 MiB markdown soft cap; folded ICS larger than the file (Decision 14).
- **Broken Drive image links after leave-Drive** — accepted (Decision 15).

---

## GitHub cross-reference

| Topic | Issue |
|-------|-------|
| Product Goal | [#661](https://github.com/WeGotWorkspace/wegotworkspace/issues/661) |
| Delivery Epic | [#662](https://github.com/WeGotWorkspace/wegotworkspace/issues/662) |
| Isolation + provisioner | [#663](https://github.com/WeGotWorkspace/wegotworkspace/issues/663) |
| REST + UID + stars + move | [#664](https://github.com/WeGotWorkspace/wegotworkspace/issues/664) |
| Notebook ACL | [#665](https://github.com/WeGotWorkspace/wegotworkspace/issues/665) |
| Collection-sidebar | [#666](https://github.com/WeGotWorkspace/wegotworkspace/issues/666) |
| Apps + collab | [#667](https://github.com/WeGotWorkspace/wegotworkspace/issues/667) |
| One-way migration | [#668](https://github.com/WeGotWorkspace/wegotworkspace/issues/668) |
| FileNode teardown | [#669](https://github.com/WeGotWorkspace/wegotworkspace/issues/669) |
| Former FileNode notes (superseded store) | [000-notes-filenode spec](../../.agents/specs/000-notes-filenode/spec.md) |

**Execution order:** 0 → 1 → 2 → 3; 3b after 0 and before 4 (may overlap 2/3); 4 after 2+3b; 5 after 2; 6 after 5.

# Notes as CalDAV VJOURNAL notebooks

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `notes_vjournal_rewrite_512fa340` (source of truth). Do not invent a third sidebar pattern, last-write-wins collab, or object-uri as REST id.

## Goal

Notes become CalDAV VJOURNAL objects in VJOURNAL-only notebooks, with Tasks-shaped REST, collection ACL, and If-Match. Live collab is an ephemeral Yjs session. Stars are a per-user table. Notes leave Drive.

## Non-goals

- IETF JMAP Notes wire (vendor `urn:wgw:jmap:notes` is #671); dual-write; ATTACH; mixing VJOURNAL into event/task collections
- Guest email invite; server-side collab kick; task-comment journals
- Third sidebar pattern; last-write-wins; object-uri REST id

## Affected packages

- packages/api | packages/apps | docs/architecture

## Dependencies

Order follows **chunk labels**, not a 1–8 list:

- **0** → **1** → **2** → **3**
- **3b** after **0**, can overlap **2**/**3**; **must finish before 4**
- **4** after **2** + **3b**
- **5** after **2**
- **6** after **5**
- **V** after merge

OpenAPI → implementation is sequential. Isolation migrator owns `calendars.components` with Calendar create — do not parallel that without a single owner.

## Chunks

### Chunk 0: Issues, architecture, spec

- **id:** `issues-arch-spec`
- **Skill:** document + issue-filing
- **Inputs:** Cursor plan; `docs/architecture/tasks.md`; issue-filing.md
- **Done when:** Goal #661 + Epic #662 + Tasks #663–#669 filed; `docs/architecture/notes.md` states every locked decision; Notes row in `tasks.md` updated; spec header hashes Epic body
- **Verify with:** `gh issue view` parents; `Source: #662 (body-hash: 14483cc6)`
- **Parallel with:** none

### Chunk 1: Isolation and notebook provisioner

- **id:** `isolation-provision`
- **Skill:** api
- **Inputs:** `UserCalendarCollectionsProvisioner`, `CalendarCollectionUris`, `Calendar::scopeVtodoOnly`, `DefaultMixedCalendarMigrator`
- **Done when:** feature tests prove event calendars have no `VJOURNAL`, notebooks are VJOURNAL-only, Calendar list unchanged
- **Verify with:** targeted API tests (not full done-gate)
- **Parallel with:** none

### Chunk 2: OpenAPI + Notes REST + converters + stars

- **id:** `rest-converters-stars`
- **Skill:** api
- **Inputs:** Tasks JMAP summary, `TaskRepository` / `Conversion/`, optimistic-concurrency.md
- **Done when:** OpenAPI + failing tests then green; GET by `calendarobjects.uid` when `uri` ≠ `{uid}.ics`; no `calendardata` scan; UNIQUE rejects second same-UID row; delete item/notebook leaves no star rows; move helper + dual changelog tested
- **Verify with:** targeted Notes feature tests
- **Parallel with:** none (owns OpenAPI)

### Chunk 3: Notebook ACL

- **id:** `notebook-acl`
- **Skill:** api
- **Inputs:** `CalendarCollectionAccess`, `CalendarShareInvites`, Tasks `shareWith`
- **Done when:** share/unshare tests match Tasks CalDAV sharing tests
- **Verify with:** targeted share PHPUnit
- **Parallel with:** chunk 2 only after notebooks exist (chunk 1); if chunk 2 landed `shareWith` in the contract, implement here without a second OpenAPI edit

### Chunk 3b: Shared collection-sidebar

- **id:** `collection-sidebar-shared`
- **Skill:** apps-ui / workspace
- **Inputs:** `packages/apps/src/collection-sidebar/`, Calendar + Tasks consumers
- **Done when:** Notes can implement chunk 4 with imports from `@/collection-sidebar` only (plus Notes labels). Calendar and Tasks still use that same module. If already enough: verify + one-liner in architecture doc
- **Verify with:** existing Calendar/Tasks Vitest + collection-sidebar tests
- **Parallel with:** none vs chunk 4 (must finish first). Can overlap chunk 2/3 (API)

### Chunk 4: Apps cutover + collab session

- **id:** `apps-collab`
- **Skill:** workspace + apps-ui
- **Inputs:** `notes-core`, `notes-filenode.ts`, `use-docs-collab-save.ts`, `note-collab-path.ts`
- **Done when:** mock Storybook + Vitest; live list/edit/star/archive; 412 and dirty-reconnect dialogs; persist 403 leaves the room **and** shows access-lost / not-saved; no path-keyed rooms; notebook sidebar/share matches Calendar/Tasks collection UX
- **Verify with:** focused Vitest + mock-tier stories
- **Parallel with:** none vs API; UI stories can start against mock once OpenAPI types exist

### Chunk 5: One-way file migration

- **id:** `migrate`
- **Skill:** api
- **Inputs:** `NoteMarkdownCodec`, `GroupNotesHomesProvisioner`, `NoteStoragePaths`
- **Done when:** fixture tree converts including a starred path (assert star row); group homes → group-principal notebooks
- **Verify with:** targeted migrator tests
- **Parallel with:** none (after chunk 2)

### Chunk 6: Teardown FileNode notes

- **id:** `filenode-teardown`
- **Skill:** api + workspace
- **Inputs:** FileNode `note` projection, `DocCollabDocumentService` note branch, storage-flysystem notes disk notes
- **Done when:** architecture tests / route inventory no longer describe FileNode notes; Docs collab unchanged for real Drive docs
- **Verify with:** targeted architecture + collab tests
- **Parallel with:** none (after chunk 5)

### Chunk V: Cross-chunk verify

- **id:** `verify`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged 1–6; Epic AC
- **Done when:** verify-issue against Epic AC; `run_api_done_gate` + `run_apps_done_gate` if feasible
- **Verify with:** done gates (bash fallback)
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature tests → implement
- [ ] Isolation: component-set tests
- [ ] Concurrency: 412; dirty-reconnect must not reseed
- [ ] Identity: GET by uid when uri differs; UNIQUE; 409
- [ ] Stars: FK cascade; no ghosts
- [ ] Move: in-place + dual changelog
- [ ] Sharing: notebook shareWith
- [ ] Apps: title auto-fill, archive, star, 412 + dirty-reconnect, persist 403
- [ ] Migration: `.md` + archive + path-keyed stars
- [ ] Size: 413 over markdown cap
- [ ] Search: write-path index + post-migrate bulk reindex; archived findable
- [ ] Docs app: `/files/collaboration` unchanged for Drive markdown

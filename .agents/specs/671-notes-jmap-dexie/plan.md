# Notes JMAP + Dexie

Derived from [spec.md](./spec.md). Chunks below shipped. This file is the delivered plan, not a P0-REST / P1-JMAP staging board.

## Goal

Dexie is the Notes working set. Live inbound is `POST /jmap` (`urn:wgw:jmap:notes` — `Notebook/*` + `Note/*`). REST `/notes/*` stays for CRUD. REST `/changes` is reconnect / manual refresh / mock-tier fallback only.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

All build chunks landed. Chunk V is review-prep (this cleanup + external review).

## Chunks

### Chunk A: Stop the rebase

- **id:** `chunk-a-stop-rebase`
- **Skill:** workspace
- **Inputs:** `notes-app.tsx` key={successVersion}; hybrid bootstrap applySuccess; merge helpers; title debounce
- **Done when:** no remount on live follow-up; Dexie pendingSync on metadata writes; merge keeps pending/newer local body/title
- **Verify with:** Vitest merge + use-notes-api
- **Parallel with:** chunk-d-jmap-envelope
- **Status:** done

### Chunk B: REST /changes inbound (fallback)

- **id:** `chunk-b-rest-inbound`
- **Skill:** workspace
- **Inputs:** calendars-jmap-inbound; use-notes-api poll; unused sync tokens
- **Done when:** ingest skip-pending; reconnect / refresh / mock-tier can still fan out `GET /notes/notebooks/changes` + per-notebook `GET /notes/items/changes`; no 10s full list
- **Verify with:** inbound + use-notes-api unit tests
- **Parallel with:** chunk-c-body-dexie
- **Status:** done — not the live poll path

### Chunk C: Body is the Dexie row

- **id:** `chunk-c-body-dexie`
- **Skill:** workspace
- **Inputs:** notes-body-sync, list-preview-enrich, collab persist migrate, pending-sync, notes-app shareOperations
- **Done when:** UID-keyed; no /files/collaboration hydrate; pending union; Drive share ops gone
- **Verify with:** body-sync + pending-sync tests
- **Parallel with:** chunk-b-rest-inbound
- **Status:** done

### Chunk D: Vendor JMAP envelope

- **id:** `chunk-d-jmap-envelope`
- **Skill:** api
- **Inputs:** NoteRepository, NotebookRepository, CalendarEvent method set
- **Done when:** `urn:wgw:jmap:notes`; Notebook/Note get|changes|set; account-wide Note/changes; feature tests
- **Verify with:** API feature tests + api done-gate
- **Parallel with:** chunk-a-stop-rebase
- **Status:** done

### Chunk E: Notes app speaks /jmap

- **id:** `chunk-e-app-jmap`
- **Skill:** workspace
- **Inputs:** B inbound; D methods
- **Done when:** live inbound uses POST /jmap (`JmapNotesAdapter`); docs match JMAP-back
- **Verify with:** adapter tests; offline e2e still valid
- **Parallel with:** none
- **Status:** done

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** code-review
- **Done when:** #671 AC mapped; apps + api done gates; spec/docs match JMAP-back
- **Parallel with:** none
- **Status:** in progress (review-prep cleanup)

## Test plan

- [x] API envelope methods test-first
- [x] REST /changes stays green (fallback)
- [x] Apps: inbound skip-pending, remount, merge, pending union, no Drive hydrate
- [ ] e2e notes-offline-sync: no title snap-back (live stack; not a done-gate)

## Doc updates

- packages/apps/docs/offline-platform.md
- docs/architecture/notes.md Decision 5
- packages/api/docs/calendars/jmap-envelope.md
- packages/api/docs/jmap-rest-parity-gaps.md
- packages/api/docs/files/jmap-filenode-design.md (clear stale “REST sunset / Notes chunk D”)

# Notes JMAP + Dexie

Derived from [spec.md](./spec.md).

## Goal

Dexie is the Notes working set. Inbound `/changes` replaces full-list rebase. Vendor `Note/*` + `Notebook/*` wrap the same VJOURNAL repositories.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

1. Chunk 0 (this folder + Task #671) before code
2. A (stop remount) before B is useful in the UI; D can start with A
3. B and C in parallel after A starts
4. E needs B + D
5. V last

## Chunks

### Chunk A: Stop the rebase

- **id:** `chunk-a-stop-rebase`
- **Skill:** workspace
- **Inputs:** `notes-app.tsx` key={successVersion}; hybrid bootstrap applySuccess; merge helpers; title debounce
- **Done when:** no remount on live follow-up; Dexie pendingSync on metadata writes; merge keeps pending/newer local body/title
- **Verify with:** Vitest merge + use-notes-api
- **Parallel with:** chunk-d-jmap-envelope

### Chunk B: REST /changes inbound

- **id:** `chunk-b-rest-inbound`
- **Skill:** workspace
- **Inputs:** calendars-jmap-inbound; use-notes-api 10s poll; unused sync tokens
- **Done when:** ingest skip-pending; poll notebooks/items changes; reconnect flush→changes→cache; no 10s full list
- **Verify with:** inbound + use-notes-api unit tests
- **Parallel with:** chunk-c-body-dexie

### Chunk C: Body is the Dexie row

- **id:** `chunk-c-body-dexie`
- **Skill:** workspace
- **Inputs:** notes-body-sync, list-preview-enrich, collab persist migrate, pending-sync, notes-app shareOperations
- **Done when:** UID-keyed; no /files/collaboration hydrate; pending union; Drive share ops gone
- **Verify with:** body-sync + pending-sync tests
- **Parallel with:** chunk-b-rest-inbound

### Chunk D: Vendor JMAP envelope

- **id:** `chunk-d-jmap-envelope`
- **Skill:** api
- **Inputs:** NoteRepository, NotebookRepository, CalendarEvent method set
- **Done when:** `urn:wgw:jmap:notes`; Notebook/Note get|changes|set; account-wide Note/changes; feature tests
- **Verify with:** API feature tests + api done-gate
- **Parallel with:** chunk-a-stop-rebase

### Chunk E: Notes app speaks /jmap

- **id:** `chunk-e-app-jmap`
- **Skill:** workspace
- **Inputs:** B inbound; D methods
- **Done when:** inbound uses POST /jmap; docs updated
- **Verify with:** adapter tests; offline e2e still valid
- **Parallel with:** none

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** code-review
- **Done when:** #671 AC mapped; apps + api done gates
- **Parallel with:** none

## Test plan

- [ ] API envelope methods test-first
- [ ] REST /changes stays green
- [ ] Apps: inbound skip-pending, remount, merge, pending union, no Drive hydrate
- [ ] e2e notes-offline-sync: no title snap-back

## Doc updates

- packages/apps/docs/offline-platform.md
- docs/architecture/notes.md Decision 5
- packages/api/docs/calendars/jmap-envelope.md
- packages/api/docs/jmap-rest-parity-gaps.md
- packages/api/docs/files/jmap-filenode-design.md (stale Notes chunk D)

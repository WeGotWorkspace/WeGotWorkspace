# Notes as FileNodes

Derived from [spec.md](./spec.md). Sequential delivery — one package per PR. Not one mega-branch.

## Goal

`.notes` gets FileNode identity. Notes UI talks FileNode + existing Docs collab. `/notes/*` REST sunsets after D. Stars become per-user Drive stars at D (no backfill). Files/shares migrate in place.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/api (A, B, G)
- packages/apps (D)

## Dependencies

A before B. D after B. G after D. V after G. No parallel delivery PRs.

**Branches:** each chunk from updated `main` after the previous PR merges.

- A: `feat/notes-filenode-index`
- B: `feat/notes-filenode-api` (later)
- D: `feat/notes-filenode-app` (later)
- G: `feat/notes-filenode-sunset` (later)

**PR hygiene:** one PR per chunk; separate Conventional Commits per sub-concern. D’s star cutover is `feat(apps)!:` / `BREAKING CHANGE:`. B stays additive (`/notes/*` starred unchanged).

## Chunks

### Chunk A: Index `.notes` as FileNodes

- **id:** `notes-filenode-index`
- **Skill:** api
- **Package:** packages/api
- **Inputs:** [`FileNodeIndexService`](../../../packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php), [`jmap-filenode-design.md`](../../../packages/api/docs/files/jmap-filenode-design.md) decision 4, existing `.Trash` tests
- **Done when:** personal + group `.notes` (incl. `.archive`) are live FileNodes; Drive children still omit `.notes`; reindex mints existing notes without changing files
- **Verify with:** PHPUnit FileNode feature tests + Drive listing still hides notes
- **Parallel with:** none

### Chunk B: Notes FileNode read + write + share listing

- **id:** `notes-filenode-api`
- **Skill:** api
- **Package:** packages/api
- **Inputs:** A, [`NoteMarkdownCodec`](../../../packages/api/app/Services/Notes/NoteMarkdownCodec.php), [`FileNodeMapper`](../../../packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php), [`NoteStoragePaths`](../../../packages/api/app/Storage/NoteStoragePaths.php), Drive `GET /files/shared-with-me` (today excludes `isNotePath`)
- **Done when:**
  - `FileNode/query` + `get` returns a `note` projection: codec = title/tags/excerpt; `notebook`/`archived` from `storage_key`; `starred` from `drive_starred_items` for the caller
  - non-note files have no `note` prop
  - FileNode/set covers create / title-tags / archive-restore / notebook mkdir-rename-delete; existing YAML `starred` is passed through
  - `NoteMarkdownCodec` starred parse/serialize unchanged
  - FileNode `note.starred` does not read YAML; no star backfill
  - `POST|DELETE /files/star` on a note path persists; `GET /files/starred` still omits `.notes`
  - `NotesPathShare` / note-path rights unchanged
  - path-keyed share listing can return note grants (OpenAPI updated in this PR if the HTTP path changed)
- **Commits:** (1) `note` projection (2) FileNode/set with YAML starred pass-through (3) share-listing invert/split + OpenAPI if needed
- **Verify with:** FileNode feature tests on a seeded `.notes` tree ([`JmapFileNodeNotesTest`](../../../packages/api/tests/Feature/Jmap/JmapFileNodeNotesTest.php)); star write on a note path + Drive starred list still empty of notes; share listing tests. Historical REST starred round-trip lived in `NotesItemsTest` / `NotesMetadataMutationTest` (deleted in G). FileNode/set YAML `starred` pass-through is superseded by G (codec no longer emits `starred:` — [`JmapFileNodeNotesSetTest`](../../../packages/api/tests/Feature/Jmap/JmapFileNodeNotesSetTest.php)).
- **Parallel with:** none

### Chunk D: Notes app FileNode client

- **id:** `notes-filenode-app`
- **Skill:** workspace
- **Package:** packages/apps
- **Inputs:** B, [`notes.ts`](../../../packages/apps/src/lib/api/wgw/notes.ts), `NotesAPIOperations`, `JmapFileNodesClient`, notes hybrid/outbox
- **Done when:** live bootstrap/ops use FileNode; star toggle uses Drive `setStar`; YAML stars no longer shown; Shared with me + group notebooks use B’s path-keyed listing (no `/notes/shared-*`); offline flush uses FileNode + Drive stars; Dexie still stores `Note`; `NotesAPIOperations` shape unchanged; collab URLs still from `noteCollabPath`; Storybook mocks unchanged; #381 AC via existing notes offline Vitest
- **Commits:** (1) `feat(apps)!:` FileNode bootstrap/CRUD + Drive stars (BREAKING) (2) Shared with me from path-keyed listing (3) offline flush + stars store
- **Verify with:** Vitest notes API mapper + notes-core + notes offline tests
- **Parallel with:** none

### Chunk G: Sunset `/notes/*`

- **id:** `notes-filenode-sunset`
- **Skill:** api
- **Package:** packages/api
- **Inputs:** D green, `routes/api.php` notes block, OpenAPI `/notes/*`, share-listing contract from B
- **Done when:** notes REST routes and schemas gone (or 410 + removed from OpenAPI); `NoteRepository` HTTP surface gone; codec + `NoteStoragePaths` stay as FileNode helpers; codec may stop parsing/emitting `starred`
- **OpenAPI check:** do not drop `/notes/shared-*` while the replacement is undocumented
- **Verify with:** `pnpm test:api-done-gate`, architecture tests, no apps imports of `/notes/`
- **Parallel with:** none

### Chunk V: Cross-chunk verify

- **id:** `notes-filenode-verify`
- **Skill:** testing
- **Done when:** verifier PASS / PASS_WITH_NITS; Drive + Notes + Docs smoke (hide `.notes`, list/edit/share/offline note)
- **Parallel with:** none

## Test plan

- [ ] API A: FileNode index + Drive still hides `.notes` → `composer done-gate` / `pnpm test:api-done-gate`
- [ ] API B: `note` projection, writes, share listing, REST starred GET/PUT still green
- [ ] Apps D: mapper + notes-core + offline Vitest; Storybook mock-tier unchanged
- [ ] API G: no `/notes/*` in OpenAPI/routes; no apps `/notes/` imports
- [ ] Manual: reindex existing `.notes`; Drive My Drive hides `.notes`; Notes list/notebook/archive/shared/collab/offline

## Migration (existing installs)

Files and identity only — not stars.

1. Deploy A + `filenodes-reindex` (or lazy reconcile).
2. Deploy B — `/notes/*` including YAML `starred` still works.
3. Deploy D — star drop; changelog on this PR.
4. Deploy G — REST gone; codec starred cleanup allowed.
5. No file moves. No star backfill. Dead YAML `starred` may remain.

## Doc updates (when implementing)

- [`jmap-filenode-design.md`](../../../packages/api/docs/files/jmap-filenode-design.md) decision 4
- [`docs/architecture/tasks.md`](../../../docs/architecture/tasks.md) Notes row
- Changelog / release note on D

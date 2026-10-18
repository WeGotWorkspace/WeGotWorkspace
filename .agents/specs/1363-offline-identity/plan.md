# Offline storage keyed on document identity

Derived from [spec.md](./spec.md). Two sequential pull requests.

## Goal

Cache FileNode ids from the signed-in JMAP crawl, then key Docs local databases on that id without moving URLs or the room id off the path.

## Budget

Draws from the collab storage hardening milestone (the binary Docs wire, #1303). Displaces path-keyed Docs persistence and the local-path `migrateCollabPersistence` calls.

## Non-goals

- Signaling room id, `RoomIdCodec`, REST `nodeId`, Notes `:v2`, `noteCollabRoomKey`, a second key helper, #1366

## What exists

- REST directory entries have no id. `path: packages/api/openapi/schemas/drive/drive-directory-entry.json:8`
- JMAP listing maps a node and currently drops `node.id` except the field added in the cache pull request. `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:103`
- `/groups` is a JMAP top-level query, and user paths resolve through FileNode. `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:234`
- Guest offline sync is skipped. `path: packages/apps/src/drive-core/src/use-drive-api.ts:79`
- `docsCollabIndexedDbKey` appends `:v2` and is shared with Notes. Notes opens that name as its `:v2` database. `path: packages/apps/src/lib/offline/notes/notes-collab-rooms.ts:69` `path: packages/apps/src/lib/offline/notes/notes-collab-rooms.ts:81`

## Considered

Considered: keep crawling `/files/children` and attach ids in a second request — rejected because the signed-in app already lists through JMAP and the REST schema must not grow `nodeId`. Chosen: one JMAP listing for the crawl, optional `nodeId` on the client entry type.

## Affected packages

- packages/apps

## Dependencies

1. Cache pull request (chunk `offline-cache-node-id`) lands on `main` and is deployable alone.
2. Identity-key pull request (chunk `docs-identity-db-key`) stacks on that branch.

## Open decisions

None — versions, the guest gap, and the crawl roots are fixed by the task. The `docs_availability` primary-key change stops if an outside caller treats the path as that key; that is a stop rule, not an open choice.

## Invariants

- Guest REST entries have no `nodeId`. A wrong change would invent ids for a session that never caches offline. Proof: `path: packages/apps/src/lib/api/wgw/drive.test.ts` assertion `nodeId` undefined in `keeps guest tree I/O on REST children and content`.
- `drive_entries.id` stays the path. A wrong change would re-key the tree the inbound prune owns. Proof: `path: packages/apps/src/lib/offline/drive/drive-node-id-upgrade.test.ts` assertion `driveRow?.id` equals `users/ada/old.md`.
- After chunk `offline-cache-node-id`, Docs and Notes still open `:v2` path or UID databases without the next chunk. Proof: `cmd: git diff main -- packages/apps/src/text-editor-core/docs-collab/docs-collab-persistence.ts` is empty on that pull request.

## Chunks

### Chunk A: JMAP crawl and cache ids

- **id:** `offline-cache-node-id`
- **Skill:** workspace
- **Inputs:** JMAP listing already returns the id and `/groups` is a top-level query — `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:234`
- **Done when:** crawl and directory refresh use `listFileNodeEntries`; `readCachedDriveNodeId` returns `undefined` until a crawl; Dexie 33 and 22 add optional `nodeId`; guest entries omit it
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline/drive/drive-metadata-sync.test.ts src/lib/offline/drive/drive-node-id-upgrade.test.ts src/lib/api/wgw/drive.test.ts`
- **Parallel with:** none

### Chunk B: Docs identity database

- **id:** `docs-identity-db-key`
- **Skill:** workspace
- **Inputs:** cache reader from chunk A — `path: packages/apps/src/lib/offline/drive/drive-directory-offline-store.ts:66`
- **Done when:** Docs opens `nodeId` + `v3` before IndexedDB, migrates a path-keyed `:v2` once, falls back to the path key when the id is unknown, and the four local-path `migrateCollabPersistence` calls are gone. Notes stays on `:v2`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab/docs-collab-persistence.test.ts src/lib/offline/notes/notes-collab-rooms.test.ts`
- **Parallel with:** none

## Test plan

- [ ] Cache: crawl fills `nodeId`, rename keeps it, upgrade keeps rows without it, guest listing has no id
- [ ] Docs: remote rename and move land a pending save without `migrateCollabPersistence`; `:v2` is taken over once; unsynced unmergeable `:v2` stays; Notes name unchanged; unknown id stays editable on the path key
- [ ] `pnpm test:apps-done-gate` before push

## Doc updates (only if user wants)

- None. The asymmetry (identity for local storage, path for URLs and the room id) is a comment on the key function.

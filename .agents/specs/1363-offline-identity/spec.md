Source: #1363 (body-hash: 2a8e20d4)
Goal: #381

# Offline storage keyed on document identity

Technical translation of task #1363. Local Docs state is filed under the document path today. The FileNode id (`fn-…`) already survives a server rename. This task stores that id in the offline cache, then keys the Docs y-indexeddb database and `docs_availability` on it. URLs and the signaling room id stay on the path.

## Goal

Give a signed-in device a durable path → `nodeId` cache, then open the Docs collab database and pin registry by that id so a remote rename or move does not orphan unsaved local work.

## Non-goals

- Signaling room id and `RoomIdCodec`
- Re-keying `drive_entries` (path remains the primary key)
- `nodeId` on REST listing schemas
- Notes `:v2` and `noteCollabRoomKey`
- A second key helper beside `docsCollabIndexedDbKey`
- Inbound reconciliation (#1366) and any dependency on N9 or #1320

## Affected packages

- packages/apps

## Technical constraints

- Two pull requests. The cache PR is deployable alone. The key PR stacks on it.
- Dexie `nodeId` on `drive_entries` is version 33 (drive block 30–39). Dexie `nodeId` on `docs_availability` is version 22 (docs block 20–29). A missing field is a normal row until the first crawl.
- The offline crawl uses the JMAP listing (`listFileNodeEntries`). Do not add `nodeId` to `/files/children`.
- Guests have no offline cache. Their REST listing leaves `nodeId` empty.
- Crawl roots stay the signed-in home and group directories. Share roots are not crawl roots.
- `docsCollabIndexedDbKey(room, version)` stays the only key helper. Docs passes `v3`. Notes stays on `v2`.
- `room` remains the key for sidecar etags, server failure, sync state, conflict reports, mesh linger, collab URLs, and the room id.

## Edge cases

- Unknown `nodeId` (no crawl yet, or a deeplink) opens the path-keyed `:v2` database and logs. If that fallback is the common open path, stop: the id must come from the collab read instead.
- A path-keyed `:v2` body moves into `:v3` once, including the rule that unsynced legacy work that cannot be merged stays where it is.
- Re-keying `docs_availability` stops if a caller outside the named mutation sites assumes the path is the primary key.

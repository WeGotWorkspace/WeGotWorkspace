Source: ad-hoc

Goal: #380

> **Superseded.** Notes left Drive. Store is CalDAV VJOURNAL; live inbound is vendor `urn:wgw:jmap:notes`. See [662-notes-vjournal](../662-notes-vjournal/spec.md) and [671-notes-jmap-dexie](../671-notes-jmap-dexie/spec.md). Keep this folder as historical FileNode design only.

# Notes as FileNodes

Technical translation of the Notes FileNode cutover. No GitHub Task/Epic yet — file those after the PRs, parented to Goal #380 (offline AC also #381; share policy #412 unchanged).

## Goal

Notes stay a collection UI (notebooks, tags, starred, archive, team-only share). The `.notes` tree on `wgw_files` gets FileNode identity. The Notes app talks FileNode + the existing Docs collab path. Dedicated `/notes/*` REST goes away. Existing installs migrate by reindex, not by rewriting files.

## Non-goals

- Merging the Notes and Docs apps
- Guest/public note links
- JMAP Notes collection type (`Note/get`) — FileNode is the object
- Exposing `.notes` in Drive browse
- Mail JMAP
- Changing on-disk layout (`{id}.md`, notebooks as dirs, `.archive/`)
- Star backfill from YAML into `drive_starred_items`

## Affected packages

- packages/api (chunks A, B, G)
- packages/apps (chunk D)
- docs (`jmap-filenode-design.md` decision 4; architecture Notes row; D changelog)

## Two data policies

- **Files, notebooks, `.archive`, group trees, shares:** real data. Reindex in place, keep storage keys, dual-run `/notes/*` until D.
- **Stars only:** no backfill. After D they are empty personal Drive stars. Field-level product break, not a “no users” claim.

## Breaking behavior

Note starring changes from a shared YAML flag (everyone who sees the markdown) to a per-user `drive_starred_items` row, same as Docs. Visible at **D**, not B. Mark D like the JMAP REST sunset PRs (`feat(apps)!:` / `BREAKING CHANGE:` + changelog). B must not break `/notes/*` starred for the old client.

## Technical constraints

- Tree writes: `FileNode/set`. Body: existing `PUT /files/collaboration` at `noteCollabPath`.
- `note` projection on FileNode get for `isNotePath` keys only:
  - title, tags, excerpt — `NoteMarkdownCodec` (body omitted)
  - notebook, archived — `storage_key` / `.notes/.archive/`
  - starred — `DriveStarredItem` join for the caller (not YAML)
- `NoteMarkdownCodec` starred parse/serialize **unchanged in B**. FileNode/set **passes through** existing YAML `starred`. Codec may drop starred only in G.
- `GET /files/starred` keeps hiding `.notes`. Star writes use `POST|DELETE /files/star`.
- Drive browse keeps hiding `.notes`. Index exception (like `.Trash`): index `.notes` and `.archive` only under `.notes`.
- Share: `NotesPathShare` / note-path rights unchanged. Path-keyed listing in B so D does not call `/notes/shared-*`.
- One package per delivery PR. Sequential: A → B → D → G → V.

## Edge cases

- FileNode/set title/tags rewrite during B→D must not strip YAML `starred` (old REST client still reads it).
- REST starred GET/PUT must stay green after B (`NotesItemsTest`, `NotesMetadataMutationTest`, plus pass-through case if needed).
- Group vs personal `.notes` roots; archived path `…/.notes/.archive/{notebook}/{id}.md`.
- Other dots (`.yjs`, `._*`) stay hidden from the FileNode index.

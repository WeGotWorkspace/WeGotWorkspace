Source: ad-hoc

# Drop authenticated files dual-REST writes

Technical translation of Chunk E (jmap-files-rest-gone): authenticated tree I/O moves to FileNode; guest share bootstrap and product islands stay on REST.

## Goal

Remove the dual-protocol write surface for owned drive trees (`POST /files/directories`, `PATCH /files`, `DELETE /files`, `POST /files/content`) after lifting those Feature asserts onto FileNode. Keep DriveService, GET search/children/content, collaboration, shares, star, and context.

## Non-goals

- FileNode shared-with-me / share-member writes
- Apps cutover (Chunk D)
- Deleting DriveService, WebDAV, or guest GET/HEAD content

## Affected packages

- packages/api

## Technical constraints

- `files/content` is one Laravel `Route::match`; rewrite to `GET`/`HEAD` only (do not delete POST as a sibling).
- OpenAPI `/files/content`: remove `post` only; keep `get`.
- After rewrite, `POST /files/content` must 405.
- Shared-file protocol: do not touch calendars/contacts route regions or remaining files islands.

## Edge cases

- Guest share GET children + GET/HEAD content stay.
- Share-member writes lose the REST path; FileNode visible set still excludes shared-with-me.
- Search index sync stays on DriveService (FileNode/set does not index `search_documents`).

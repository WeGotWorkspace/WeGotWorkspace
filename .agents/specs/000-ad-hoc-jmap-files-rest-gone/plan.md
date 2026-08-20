# Drop authenticated files dual-REST writes

Derived from [spec.md](./spec.md).

## Goal

Lift authenticated create/rename/move/delete/download/ACL REST asserts onto FileNode, then delete dual-REST write routes and rewrite `files/content` to GET/HEAD.

## Non-goals

- Chunk D apps cutover
- FileNode shared-with-me

## Affected packages

- packages/api

## Dependencies

- Merge only after D (`jmap-filenode-app`) is on main.

## Chunks

### Chunk E: files dual-REST deletion

- **id:** `jmap-files-rest-gone`
- **Skill:** api, testing
- **Inputs:** FilesEndpointsTest, FilesAccessControlTest, FilesTrashTest, FilesCrossDriveMoveTest, existing FileNode tests
- **Done when:** write routes gone; POST content 405; share/collab/star/guest content green; FileNode covers former authenticated I/O; `pnpm test:api-done-gate`
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** A, B, C, D (development). Merge after D.

## Test plan

- [ ] Lift FileNode ACL / I/O twins
- [ ] Split FilesEndpointsTest / FilesAccessControlTest
- [ ] Rewrite `files/content` match; drop write OpenAPI ops
- [ ] `pnpm --filter @wgw/api typegen`
- [ ] `pnpm test:api-done-gate`

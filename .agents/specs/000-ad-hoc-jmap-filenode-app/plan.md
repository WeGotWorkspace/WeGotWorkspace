# Drive FileNode client

Derived from [spec.md](./spec.md).

## Goal

Signed-in `createWgwDriveOperations` uses `JmapFileNodesClient` + a path↔nodeId cache. Guest/shares/collab/stars/context stay REST.

## Non-goals

- API route deletion
- `FileNode/copy`

## Affected packages

- packages/apps

## Dependencies

None (parallel with A–C, E). Merge gate for E is after this PR lands.

## Chunks

### Chunk D: Drive FileNode client

- **id:** `jmap-filenode-app`
- **Skill:** workspace
- **Inputs:** `packages/apps/src/lib/api/wgw/drive.ts`, calendar JMAP client precedent, `JmapFileNodesClientContractTest`
- **Done when:** signed-in drive ops do not call children/directories/patch/delete/content; guest + shares + collab unchanged; `pnpm test:apps-done-gate`
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** A, B, C, E

## Test plan

- [ ] Vitest: FileNodes client emits pinned methodCalls (`using` includes filenode)
- [ ] Vitest: path cache resolves via isTopLevel / parentId+name then get
- [ ] Vitest: signed-in ops stay off REST tree I/O; guest still uses children/content
- [ ] `pnpm test:apps-done-gate`

# Tasks — JMAP envelope: files (FileNode) (draft)

Engineering split per [plan.md](./plan.md). Rows become actionable when their Tasks are filed ([issue-draft.md](./issue-draft.md)). F0 delivers a document, not code.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-f0-filenode-design | planner | plan-feature, api | design doc (this folder or `packages/api/docs/files/`) | maintainer review of node-id index design | pending |
| chunk-f-filenode-envelope | builder | api | `app/Services/Jmap/Methods/FileNode*`, `app/Dav/Storage/*` (index maintenance), `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapFileNodeMethodsTest.php` | lifecycle contract test; rename/move id stability; WebDAV write visible in `/changes`; done gate | pending — after chunk-f0 + blobs chunk |

# Tasks — JMAP envelope: files (FileNode) (draft)

Engineering split per [plan.md](./plan.md). F0 delivers a document, not code; the build Task is filed after #439 lands ([issue-draft.md](./issue-draft.md)).

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-f0-filenode-design | planner | plan-feature, api | design doc (this folder or `packages/api/docs/files/`) | maintainer review of node-id index design | issue filed — #439 |
| chunk-f-filenode-envelope | builder | api | `app/Services/Jmap/Methods/FileNode*`, `app/Dav/Storage/*` (index maintenance), `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapFileNodeMethodsTest.php` | lifecycle contract test; rename/move id stability; WebDAV write visible in `/changes`; done gate | pending — after #439 + #438 |

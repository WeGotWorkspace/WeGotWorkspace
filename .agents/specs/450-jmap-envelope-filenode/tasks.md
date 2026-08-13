# Tasks — JMAP envelope: files (FileNode)

Engineering split per [plan.md](./plan.md). Delivery issue: #450 (design gate #439 merged — PR #447).

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-f0-filenode-design | planner | plan-feature, api | [`packages/api/docs/files/jmap-filenode-design.md`](../../../packages/api/docs/files/jmap-filenode-design.md) | maintainer review of node-id index design | done — #439 closed by PR #447 |
| chunk-f-filenode-envelope | builder | api | `app/Services/Jmap/Methods/FileNode*`, `app/Services/Jmap/FileNodes/*`, `app/Dav/*` (index plugin), `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapFileNodeMethodsTest.php` | lifecycle contract test; rename/move id stability; WebDAV write visible in `/changes`; done gate | issue filed — #450 |

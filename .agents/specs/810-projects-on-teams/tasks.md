# Engineering tasks — Projects on Teams

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `team-admin-role` | builder | api, security | `packages/api/database/migrations/wgw/`, `app/Services/Teams/TeamRoles.php` (new), `app/Http/Controllers/Api/V1/Teams/` (new), `app/Services/Settings/GroupDirectoryService.php`, `app/Services/Settings/SettingsStateService.php`, `app/Services/Calendars/CalendarCollectionAccess.php` and the four collection repositories, `openapi/openapi.json`, `tests/Feature/Teams/` | `composer --working-dir packages/api done-gate` |
| `team-admin-ui` | builder | apps-ui, storybook, accessibility | `packages/apps/src/settings-core/src/settings-memberships-pane.tsx`, `admin-core/src/`, `lib/api/wgw/` (teams client and mock) | `pnpm test:apps-done-gate` |
| `project-model-create` | builder | api, security | `packages/api/database/migrations/wgw/`, `app/Models/Project.php`, `app/Models/ProjectResource.php`, `app/Services/Projects/` (new), `app/Http/Controllers/Api/V1/Projects/`, `openapi/openapi.json`, `app/Services/Jmap/Push/JmapPushStateResolver.php`, `tests/Feature/Projects/` | `composer --working-dir packages/api done-gate` |
| `default-project-backfill` | builder | api | `app/Services/Projects/DefaultProjectProvisioner.php` (new), `app/Services/Admin/AdminGroupManagementService.php`, `database/migrations/wgw/`, `app/Services/Installer/DevInstallBootstrap.php` | `composer --working-dir packages/api done-gate` |
| `project-drive-folder` | builder | api, security | `app/Services/Projects/ProjectFolder.php` (new), `app/Services/Drive/DriveService.php`, `app/Services/Jmap/FileNodes/FileNodeSetService.php`, `app/Dav/Server/WebdavWriteGuardPlugin.php` | `composer --working-dir packages/api done-gate` |
| `project-collection-guards` | builder | api, security | `app/Services/Projects/ProjectRegistry.php` (new), `app/Services/Calendars/CalendarRepository.php`, `app/Services/Tasks/TaskListRepository.php`, `app/Services/Notes/NotebookRepository.php`, `app/Services/Chat/ChatChannelRepository.php`, `app/Dav/Server/` (PROPPATCH guard), `openapi/openapi.json` | `composer --working-dir packages/api done-gate` |
| `dav-personal-create` | builder | api, security | `packages/api/routes/web.php`, `app/Dav/Server/WgwCalendarBackend.php`, `app/Dav/Server/AppCalendarHome.php`, `tests/Feature/Dav/MkcalendarHttpTest.php` | `composer --working-dir packages/api done-gate` |
| `project-archive-purge` | builder | api, security | `app/Services/Projects/`, `app/Services/Calendars/CalendarCollectionAccess.php`, `app/Dav/Server/WgwCalendarBackend.php`, `app/Storage/StorageKeyClass.php`, `app/Storage/StoragePaths.php`, `app/Services/Drive/DriveSharePathScope.php` | `composer --working-dir packages/api done-gate` |
| `team-delete-guard` | builder | api | `app/Services/Admin/AdminGroupManagementService.php`, `tests/Feature/Projects/TeamDeleteWithProjectsTest.php` | `composer --working-dir packages/api done-gate` |
| `acl-cycle-walk` | builder | testing, security | `packages/api/tests/Feature/Projects/Cycle/` | `composer --working-dir packages/api done-gate` |
| `project-client-store` | builder | client-transport, workspace | `packages/apps/src/lib/api/wgw/projects.ts`, `lib/api/mock/projects.ts`, `lib/api/contract/`, `lib/projects/` (new), `lib/offline/projects/` (new) | `pnpm --dir packages/apps exec vitest run src/lib/projects src/lib/api` |
| `project-filter-ui` | builder | apps-ui, storybook, accessibility | `packages/apps/src/projects-ui/` (new), `ui/select.tsx`, `workspace-shell/src/workspace-app-layout.tsx`, `app-sidebar/src/` | `pnpm test:apps-done-gate` |
| `project-filter-apps` | builder | workspace, apps-ui | `calendar-core/`, `tasks-core/`, `notes-core/`, `meet-core/`, `drive-core/`, `docs-core/`, `contacts-core/`, e2e specs | `pnpm test:apps-done-gate` |
| `project-manage-settings` | builder | apps-ui, storybook | `settings-core/src/` (Projects panel), `projects-ui/` | `pnpm test:apps-done-gate` |
| `projects-verify` | verifier | testing | read-only | done-checklist + own browser e2e |

## Issues

R1, R2 #2278 · A1, A2, A3 #817 · B1, B2, B3, B4, B5 #819 · C1, C2, C3, C4 #818 · Epic #810

## Notes

- Order: `team-admin-role` first, then `project-model-create`. Then `default-project-backfill`, `project-drive-folder`, `project-collection-guards` and `project-client-store` in parallel. Then `project-archive-purge` and `team-delete-guard`. `dav-personal-create` can run any time after `project-model-create`. UI chunks follow `project-client-store`; `project-filter-apps` also needs `project-collection-guards`.
- `team-admin-ui`, `project-filter-ui`, `project-filter-apps` and `project-manage-settings` are visible UI: they wait for the product owner's review before merge. Every other chunk merges after review, green CI and its own e2e.
- Two chunks touch `openapi/openapi.json` at the same time (`project-collection-guards` and `project-archive-purge` after `project-model-create`): the later one rebases and re-runs typegen.
- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.

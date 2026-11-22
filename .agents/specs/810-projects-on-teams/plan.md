# Projects on Teams

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `c47b45070`. API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

## Goal

A Project is a row plus a registry of five things under one Team: calendar, task list, notebook, chat channel, Drive folder. The server creates them together, guards them, hides them on archive and removes them on purge. The apps get one sidebar filter that narrows every app to the selected Project. Each Team's existing calendar, task list and notebook become its default Project.

## Budget

- **Draws from:** Goal WeGotWorkspace/Product#114, which was parked until Teams visibility (#1915, closed 2026-11-10) had landed.
- **Displaces:** the remaining Tasks-extensions UI review and tech-debt sessions share the same reviewer, so at most two Projects chunks build at a time. Joining a Project (availability, #1907 follow-up) waits for this Epic.

## Non-goals

See spec.md, Non-goals.

## What exists

**Nothing of Projects is on main**

- No `projects` table, route, or client module exists: the route file has no `projects` route, and the client API folder has no `projects.ts`. `path: routes/api.php:1`, `path: lib/api/wgw/http.ts:1`
- No spec folder for #817, #818 or #819 exists, although a comment on #810 names them; the specs index lists none. `path: .agents/specs/README.md:1`
- The old local branch `feat/projects` is based on main of 2026-09-20 and treats a Project as a group principal. `path: .agents/specs/1915-teams-visibility/plan.md:106`

**Teams**

- Team create has no transaction and provisions, in order: Drive directory, principal, calendar/task list/notebook, default channel, address book. `path: app/Services/Admin/AdminGroupManagementService.php:38`
- Team delete removes address-book shares and every DAV collection of the principal, then members, principal and Drive grants in one `wgw` transaction, then the files directory. `path: app/Services/Admin/AdminGroupManagementService.php:89`
- A Team rename does not rename the Team's calendar, task list or notebook. `path: app/Services/Admin/AdminGroupManagementService.php:70`
- The admin role is the column `users.is_admin`, read by one resolver. `path: app/Services/Auth/AdminRoleResolver.php:18`
- Every Team and member write route sits behind `wgw.role:admin`. `path: routes/api.php:403`
- Member writes go through `GroupDirectoryService::replaceMembers` and `setMembership`, which use Sabre's group-member-set. `path: app/Services/Settings/GroupDirectoryService.php:97`, `path: app/Services/Settings/GroupDirectoryService.php:110`
- The colleague rule and its surfaces are one table in `TeamColleagues`; availability and free/busy use `sharesTeamIgnoringAdminRole`. `path: app/Services/Teams/TeamColleagues.php:22`, `path: app/Services/Teams/TeamColleagues.php:71`
- `settings/state` reports `isAdmin` and the caller's Teams. `path: app/Services/Settings/SettingsStateService.php:37`
- Settings shows the caller's Teams read-only; Admin labels the role "Admin". `path: settings-core/src/settings-memberships-pane.tsx:15`, `path: admin-core/src/admin-users-pane.tsx:86`
- "Is X a member of Team Y" is `TeamColleagues::isOwnTeam`; "which Teams" is `TeamMembershipReader::teamsOf`, memoised per request. `path: app/Services/Teams/TeamColleagues.php:90`, `path: app/Services/Teams/TeamMembershipReader.php:28`

**Team collections**

- `ensureForGroupPrincipals` creates the calendar `{slug}`, task list `tasks-{slug}` and notebook `notes-{slug}`, all named after the Team. `path: app/Services/Calendars/UserCalendarCollectionsProvisioner.php:159`
- The kind of a collection is `calendar_collection_meta.kind`, never its uri. `path: app/Services/Calendars/CollectionKind.php:16`
- "The Team's provisioned collection" is a uri comparison in each repository, and delete of it is already 403. `path: app/Services/Calendars/CalendarRepository.php:389`, `path: app/Services/Tasks/TaskListRepository.php:288`, `path: app/Services/Notes/NotebookRepository.php:348`
- A member can create extra Team calendars, task lists, notebooks and channels by passing `groupSlug`. `path: app/Services/Calendars/CalendarRepository.php:79`, `path: app/Services/Tasks/TaskListRepository.php:81`, `path: app/Services/Notes/NotebookRepository.php:82`, `path: app/Services/Chat/ChatChannelRepository.php:96`
- Uris do not change on rename or owner transfer; sharee instances have their own uris, so the cross-instance identity is `calendars.id`. `path: app/Services/Calendars/CalendarRepository.php:395`
- Only an organization admin may delete or transfer a Team-owned collection. `path: app/Services/Calendars/CalendarCollectionAccess.php:178`
- `accessibleInstancesByKind` is the one read path behind the calendar, notebook, task-list and chat lists, their changes and the push state. `path: app/Services/Calendars/CalendarCollectionAccess.php:56`
- Availability reads Team calendars through its own query, not through that path. `path: app/Services/Calendars/CalendarCollectionAccess.php:364`
- DAV lists collections through the backend. `path: app/Dav/Server/WgwCalendarBackend.php:303`

**Chat**

- A channel is a VJOURNAL collection plus a `chat_channel_meta` row; the Team channel is marked by the unique column `default_for_group`. `path: database/migrations/wgw/2026_09_05_000370_wgw_chat_channel_meta_default_for_group.php:22`
- The Team channel is created inside a `wgw` transaction that calls the Sabre backend, and a lost unique race is treated as found. `path: app/Services/Chat/ChatGroupDefaultChannelProvisioner.php:120`
- A channel id is its collection uri, allocated once and never changed by a rename. `path: app/Services/Chat/ChatChannelIdAllocator.php:53`
- The Team channel cannot be renamed or deleted. `path: app/Services/Chat/ChatChannelRepository.php:668`

**DAV guard**

- The HTTP front's method list has `MKCOL` but not `MKCALENDAR`, so that request never reaches Sabre. `path: routes/web.php:25`
- The backend already handles `MKCALENDAR`: it derives the kind from the component set and refuses reserved uri prefixes. `path: app/Dav/Server/WgwCalendarBackend.php:372`

- `WebdavWriteGuardPlugin` refuses DELETE, MOVE and COPY of calendar collections for everyone. PROPPATCH is not blocked. `path: app/Dav/Server/WebdavWriteGuardPlugin.php:95`

**Drive**

- `GroupFilesHomeProvisioner::ensureForSlug` only creates the directory. `path: app/Services/Drive/GroupFilesHomeProvisioner.php:18`
- `jmap_file_nodes.node_id` is minted once and kept through rename and move. `path: app/Services/Jmap/FileNodes/FileNodeIndexService.php:791`, `path: app/Services/Jmap/FileNodes/FileNodeIndexService.php:400`
- A path segment that starts with a dot and is not `.Trash`, `.notes` or the attachments directory classifies the whole key as `Hidden`, which is kept out of both the file index and the search index. `path: app/Storage/StorageKeyClass.php:56`, `path: app/Storage/StorageKeyClass.php:84`
- Trash keys stay in the file index and leave the search index. `path: app/Storage/StorageKeyClass.php:90`
- Grants are scoped away from product trash by one path predicate. `path: app/Services/Drive/DriveSharePathScope.php:35`
- A Team `.Trash` is recognised as a path but nothing creates or uses it; the client's trash is per user. `path: app/Storage/StoragePaths.php:47`, `path: lib/files/drive-path-utils.ts:46`
- A REST rename runs the path bookkeeping for shares and the index. `path: app/Services/Drive/DriveService.php:212`

**Schema and contract**

- `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` is 90 and equals the number of migration files; each new migration bumps it. `path: app/Services/Installer/WgwSchemaMigrator.php:15`
- `WgwSchemaParityTest` asserts a fixed list of tables and columns. `path: tests/Architecture/WgwSchemaParityTest.php:15`
- A migration may call a service for a one-time backfill. `path: database/migrations/wgw/2026_07_08_000151_wgw_provision_group_task_lists.php:16`
- Routes and `openapi.json` are compared in both directions. `path: tests/Architecture/OpenApiRouteContractTest.php:1`

**Push**

- Push types are a fixed list, and each resolves its state per caller. `path: app/Services/Jmap/Push/JmapPushStateResolver.php:47`
- The smallest non-DAV type is `Notification`: one marker row per principal. `path: app/Services/Notify/NotificationInboxMarkers.php:25`, `path: app/Services/Jmap/Push/JmapPushStateResolver.php:221`

**Apps**

- Every product sidebar passes `WorkspaceSidebarAccountFooter` as the `AppSidebar` footer. `path: workspace-shell/src/workspace-app-layout.tsx:211`
- The footer is absolutely positioned and publishes its height as a CSS variable. `path: app-sidebar/src/app-sidebar.tsx:118`
- `SelectTrigger` always appends a chevron and has no `asChild`. `path: ui/select.tsx:44`
- The closest pattern for one value shared by all apps is the theme preference. `path: lib/theme-preference.ts:21`
- Calendar, task list, notebook and channel objects carry `scope` and `groupSlug` on the client. `path: lib/models/calendar-types.ts:45`, `path: lib/models/notes-types.ts:15`, `path: lib/models/meet-types.ts:35`
- Sidebar rows show the edit pencil only when `onEdit` is passed. `path: collection-sidebar/src/collection-sidebar-row.tsx:183`
- "New" entry points: `path: calendar-core/src/calendar-new-menu.tsx:26`, `path: tasks-core/src/tasks-new-menu.tsx:29`, `path: notes-core/src/notes-new-menu.tsx:29`, `path: meet-core/src/meet-workspace-sidebar.tsx:76`
- The offline stores already drop a collection that the server stopped listing. `path: lib/offline/tasks/tasks-inbound.ts:195`, `path: lib/offline/calendars/calendars-jmap-inbound.ts:62`
- The transport pattern to copy, with its mock: `path: lib/api/wgw/calendar-availability.ts:1`, `path: lib/api/mock/calendar-availability-settings.ts:1`
- "Project" already means a task list in the Tasks code. `path: project-dialog/src/project-dialog.tsx:217`
- The Groups to Teams rename is done (#1915, closed 2026-11-10); its chunk is `team-rename-copy`. `path: .agents/specs/1915-teams-visibility/tasks.md:14`

## Considered

Considered: the existing `chat_channel_meta.default_for_group` marker and the per-repository "provisioned Team collection" uri checks as the model for a sealed collection; chosen as the pattern (a stored marker for the default Project, a registry lookup for the rest) instead of a generic `sealed` column on every collection.

- **Team-admin flag as a column on `groupmembers`:** rejected. Member writes go through Sabre's group-member-set, which rewrites the rows, and a role stored in the membership table is the mistake recorded in the review findings of 2026-11-04. A separate `team_admins` table is read by one service.
- **Team admin as a second group principal per Team** (`{slug}-admins`): rejected. It would show up as a Team and make its members colleagues of each other through the role.
- **Let the team-admin role feed `TeamColleagues`** so the add-member picker reuses the invitee directory: rejected. That widens invitees, DMs, shares and availability at once. One dedicated candidates endpoint is the only widening.
- **Any member may manage Projects** (the Goal's 2026-10-26 text): replaced by the team-admin role, product owner 2026-11-19.
- **Team delete refused while Projects exist:** replaced. An organization admin outside the Team cannot purge its Projects, so the delete takes them along after a confirmation.
- **Keep DAV collection create closed** (the 2026-10-26 text), or **turn a DAV-created collection into a Project:** both replaced, product owner 2026-11-19. Creating a personal collection is allowed in the web apps, so it is allowed from a native app; a Project needs a team admin and five items, which a client that asked for one calendar did not ask for.
- **Forbid Team collections outside a Project:** rejected. A Project has one item per kind, so an existing second Team calendar fits no Project, and wrapping each in its own Project adds four empty items. They stay, and only a team admin creates and deletes them (product owner, 2026-11-19).
- **A fixed subfolder structure in a Project folder, or Sabre virtual collections for it:** later, with templates (product owner, 2026-11-19). A virtual DAV node would not exist for the web Drive, search, shares or Docs; real folders created from a template do.
- **`project_id` column on `calendar_collection_meta` instead of `project_resources`:** rejected. It covers four of five kinds, and the Drive folder would need a second place. One registry answers "what is in Project X" in one query.
- **Collection uri as the locator:** rejected. Sharee instances have their own uris; `calendars.id` is the same for every instance.
- **Project folder registered by path:** rejected in #810 already; a path does not survive a rename.
- **Hide an archived Project folder with a path filter in every reader** (REST list, FileNode get/query/changes, search, shares, DAV, collab): rejected. Six insertion points, and one missed reader leaks. Moving the folder into a server-owned tree needs one classification rule plus one grant-scope rule.
- **Archive tree as a plain dot-directory, which `StorageKeyClass` already treats as `Hidden`:** rejected, because `Hidden` keys leave the file index, so FileNode ids, and Docs links that use them, would not survive archive and unarchive. A new class `ProjectArchive` stays indexed.
- **Purged folder into a Team `.Trash`** (the #819 wording): rejected for now. No client shows a Team trash. The folder goes to the purging member's Drive trash, as a deleted Team folder does today.
- **Default Project uses the Team channel as its channel:** rejected. The Goal keeps a Team channel and a Project channel apart, and the Team channel is immutable.
- **Default Project gets its own Drive folder:** decided yes, 2026-11-22 (this reverses the earlier rejection). The default Project is a normal Project with a folder directly under the Team Drive root (`groups/{team}/{Team name} Project`), registered as its `drive_folder` resource, guarded and renamed like any other. The Team Drive root stays the view of everything the Team has, which the Team filter entry "All in {Team}" shows. Files already in the root are not moved into the folder; a name clash with an existing top-level folder takes the ` (2)` suffix. The default Project stays non-archivable and non-purgeable, so its folder stays too.
- **Personal Projects and seeding on every user-create path** (the 2026-10-26 text): dropped by the product owner, 2026-11-18.
- **JMAP `Project/get` and `/set`:** rejected. Other suite objects of this size (task lists) are REST with a push type.
- **Filter mounted through a per-app `footerExtra` prop** (as on `feat/projects`): rejected. Nine sidebars would each need the prop; the shared account footer reaches all of them.
- **Filter value on the server per user:** rejected. No per-user preference store exists, and the value is a view choice per device, like the theme.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. The issues were re-synced on 2026-11-19; building waits for the product owner's go-ahead.
2. `team-admin-role` first: `project-model-create` reads `TeamRoles`. Then `project-model-create`; everything else reads its tables.
3. `default-project-backfill`, `project-collection-guards` and `project-client-store` after 2, in parallel.
4. `project-drive-folder` after 2. `project-archive-purge` after `project-collection-guards` and `project-drive-folder`.
5. `team-delete-guard` after 3.
6. `team-admin-ui` after `team-admin-role`, parallel with everything else. `project-filter-ui` after `project-client-store`. `project-filter-apps` after `project-filter-ui` and `project-collection-guards` (it needs `projectId` on the wire). `project-manage-settings` after `project-archive-purge`.
7. `dav-personal-create` after `project-model-create`, parallel with every later chunk.
8. `acl-cycle-walk` after every API chunk. `projects-verify` last.

## Open decisions

- [ ] `project-archive-purge`: to verify — that one `StorageKeyClass` case plus `StoragePaths::isPathAllowed` and `DriveSharePathScope` cover every reader of the archive tree (REST list and download, `FileNode/get|query|changes`, search, shares, DAV, collab rooms). The chunk starts with a test per reader; a reader that is not covered gets its own named insertion point in this plan first.
- [ ] `project-filter-ui`: the product owner reviews the filter and the create dialog before merge. The same holds for `team-admin-ui`, `project-filter-apps` and `project-manage-settings`.

## Invariants

- The team-admin role changes nothing in what a user finds or sees outside the candidates endpoint: invitees, DM rail, share principals, presence rooms, DAV principals, free/busy and availability answer the same for a team admin and a plain member of the same Teams. A wrong change lets a team admin read a non-colleague's availability. Proof: `path: tests/Feature/Teams/TeamAdminVisibilityTest.php` assertion `test_team_admin_sees_no_more_colleagues_than_a_member`.
- A member who is not a team admin of that Team, and a non-member who is not an organization admin, cannot call the candidates endpoint or the member writes of that Team. An organization admin may, for any Team (spec Roles table). A wrong change makes the whole user directory searchable by anyone. Proof: `path: tests/Feature/Teams/TeamAdminMemberWritesTest.php` assertion `test_candidates_and_member_writes_need_the_role_for_that_team`.
- The organization-admin routes under `admin/groups` keep working unchanged. A wrong change locks organization admins out of member management. Proof: `path: tests/Feature/Teams/TeamAdminMemberWritesTest.php` assertion `test_organization_admin_routes_are_unchanged`.
- A Team member keeps reading and writing the Team calendar, task list and notebook after they are registered as the default Project. A wrong change turns the 403 on name and color into a 403 on events, tasks or notes. Proof: `path: tests/Feature/Projects/DefaultProjectBackfillTest.php` assertion `test_team_collections_stay_writable_after_backfill`.
- A DAV client cannot create a collection under a Team's calendar home or another user's. A wrong change lets any member add Team collections past the repositories' checks. Proof: `path: tests/Feature/Dav/MkcalendarHttpTest.php` assertion `test_mkcalendar_outside_own_home_is_forbidden`.
- A member who is not a team admin still creates, renames and deletes personal collections and still starts a Team meeting. A wrong change turns the Team-collection rule into a block on personal items or meetings. Proof: `path: tests/Feature/Teams/TeamCollectionRoleTest.php` assertion `test_personal_collections_and_team_meetings_are_unchanged`.
- A collection in no Project stays deletable, renamable and recolorable for whoever may manage it. A wrong change seals every Team collection. Proof: `path: tests/Feature/Projects/ProjectCollectionGuardTest.php` assertion `test_collection_outside_a_project_is_unchanged`.
- A non-member, an organization admin outside the Team included, gets the same 404 for an existing and an unknown Project id. A wrong change leaks Project names across Teams. Proof: `path: tests/Feature/Projects/ProjectAccessTest.php` assertion `test_non_member_and_unknown_id_answer_alike`.
- A failed create leaves no Project row, no collection and no channel meta, on sqlite and MySQL. A wrong change leaves collections that no Project owns. Proof: `path: tests/Feature/Projects/ProjectCreateRollbackTest.php` assertion `test_throw_after_first_collection_leaves_nothing`.
- Archive hides the four collections on every read path, availability and DAV included, for members and sharees. A wrong change keeps an archived calendar in free/busy or in a native client. Proof: `path: tests/Feature/Projects/ProjectArchiveVisibilityTest.php` assertion `test_archived_collections_are_gone_on_every_read_path`.
- FileNode ids of files in a Project folder are the same before archive and after unarchive, and a grant on such a file is inert while archived. A wrong change breaks Docs links or leaves a live share on an archived file. Proof: `path: tests/Feature/Projects/ProjectFolderArchiveTest.php` assertions `test_node_ids_survive_archive_and_unarchive`, `test_grant_is_inert_while_archived`.
- Team delete leaves no Project row, registry row, marker or team-admin row behind, for a Team with live and archived Projects. A wrong change leaves rows that point at deleted collections. Proof: `path: tests/Feature/Projects/TeamDeleteWithProjectsTest.php` assertion `test_team_delete_removes_projects_and_roles`.
- The schema version equals the migration count. A wrong change leaves updated installs without the tables. Proof: `path: tests/Unit/Installer/WgwSchemaMigratorTest.php` assertion `test_migrate_empty_database_reaches_current_version`.
- With the filter on "All Projects" every app lists what it lists today. A wrong change hides items in no Project. Proof: `path: packages/apps/src/lib/projects/project-filter-match.test.ts` assertion `all keeps every collection`.
- After `project-model-create`, main works without any later chunk: no route or client depends on Projects yet. Proof: `cmd: composer --working-dir packages/api done-gate`.
- After `project-collection-guards`, the current apps keep working although they do not hide the controls yet: the refused action shows the server's 403 message. Proof: `cmd: pnpm test:apps-done-gate`.
- After `project-client-store`, no UI changes. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/projects`.

## Chunks

### Chunk R1: Team-admin role and member management

- **id:** `team-admin-role`
- **Task:** #2278
- **Skill:** api, security
- **Inputs:** admin role resolver — `path: app/Services/Auth/AdminRoleResolver.php:18`; today's Team-collection rule — `path: app/Services/Calendars/CalendarRepository.php:94`, `path: app/Services/Calendars/CalendarCollectionAccess.php:178`; member writes — `path: app/Services/Settings/GroupDirectoryService.php:110`; admin-only routes — `path: routes/api.php:403`; colleague rule table — `path: app/Services/Teams/TeamColleagues.php:22`
- **Done when:** a migration adds `team_admins` and the schema version and parity test follow; `TeamRoles` offers `mayManageMembers`, `mayManageProjects` and `mayManageTeamCollections` and is the only reader of the table; creating a collection with a `groupSlug`, moving one to a Team, and deleting or transferring a Team-owned one need `mayManageTeamCollections` in the four repositories (REST, JMAP, MCP), with `mayDelete` reported to match, while personal collections, Team meeting rooms and rename or recolor of an existing Team collection behave as before; routes outside `admin` list a Team's members, add and remove a member, and appoint and dismiss a team admin, each refused with 404 for a caller who is neither team admin of that Team nor organization admin; removing a member removes their team-admin row in the same transaction, and user delete and Team delete remove theirs; `GET /teams/{slug}/member-candidates` needs the role, a query of two characters or more, caps its results and has its own rate limit; `admin/groups` responses and writes carry the team-admin flag; `settings/state` reports `isTeamAdmin` per Team; `TeamColleagues` is untouched and the visibility invariant test covers every surface in its table.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** none

### Chunk R2: Team-admin UI

- **id:** `team-admin-ui`
- **Task:** #2278
- **Skill:** apps-ui, storybook, accessibility
- **Inputs:** Teams pane in Settings — `path: settings-core/src/settings-memberships-pane.tsx:15`; role label in Admin — `path: admin-core/src/admin-users-pane.tsx:86`
- **Done when:** Admin says "Organization admin" and has a team-admin toggle per member of a Team; in Settings a team admin sees the members of their Team, adds one through the candidates search, removes one, and appoints or dismisses team admins; a plain member sees the pane as today; mock-tier stories and Vitest cover each action and the refused cases.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** every chunk after `team-admin-role`

### Chunk A1: Project model, create, patch, ensure

- **id:** `project-model-create`
- **Task:** #817
- **Skill:** api, security
- **Inputs:** collection creation inside a `wgw` transaction — `path: app/Services/Chat/ChatGroupDefaultChannelProvisioner.php:120`; membership check — `path: app/Services/Teams/TeamColleagues.php:90`; marker pattern — `path: app/Services/Notify/NotificationInboxMarkers.php:25`; schema version — `path: app/Services/Installer/WgwSchemaMigrator.php:15`
- **Done when:** migrations add `projects`, `project_resources` and `project_markers` with the unique indexes in spec.md, the schema version is bumped and the parity test lists them; OpenAPI and routes exist for `GET /projects` (optional `archived=1`), `POST /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`; create runs in one `wgw` transaction and the rollback test is green on sqlite and MySQL; a slug clash gets a suffix and a lost race retries; `PATCH` writes name and color through to the four collections; ensure repairs a Project with a missing collection, is idempotent under two overlapping `GET /projects`, and skips archived rows unless they are asked for; a non-member gets 404 on every route and a member who is not team admin gets 403 on writes (`TeamRoles::mayManageProjects`); the response carries `mayManage`; `Project` is a push type whose state hashes the caller's Team slugs and markers; `pnpm --filter @wgw/api run typegen` is run.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** none

### Chunk A2: Default Project for new and existing Teams

- **id:** `default-project-backfill`
- **Task:** #817
- **Skill:** api
- **Inputs:** provisioned uris — `path: app/Services/Calendars/UserCalendarCollectionsProvisioner.php:159`; Team create — `path: app/Services/Admin/AdminGroupManagementService.php:38`; backfill pattern — `path: database/migrations/wgw/2026_07_08_000151_wgw_provision_group_task_lists.php:16`
- **Done when:** Team create ends with a default Project named "{Team name} Project" (three provisioned collections registered, one channel created with that name, `default_for_group` set); a migration does the same for every existing Team and can run twice; existing collection names and colors are untouched; a Team whose provisioned collection is missing gets it provisioned first; the dev install and the installer e2e show a default Project for the seeded Team; archive and purge of a default Project answer 409.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `project-collection-guards`, `project-client-store`

### Chunk A3: Project folder in the Team Drive

- **id:** `project-drive-folder`
- **Task:** #817
- **Skill:** api, security
- **Inputs:** node ids survive rename and move — `path: app/Services/Jmap/FileNodes/FileNodeIndexService.php:400`; rename bookkeeping — `path: app/Services/Drive/DriveService.php:212`; Team home — `path: app/Services/Drive/GroupFilesHomeProvisioner.php:18`
- **Done when:** create makes `files/groups/{team}/{name}` after the commit, indexes it and stores its `node_id` as the `drive_folder` resource; a name clash gets a suffix; ensure recreates a missing folder; `PATCH` name renames the folder through the Drive rename path; the Project response carries the folder's node id and current path; client delete, rename and move of the folder itself are 403 over REST, `FileNode/set` and DAV, while files inside behave as before; the default Project has the same folder, made when the Team is created, by a backfill migration for existing Teams (idempotent, nothing moved) and by ensure.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `default-project-backfill`, `project-collection-guards`, `project-client-store`

### Chunk B1: Guards on Project collections

- **id:** `project-collection-guards`
- **Task:** #819
- **Skill:** api, security
- **Inputs:** repository guards — `path: app/Services/Calendars/CalendarRepository.php:201`, `path: app/Services/Tasks/TaskListRepository.php:191`, `path: app/Services/Notes/NotebookRepository.php:192`, `path: app/Services/Chat/ChatChannelRepository.php:256`; PROPPATCH is open over DAV — `path: app/Dav/Server/WebdavWriteGuardPlugin.php:95`
- **Done when:** one `ProjectRegistry` lookup (memoised per request) answers "which Project owns this `calendarid`"; delete, owner transfer and owner-side name or color change of a Project collection are 403 in all four repositories, through REST, JMAP `Calendar/set` and `Notebook/set`, and MCP; a sharee's own name and color still work; DAV PROPPATCH of display name or color answers 403 for that property; Calendar, TaskList, Notebook and ChatChannel responses carry `projectId` and `mayDelete`/`mayRename` false for Project collections; `PATCH /projects` still writes through; a collection in no Project behaves as before.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `default-project-backfill`, `project-drive-folder`, `project-client-store`

### Chunk B5: Personal collections over DAV

- **id:** `dav-personal-create`
- **Task:** #819
- **Skill:** api, security
- **Inputs:** front method list — `path: routes/web.php:25`; backend create — `path: app/Dav/Server/WgwCalendarBackend.php:372`
- **Done when:** `MKCALENDAR` is in the front method list; a real HTTP `MKCALENDAR` and an extended `MKCOL` under the caller's own calendar home create a personal event calendar, task list or notebook by component set; the same under a Team's home or another user's is 403 and creates nothing; reserved prefixes stay refused; display name and color are limited as on the REST and JMAP create paths; the new collection has no `projectId`; the result is checked once with a real native client.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** every chunk after `project-model-create`

### Chunk B2: Archive, unarchive, purge

- **id:** `project-archive-purge`
- **Task:** #819
- **Skill:** api, security
- **Inputs:** single read path — `path: app/Services/Calendars/CalendarCollectionAccess.php:56`; availability query — `path: app/Services/Calendars/CalendarCollectionAccess.php:364`; DAV listing — `path: app/Dav/Server/WgwCalendarBackend.php:303`; key classes — `path: app/Storage/StorageKeyClass.php:56`; grant scope — `path: app/Services/Drive/DriveSharePathScope.php:35`
- **Done when:** `POST /projects/{id}/archive`, `/unarchive` and `DELETE /projects/{id}` exist in OpenAPI and routes; archive hides the four collections in `accessibleInstancesByKind`, `availabilitySourceInstances` and the DAV backend, for members and sharees; the folder moves to `.project-archive/{slug}` under a new `StorageKeyClass::ProjectArchive` that stays file-indexed, is not search-indexed, is refused by the path check for every client request, and is outside grant scope; unarchive restores the same hrefs, node ids and grants; purge of a live Project is 409; purge of an archived one deletes the four collections, moves the folder to the purging member's trash, deletes the rows, and completes on retry after a simulated failure following the first collection; the slug is free after purge and reserved while archived.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `team-delete-guard`

### Chunk B3: Team delete with Projects

- **id:** `team-delete-guard`
- **Task:** #819
- **Skill:** api
- **Inputs:** delete order — `path: app/Services/Admin/AdminGroupManagementService.php:89`
- **Done when:** Team delete removes every Project row, registry row and marker of the Team, live or archived, in the existing transaction, and the collections through the existing DAV teardown; the delete response and the Admin confirmation name the number of Projects; the Team Drive root cannot be deleted, renamed or moved by a client (a test, and a guard only where the test shows a gap).
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `project-archive-purge`

### Chunk B4: Membership cycle walk

- **id:** `acl-cycle-walk`
- **Task:** #819
- **Skill:** testing, security
- **Inputs:** colleague rules — `path: app/Services/Teams/TeamColleagues.php:12`
- **Done when:** one feature test per app (Calendar, Tasks, Notes, Meet, Drive, Docs, Contacts) walks: add a member, the new member sees existing Project content, remove the member, archive the Project, purge the Project, delete the Team; each step asserts both the member's and an outsider's view; findings are fixed in the chunk that owns the code and reported privately.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** none

### Chunk C1: Projects client, store and filter value

- **id:** `project-client-store`
- **Task:** #818
- **Skill:** client-transport, workspace
- **Inputs:** transport and mock pattern — `path: lib/api/wgw/calendar-availability.ts:1`, `path: lib/api/mock/calendar-availability-settings.ts:1`; cross-app value pattern — `path: lib/theme-preference.ts:21`
- **Done when:** `lib/api/wgw/projects.ts` covers list, create, patch, archive, unarchive and purge with `WgwRequestError` on every failure, plus a mock source and a contract test; `lib/projects/` holds the `WorkspaceProject` type, a store loaded once by the live shell and refreshed on the `Project` push state, an offline copy, the filter value store on `wgw.ui.projectFilter` (same-tab event and `storage` event, unknown id falls back to `all`), and pure match functions per app; nothing renders yet.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/projects src/lib/api`
- **Parallel with:** `default-project-backfill`, `project-collection-guards`, `project-drive-folder`

### Chunk C2: Sidebar filter and create dialog

- **id:** `project-filter-ui`
- **Task:** #818
- **Skill:** apps-ui, storybook, accessibility
- **Inputs:** footer used by every app — `path: workspace-shell/src/workspace-app-layout.tsx:211`; floating footer height — `path: app-sidebar/src/app-sidebar.tsx:118`; `SelectTrigger` without `asChild` — `path: ui/select.tsx:44`
- **Done when:** `projects-ui/` holds `ProjectFilterSelect` and `CreateProjectDialog`, rebuilt from `feat/projects` on today's primitives (inline `FieldLabelRow`, `NameColorRow`, a Team select, Create and Cancel); `SelectTrigger` supports `asChild`; the filter renders inside `WorkspaceSidebarAccountFooter` above the account row in every app and the footer height variable follows; the list is "All Projects", Projects grouped per Team with the default first, and, only for a team admin, "Create Project" and "Manage Projects"; the create dialog offers only Teams the caller is team admin of; a user in no Team sees "All Projects" only; mock-tier stories and Vitest cover select, create, and an archived Project leaving the list; keyboard and screen-reader labels pass the accessibility checklist.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** `project-archive-purge`

### Chunk C3: The filter in each app, and collection chrome

- **id:** `project-filter-apps`
- **Task:** #818
- **Skill:** workspace, apps-ui
- **Inputs:** list inputs — `path: calendar-core/src/calendar-sidebar-order.ts:64`, `path: tasks-core/src/use-tasks-sidebar-model.tsx:34`, `path: notes-core/src/use-notes-sidebar-model.tsx:106`, `path: meet-core/src/meet-channel-partition.ts:11`, `path: drive-core/src/use-drive-sidebar-model.tsx:42`, `path: docs-core/src/use-docs-home-sidebar-model.tsx:17`, `path: contacts-core/src/use-contacts-sidebar-model.tsx:34`; edit pencil — `path: collection-sidebar/src/collection-sidebar-row.tsx:183`; "New" menus — `path: calendar-core/src/calendar-new-menu.tsx:26`
- **Done when:** with a Project selected, Calendar, Tasks, Notes and Meet list only that Project's collection, in the sidebar and in the main pane; Meet lists Project channels apart from the Team channel and named channels; Drive and Docs open on the Project folder (the default Project's own folder too; a Team filter opens the whole Team Drive); the Drive Projects section lists default Projects as well; Contacts shows the owning Team's address book; switching apps and reloading keep the selection, covered by Vitest; Project collections have no edit pencil and no delete; the "New" items are hidden while a Project is selected, and their owner choice offers a Team only to a team admin of it; delete of a Team item in no Project shows only to a team admin; an archived or lost Project falls back to "All Projects"; e2e covers one switch across two apps.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** `project-manage-settings`

### Chunk C4: Projects panel in Settings

- **id:** `project-manage-settings`
- **Task:** #818
- **Skill:** apps-ui, storybook
- **Inputs:** Settings panel registry — `path: settings-core/src/settings-registry.ts:1`
- **Done when:** a "Projects" panel lists the caller's Projects per Team, archived ones in their own group, editable only where the caller is team admin; name and color autosave; archive and unarchive act at once; purge is offered only for archived Projects and its dialog requires typing the Project name; the default Project shows no archive or purge; "Manage Projects" in the filter opens the panel; mock-tier stories and Vitest cover each action and the 409 answers.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** `project-filter-apps`

### Chunk V: Cross-chunk verify

- **id:** `projects-verify`
- **Skill:** testing
- **Inputs:** verifier prompt — `path: .agents/skills/developer/multitask-verifier.md:1`
- **Done when:** the read-only verifier answers `PASS` or `PASS_WITH_NITS`; verify-issue is green against #817, #819 and #818; the done-checklist ran; a browser e2e on a production build covers create, switch apps, reload, second tab, archive, unarchive and purge, in a cold browser too.
- **Verify with:** `composer --working-dir packages/api done-gate && pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: the visibility invariant for team admins, one assertion per surface of the colleague rule table, before the role code
- [ ] API: OpenAPI, then a failing feature test, then the implementation, then `composer done-gate`, per chunk
- [ ] API: the rollback test is written and green before any other create code
- [ ] API: one test per reader of the archive tree before the archive code
- [ ] API: the membership cycle per app
- [ ] UI: mock-tier Storybook for the filter, the create dialog and the Settings panel
- [ ] UI: Vitest for the filter value store, the match functions and the app-switch persistence
- [ ] e2e: create a Project, switch apps, reload, second tab, archive, purge; once in a cold browser

## Doc updates (only if user wants)

- `docs/architecture/projects.md`: the model, the registry, the guards, archive and purge, and where the filter reads. After the API chunks land.
- `docs/architecture/team-visibility.md`, if it exists by then: the candidates endpoint as the one exception.

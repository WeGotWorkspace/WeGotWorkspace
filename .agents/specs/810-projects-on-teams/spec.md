Source: #810 (body-hash: f72d1900)
Goal: WeGotWorkspace/Product#114

# Projects on Teams

Written against `origin/main` at `c47b45070` (2026-11-18). Each chunk in plan.md names its Task (#2278, #817, #819, #818). API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

The issue bodies of #810, #2278, #817, #819 and #818 were re-synced on 2026-11-19 to the product owner's decisions of 2026-11-18 and 2026-11-19, which are listed first.

## Decisions of 2026-11-18 (product owner)

1. **Team Projects only.** A Project belongs to exactly one Team. There is no Personal Project and nothing is seeded when a user is created. This follows the 2026-11-04 decision in [1915-teams-visibility](../1915-teams-visibility/spec.md) and replaces "owned by a user or by a Team" in #810. Personal calendars, task lists and notebooks stay outside every Project.
2. **The existing Team set becomes the Team's first Project** (design question 3). The calendar, task list and notebook a Team gets today, plus one new chat channel, are the Team's **default Project**. Existing Teams get it through a migration.
3. **A Project folder in the Team Drive, in the first version** (design question 1). The folder is registered by its FileNode id, and Drive and Docs follow the filter.
4. **"Joining" a Project is later.** Every Team member sees every Project of the Team. A Project calendar counts toward availability for every member, as Team calendars do today ([1907-team-availability](../1907-team-availability/spec.md)).

## Decisions of 2026-11-19 (product owner)

5. **Two admin roles.** Today's admin becomes the **organization admin**: creates Teams and users, and assigns users to Teams. A new **team admin** role exists per Team, and a Team can have several. A team admin adds and removes members of that Team and creates and deletes its Projects.
6. **A team admin finds every user when adding a member**, in that one picker only. The role must not widen what the team admin sees anywhere else: invitees, DMs, shares, presence and availability keep following shared Teams.
7. **The default Project is named "{Team name} Project"** (a Team "Studio" gets "Studio Project").
8. A purged Project folder goes to the Drive trash of whoever purged it. The Project folder follows the Project's name and cannot be renamed or moved on its own.

9. **Native calendar apps may create personal collections over DAV**, as the web apps can. Never under a Team, and a collection created this way is never turned into a Project.

10. **Only a team admin creates and deletes Team items that are in no Project** (a Team calendar, task list, notebook or channel). Existing ones stay. Personal items are unchanged.
11. **A fixed set of subfolders in a Project folder is later**, together with Project templates.

Confirmed by the product owner on 2026-11-19:

- A plain member **uses** a Project and cannot create, rename, recolor, archive or purge one. Those are for team admins.
- An organization admin who is not a member of a Team does not see or manage its Projects. Deleting the Team removes its Projects with it, after a confirmation that names how many.
- Existing and new Teams start **without** a team admin. An organization admin appoints the first one; a team admin can appoint and dismiss other team admins of the same Team.

The UI of the old local branch `feat/projects` (filter above the account row, create dialog) is the visual starting point. Its logic is not reused: it treats a Project as a group principal.

## Goal

A Team member picks a Project in the sidebar and every app shows that Project's items: its calendar, task list, notebook, chat channel and Drive folder. The choice is one value for the whole suite and survives app switches and reloads.

On the server a Project is a row plus a registry of the five things it bundles. It has no principal and no access rules of its own: access is Team membership, enforced where it already is. The registry is what the filter asks, what the guards read, and what archive and purge act on.

## Model

| Level | Holds |
|---|---|
| **Team** (group principal `principals/groups/{slug}`) | address book, Drive (`files/groups/{slug}`), Team chat channel, and one or more Projects |
| **Project** | calendar, task list, notebook, chat channel, Drive folder |
| **Default Project** (one per Team) | the Team's provisioned calendar, task list and notebook, plus one new channel. No Drive folder: its Drive view is the whole Team Drive. |

- `projects`: `id`, `group_slug` (the owning Team), `slug`, `name`, `color`, `default_for_group` (nullable, unique: marks the default Project the way `chat_channel_meta.default_for_group` marks the Team channel), `archived_at`, timestamps. `UNIQUE (group_slug, slug)`, archived rows included.
- `project_resources`: `project_id`, `kind` (`calendar | tasklist | notebook | meet_channel | drive_folder`), `locator`. `UNIQUE (project_id, kind)` and `UNIQUE (locator)`.
- **Locator.** For the four CalDAV-backed kinds it is `calendars.id` (the `calendarid`), which is the same for the owner instance and every sharee instance and survives rename and owner transfer. For `drive_folder` it is the FileNode `node_id` (`fn-…`), which survives rename and move.
- `project_markers`: one change marker per Team, bumped on every Project write. It feeds a new `Project` push type.
- `team_admins`: `group_slug`, `username`, unique together. It is its own table and not a column on `groupmembers`, because member writes go through Sabre's `setGroupMemberSet`, which rewrites the rows.
- Collections outside every Project keep working as today. A Team can still own extra calendars, lists, notebooks and channels that belong to no Project.

## Non-goals

- Personal Projects, and seeding anything at user creation
- Per-Project access, a Project principal, or sharing a Project with a second Team
- Joining or leaving a Project per member, and its effect on availability
- A second item of the same kind in a Project, nested Projects, templates, a fixed set of subfolders in a Project folder, moving a Project to another Team
- Moving existing extra collections or folders into a Project
- An address book per Project
- Roles finer than organization admin, team admin and member; a team admin who can create Teams or users
- Letting a team admin see more colleagues than membership gives
- A Team trash in the Drive UI. A purged Project folder goes to the Drive trash of the member who purged it, like any deleted Team folder today.
- Changing how a Team's files are removed when the Team is deleted (still a hard delete)
- Renaming Groups to Teams: done in #1915
- JMAP `Project/get` and `Project/set`. Projects are REST; only the push type is added.
- Creating a collection under a Team over DAV, or wrapping DAV-created collections into a Project
- Creating address books over DAV

## Affected packages

- `packages/api`:
  - tables, models, schema version, parity test
  - `ProjectService` (create, patch, ensure, archive, unarchive, purge) and the default Project for new and existing Teams
  - OpenAPI and routes for `/projects`
  - `projectId` on Calendar, TaskList, Notebook and ChatChannel responses
  - guards in the four collection repositories and one DAV PROPPATCH guard
  - archive hiding for collections, availability and the Drive folder
  - Team delete guard
  - `team_admins`, `TeamRoles`, and member and team-admin endpoints that a team admin may call
  - `Project` push type
  - PHPUnit, including the membership cycle per app
- `packages/apps`:
  - `lib/api/wgw/projects.ts` and its mock, a Projects store with an offline copy, the filter value store
  - sidebar filter and create dialog (rebuilt from `feat/projects` on today's primitives)
  - the filter applied in Calendar, Tasks, Notes, Meet, Drive, Docs and Contacts
  - collection chrome (no rename, color or delete on Project collections)
  - a Projects panel in Settings (edit, archive, unarchive, purge)
  - member and team-admin management for team admins in Settings; "Organization admin" and a team-admin toggle in Admin
  - Storybook, Vitest, e2e
- `docs`: `docs/architecture/projects.md` after the API chunks land

## Technical constraints

### Roles

| | Organization admin (`users.is_admin`) | Team admin (`team_admins`) | Member |
|---|---|---|---|
| Create Teams and users | yes | no | no |
| Add and remove members | any Team | own Team | no |
| Appoint and dismiss team admins | any Team | own Team | no |
| Read a Team's Projects | only as a member | yes | yes |
| Create, rename, recolor, archive, unarchive, purge a Project | only as a team admin | yes | no |
| Create and delete a Team collection in no Project | only as a team admin | yes | no |
| Delete a Team (removes its Projects) | yes | no | no |

- One service, `TeamRoles`, answers `mayManageMembers(viewer, slug)` (organization admin, or team admin of that Team) and `mayManageProjects(viewer, slug)` (team admin of that Team). It also answers `mayManageTeamCollections(viewer, slug)` (team admin of that Team). Each method names its bypass and nothing else reads `team_admins`.
- Creating a calendar, task list, notebook or channel with a `groupSlug`, moving one to a Team, and deleting or transferring a Team-owned one need `mayManageTeamCollections`. This replaces today's rule (any member creates; only an organization admin deletes or transfers). Not covered: personal collections, meeting rooms created with a Team, renaming or recoloring an existing Team collection, and files and folders in the Team Drive.
- A team admin is always a member. Removing a member removes their team-admin row in the same transaction. A Team may be left without a team admin; an organization admin appoints a new one.
- New routes outside the `admin` prefix, each checked with `TeamRoles`: list members of a Team, add and remove a member, appoint and dismiss a team admin. The organization-admin routes under `admin/groups` stay and gain the team-admin flag.
- `settings/state` reports `isTeamAdmin` per Team, so the apps know where to show the controls.

### Finding people to add (the one widening)

- `GET /teams/{slug}/member-candidates?q=` returns display name, username and email of users matching `q`. It requires `mayManageMembers` for that Team, a query of at least two characters, a capped result count and its own rate limit, keyed by the authenticated user (not the client address).
- It is the only place where the team-admin role lets someone see a non-colleague. `TeamColleagues` does not read `team_admins`: `isColleague`, `sharesTeamIgnoringAdminRole` and every surface in its rule table (invitees, mentions, DM rail, share dialogs, presence, DAV principals, free/busy, availability) answer the same for a team admin as for a member.
- Once someone is added, they are a colleague through membership, as for any member. That is the intended effect of adding, not a side effect of the role.

### Access to Projects

- Reading (`GET /projects`, `GET /projects/{id}`) needs real membership of the owning Team (`TeamColleagues::isOwnTeam`). A non-member gets 404, the same answer as an unknown id; an organization admin outside the Team gets 404 too.
- Writing (create, patch, archive, unarchive, purge) needs `TeamRoles::mayManageProjects`. A member who is not a team admin gets 403. The Project response carries `mayManage` for the caller.
- Today only an organization admin may delete or transfer a Team-owned collection. Project collections cannot be deleted or transferred by anyone through the collection endpoints; they only go through purge.

### Create

- `POST /projects` takes `name`, optional `color`, and a required `teamSlug`.
- Slug is `Str::slug(name)`. A clash with a live or archived Project of the same Team gets `-2`, `-3`. A lost race on the unique index retries with the next suffix; the request never fails on it.
- One `wgw` transaction: lock the Team principal row, insert the Project row, create the four collections through the Sabre backend under the Team principal, insert the four registry rows, bump the Team marker. `ChatGroupDefaultChannelProvisioner::provision` already creates a collection inside a `wgw` transaction, so the rollback is proven by a test first (sqlite and MySQL).
- The Drive folder comes after the commit, because a directory cannot roll back: create `files/groups/{team}/{name}` (with a collision suffix), index it, store its `node_id`. If this step fails the Project exists without a folder and **ensure** repairs it.
- **Ensure** only repairs a Project that exists. It runs after create and lazily on `GET /projects` and `GET /projects/{id}` for the rows it returns. It is idempotent under concurrent requests. It never creates a Project, except the default Project of a Team that has none.

### Default Project

- Created with the Team (`AdminGroupManagementService::create`) and, for existing Teams, by a one-time migration that calls the same service method. The pattern is `2026_07_08_000151_wgw_provision_group_task_lists.php`.
- It registers the three provisioned collections (uris `{slug}`, `tasks-{slug}`, `notes-{slug}`) and creates one channel. It does not rename or recolor what exists: the Project is named "{Team name} Project", the new channel takes that name, and the Project takes the Team calendar's color. A later `PATCH` of the name writes through to all four, like any Project.
- It cannot be archived or purged (409). It goes when the Team goes.
- The lazy `ensureForGroupPrincipal` callers stay. They create collections; the default-Project ensure links them.

### Rename and color

- `PATCH /projects/{id}` writes `name` and `color` through to the four collections with an internal call that bypasses the client guard. Slug, uris and hrefs do not change.
- A rename also renames the Project folder through the normal Drive rename path, so share and index bookkeeping runs. A name clash in the Team Drive gets a suffix.

### Guards on Project collections and the Project folder

- Collection repositories (`CalendarRepository`, `TaskListRepository`, `NotebookRepository`, `ChatChannelRepository`): for a collection in the registry, `delete` is 403, owner transfer is 403, and an owner-side change of name or color is 403. Other properties stay writable. A sharee's own name and color stay theirs.
- Responses carry `projectId` (string or null) and report `mayDelete: false` and `mayRename: false` for Project collections, so the apps can hide the controls.
- DAV: a PROPPATCH of `{DAV:}displayname` or `calendar-color` on a Project collection answers 403 for that property in the 207. DELETE and MOVE of collections are already refused for everyone by `WebdavWriteGuardPlugin`.
- Drive: client delete, rename and move of the Project folder itself are 403 over REST, JMAP `FileNode/set` and DAV. Everything inside it is an ordinary file or folder.
- Creating a collection with a `projectId`, or adding a fifth item, is not possible: the registry is written only by `ProjectService`.

### Creating collections over DAV

- The HTTP front lets `MKCALENDAR` through. Under the caller's own calendar home, `MKCALENDAR` and an extended `MKCOL` with a calendar resource type create a personal collection; the backend derives the kind from the component set, as it does today.
- Under a Team's calendar home or another user's, the request is 403 and creates nothing. Only `ProjectService` and the collection repositories create Team collections.
- The result is a collection in no Project. Display name and color get the limits of the REST and JMAP create paths.

### Archive, unarchive, purge

- **Archive** sets `archived_at`. The four collections disappear for everyone, sharees included: from lists, changes, push state, DAV listings and availability. The Team address book, Team Drive and Team channel stay.
- The Project folder moves to a server-owned tree `files/groups/{team}/.project-archive/{slug}`. Clients cannot list, open, search or share anything under it, and grants on paths under it are inert. FileNode ids are kept, so unarchive restores the same ids, links and grants.
- **Unarchive** clears `archived_at` and moves the folder back (with a collision suffix if the old name is taken).
- **Purge** on a live Project is 409. On an archived Project it hard-deletes the four collections, moves the folder to the Drive trash of the member who purged, and deletes the rows. Each step is skipped when already done, so a purge that failed half-way completes on retry. Purge frees the slug.
- Team delete (organization admin) removes every Project of the Team, live or archived: rows first, inside the existing transaction, then the collections through the existing DAV teardown, and the folders with the Team's files. The Admin confirmation names the number of Projects.

### Live updates

- Push is pull-only: the event source computes state per caller. The `Project` state for a caller is a hash over the caller's Team slugs and each Team's marker. A new membership changes the set, so it changes the state. Appointing or dismissing a team admin bumps the Team's marker, so `mayManage` and the create and manage entries follow in every tab.
- Archive and unarchive also change the Calendar, TaskList, Notebook and ChatChannel states, because those are computed over the visible instances.

### Apps

- **Naming.** In the Tasks code a task list is already called a "project" (`project-dialog/`, `tasks-project-dialog-labels.ts`). New code uses `WorkspaceProject` and lives in `lib/projects/` and `projects-ui/`, and never extends those files.
- **Filter value.** One localStorage key for the suite, `wgw.ui.projectFilter`, with a same-tab event and the `storage` event, as `lib/theme-preference.ts` does. Values: `all`, or `p:<id>`. A stored id that is no longer in the list falls back to `all`.
- **Projects store.** One module-level store loaded once per session by the live shell, refreshed on the `Project` push state, with an offline copy so the filter works offline. Transport follows the client-transport rule: every failure is a `WgwRequestError` with a status.
- **Mount.** One place for every app: inside `WorkspaceSidebarAccountFooter`, above the account row. No per-app prop.
- **Filter list.** "All Projects", then per Team its Projects (default Project first), then "Create Project" and "Manage Projects". Archived Projects are not listed. The last two appear only for a caller who is team admin of at least one Team, and the create dialog offers only those Teams.
- **Matching.** A collection matches when its `projectId` equals the selected id. Drive and Docs narrow to the Project folder path, the default Project's own folder included; the Team filter ("All in {Team}") shows the whole Team Drive. Contacts shows the owning Team's address book.
- **"All Projects"** shows everything, including items in no Project.
- **Chrome.** No edit pencil and no delete on Project collections. "New calendar / list / notebook / channel" is hidden while a Project is selected and creates an item outside every Project otherwise. The owner choice offers a Team only to a team admin of it, and delete of a Team item in no Project shows only to a team admin.
- **Manage.** A Projects panel in Settings: name and color, archive, unarchive, purge, for Teams where the caller is team admin; read-only rows elsewhere. The purge confirmation asks for the Project name.
- **Members.** In Settings, a team admin sees the members of their Team, adds one through the candidates search, removes one, and appoints or dismisses team admins. Admin says "Organization admin" and gets a team-admin toggle per member.
- **Dialog norm.** Inline `FieldLabelRow`, Create/Cancel on the create dialog, autosave in the Settings panel.

## Edge cases

- A team admin adds someone, looks at their availability, and removes them again. The role allows it; the added person sees the Team in Settings at once. A notice to the added person is a follow-up, not part of this work.
- The only team admin leaves the Team or is disabled: the Team has no team admin until an organization admin appoints one. Its Projects keep working for members.
- A team admin dismisses themself: allowed.
- An organization admin who is a member but not team admin of a Team cannot manage its Projects, but can appoint themself.
- A user in no Team has no Projects: the filter shows "All Projects" only, with no create action and no empty-state prompt.
- A member is removed from a Team while one of its Projects is selected: the next Projects refresh drops the id and the filter falls back to `all`.
- A Project is archived by someone else while selected: same fallback; the offline stores drop the four collections through their normal reconcile.
- A Team is renamed: the default Project keeps its own name. Nothing is renamed today for the Team's collections either.
- The Project folder was deleted outside the app (filesystem, or before the guard existed): ensure creates a new folder and stores the new `node_id`.
- A provisioned Team collection is missing when the default Project is ensured: the existing lazy provisioner creates it first.
- Two team admins create a Project with the same name at once: both succeed, the second gets the `-2` slug and a suffixed folder name.
- A file inside an archived Project was shared with a guest link: the link answers as not found while archived and works again after unarchive.
- An event in a Project calendar has attendees: archive hides the calendar for the Team; it sends no cancellations. Purge deletes the calendar the way an admin's delete of a Team calendar does today.
- A Docs tab is open on a file in a Project that gets archived: the collab room refuses the next join, as for any file that becomes unreachable.

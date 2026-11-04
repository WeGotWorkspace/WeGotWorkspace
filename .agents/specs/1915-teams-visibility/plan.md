# Teams: rename Groups, and see only colleagues you share a Team with

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `0fa5d3521`. API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

## Goal

"Group" becomes "Team" in every user-facing string. A non-admin finds, sees and interacts only with users who share a Team with them. A single server-side colleague resolver backs every discovery list and every write gate. Existing shares with non-colleagues are hidden on read, the same way dismissed shares are hidden today, so nothing is deleted and everything comes back when the users share a Team again.

## Budget

- **Draws from:** the Projects revision (Goal WeGotWorkspace/Product#114). This is its first step, because Projects sit on the Team boundary.
- **Displaces:** further UI work on `feat/projects` until chunk A has landed, because both touch the same label files. Team availability (Epic #1907) and #1614 wait for chunk B, so they can use the same colleague rule.

## Non-goals

See spec.md, Non-goals.

## What exists

**Teams and admin**

- A Team is a Sabre group principal `principals/groups/{slug}`; membership is the `groupmembers` table. `path: app/Models/GroupMember.php:27`
- `administrators` is an ordinary group principal that grants the admin role. `path: app/Services/Auth/AdminRoleResolver.php:11`, `path: app/Services/Auth/AdminRoleResolver.php:16`
- Viewer's Teams: `DriveGroupResolver::allowedGroupSlugs`. Members of given Teams: `GroupMembershipResolver::memberPrincipalUrisByGroupUris`. No helper returns "users who share a Team with X". `path: app/Services/Drive/DriveGroupResolver.php:14`, `path: app/Services/Settings/GroupMembershipResolver.php:25`
- Membership is written in several places: `GroupDirectoryService::writeMembers`, `AdminUserProvisionerService::syncGroupMemberships`, group delete, user delete and the installer seeder. `path: app/Services/Settings/GroupDirectoryService.php:224`, `path: app/Services/Admin/AdminUserProvisionerService.php:187`, `path: app/Services/Admin/AdminGroupManagementService.php:88`, `path: app/Services/Admin/AdminUserProvisionerService.php:156`, `path: app/Services/Installer/InstallerSeeder.php:92`

**Discovery surfaces**

- `invitees()` returns every user principal with a calendar address. There is no Team or admin check. `path: app/Services/Calendars/CalendarSchedulingNotificationService.php:43`, route `path: routes/api.php:231`
- The web app builds the DM rail, mentions and share pickers from invitees plus the caller's own groups. `path: lib/api/wgw/meet-chat-directory.ts:47`, `path: lib/api/wgw/calendar.ts:272`
- `GET files/shares/principals` searches every user and every group, `administrators` included. `path: app/Services/Drive/DriveSharePrincipalDirectoryService.php:21`, route `path: routes/api.php:181`
- `settings/state` returns only the caller's own groups. `path: app/Services/Settings/GroupDirectoryService.php:161`
- Over DAV, `principals/` lists only self and the groups container, and principal-property-search is limited to self. `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:35`, `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:98`
- `principals/{user}` resolves any account. `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:57`
- The group principal container grants `{DAV:}read` to every authenticated user, and lists every member. `path: app/Dav/Server/GroupPrincipalContainer.php:39`, `path: app/Dav/Server/GroupPrincipalContainer.php:58`

**Facts added after the external review (2026-11-04, `origin/main` at `b25a99f`)**

- JMAP `Calendar/changes` is `CalendarChangesMethod`, which composes its state from `CalendarEventRepository::calendarSyncTokens`. That map is keyed by the viewer's accessible instances, so a share that drops out of `accessibleInstances` reports as destroyed, and one that comes back as created. `path: app/Services/Jmap/Methods/CalendarChangesMethod.php:52`, `path: app/Services/Calendars/CalendarEventRepository.php:186`
- `CalendarRepository::changes` and `AddressBookRepository::changes` have no callers. `path: app/Services/Calendars/CalendarRepository.php:269`, `path: app/Services/Contacts/AddressBookRepository.php:125`; `cmd: git grep -n -F -e "->changes(" origin/main -- packages/api/app packages/api/tests` lists neither
- JMAP push is pull-only. The event source answers once and closes, and `JmapPushStateResolver` computes each type's state per caller from the same per-collection token maps (notes, calendars, contacts, chat; tasks through `TaskListRepository::changes`). There is no server-side fan-out. `path: app/Services/Jmap/Push/JmapPushStateResolver.php:156`, `path: app/Http/Controllers/Api/V1/Jmap/JmapEventSourceController.php:1`
- The REST `/changes` routes for task lists, notebooks and chat channels compute their state with `computeInstancesState` over the accessible instances. `path: app/Services/Tasks/TaskListRepository.php:421`, `path: app/Services/Notes/NotebookRepository.php:505`, `path: app/Services/Chat/ChatChannelRepository.php:821`
- `FileNode/changes` uses one global sequence and rejects any state that is not all digits. Share grants do not appear in it. `path: app/Services/Jmap/Methods/FileNodeChangesMethod.php:44`, `path: app/Services/Jmap/Methods/FileNodeChangesMethod.php:51`
- There is no DAV-to-iMIP route: Sabre's `IMipPlugin` is not registered, and `CalendarImipService::deliver` is called only from the JMAP/REST scheduling path. A native client's invite to an external address ends with `5.2` today. `path: app/Dav/SabreServerFactory.php:124`, `path: app/Services/Calendars/CalendarSchedulingService.php:318`
- The delivery guard refuses with a `3.8` status and returns `false`; it sends nothing. `path: app/Dav/Server/CalendarScheduleDeliveryGuardPlugin.php:48`
- Sabre answers an unknown free/busy address with `3.7;Could not find principal`. `path: vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:852`
- Calendar `shareWith` writes are patches: only keys present are changed. Only `shareWith: null` revokes everything. `path: app/Services/Calendars/CalendarShareInvites.php:90`, `path: app/Services/Calendars/CalendarShareInvites.php:110`
- Drive merges `shareWith` too. `path: app/Services/Drive/DriveShareGrantWriter.php:26`
- Address books delete all shares on `null` and otherwise `updateOrCreate`. `path: app/Services/Contacts/AddressBookShareInvites.php:46`
- MCP `set` with `shareWith: null` loops `revokeShare` over the members it can list. `path: app/Mcp/McpMemberShareCommand.php:39`
- `AddressBookShareVisibility` has dismiss and restore, but no filter method like `rejectDismissedSharees`. `path: app/Services/Contacts/AddressBookShareVisibility.php:17`
- Drive has no dismissal or visibility filter. `DriveShareGrantResolver` resolves grants only. `path: app/Services/Drive/DriveShareGrantResolver.php:131`
- Sabre's schedule plugin reaches an attendee's calendar-home-set and schedule-inbox **through the node tree**. That is why `getChild` resolves every account. `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:89`; Sabre `scheduleLocalDelivery` and `getPropertiesForPath` in `path: vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:407`, `path: vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:233`
- The delivery guard runs at priority 90, before Sabre's local delivery at 100, so it can stop local delivery. `path: app/Dav/Server/CalendarScheduleDeliveryGuardPlugin.php:27`
- There is no VFREEBUSY code of our own. The stock plugin answers outbox free/busy through the protected `getFreeBusyForEmail`. `path: vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:740`, `path: vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:831`; `cmd: git grep -n -i "freebusy" origin/main -- packages/api/app` finds only JMAP property conversion
- `invitees()` takes no username. The same response carries `canSubmitEmail`. `path: app/Services/Calendars/CalendarSchedulingNotificationService.php:43`
- `presenceGroupRoom(slug)` exists and is unused. `path: presence-core/src/presence-types.ts:25`
- Membership is joined by hand in eight readers. `GroupDirectoryService::groupsForUser` runs one query per group. `path: app/Services/Settings/GroupDirectoryService.php:161`
- `administrators` is referenced in about ten files (API: `AdminRoleResolver`, `AdminConstants`, `InstallerSeeder`, `GroupDirectoryService`, `AdminGroupManagementService`; apps: admin-core, home state, mock bootstrap). `path: app/Services/Auth/AdminRoleResolver.php:11`; `cmd: git grep -l -E "ADMIN_GROUP_URI|groups/administrators|'administrators'" origin/main -- packages/api/app packages/apps/src`
- Contacts has one principal-sharing string among the vCard-group strings: `shareAddressBookPlaceholder: "Add people or groups"`. `path: contacts-core/src/contacts-labels.ts:302`. Share copy also lives in `share-ui/share-labels.ts:51` and `share-ui/share-principal-search-dropdown.tsx:34`.

**Presence**

- The `workspace` room admits every signed-in user; `groups.{slug}` rooms admit only members. `path: app/Services/Principal/PrincipalRoomAuthorizer.php:38`
- The client joins only `workspace`. `path: presence-core/src/presence-provider.tsx:99`, `path: presence-core/src/presence-provider.tsx:116`
- Presence is a peer-to-peer mesh, capped at 32 peers per principal room. `path: app/Services/Principal/PrincipalSignalingService.php:28`

**Write paths**

- `openDm` rejects only self, groups and unknown users. `path: app/Services/Chat/ChatChannelRepository.php:183`, route `path: routes/api.php:316`. MCP opens DMs through the same method. `path: app/Mcp/Tools/MeetChannelWriteTool.php:118`
- User sharees are checked only for existence in `CalendarShareInvites` (calendars, task lists, notebooks, Meet channels), `AddressBookShareInvites` and `DriveShareShareeCheck`. `path: app/Services/Calendars/CalendarShareInvites.php:158`, `path: app/Services/Contacts/AddressBookShareInvites.php:119`, `path: app/Services/Drive/DriveShareShareeCheck.php:51`
- MCP share tools go through `McpMemberShareCommand`. `path: app/Mcp/McpMemberShareCommand.php:1`

**Read chokepoints that hiding can reuse**

- Calendar-backed kinds (calendars, task lists, notebooks, chat channels) list through `accessibleInstances`, which ends in `CalendarShareVisibility::rejectDismissedSharees`. `path: app/Services/Calendars/CalendarCollectionAccess.php:40`, `path: app/Services/Calendars/CalendarShareVisibility.php:56`
- Lookup by id goes through `findReachable`, which applies the same filter. `path: app/Services/Calendars/CalendarCollectionAccess.php:184`
- Chat channels, DMs included, list through `accessibleInstances`. `path: app/Services/Chat/ChatChannelRepository.php:507`
- The CalDAV home drops dismissed sharee instances in `getCalendarsForUser`. `path: app/Dav/Server/WgwCalendarBackend.php:199`
- Address books have the same dismissal service. `path: app/Services/Contacts/AddressBookShareVisibility.php:12`, used by `path: app/Services/Contacts/AddressBookCollectionAccess.php:25`
- Drive member grants resolve in `DriveShareGrantResolver::resolveMemberGrant` and `memberShareRootPaths`; "shared with me" lists from `memberGrantRows`. `path: app/Services/Drive/DriveShareGrantResolver.php:131`, `path: app/Services/Drive/DriveShareGrantResolver.php:181`, `path: app/Services/Drive/DriveShareService.php:360`
- Collab joins check Drive read rights and notebook access, and re-check on signaling. `path: app/Services/Collab/CollabJoinAuthorizer.php:82`, `path: app/Services/Collab/DocCollabSignalingService.php:262`

**Scheduling**

- JMAP-side delivery: a recipient that resolves to a principal is delivered locally; others go to iMIP. `path: app/Services/Calendars/CalendarSchedulingService.php:314`
- Typed attendee addresses of local users are rewritten to the canonical address. `path: app/Services/Calendars/CalendarSchedulingService.php:128`
- DAV-side delivery uses stock `Schedule\Plugin`, with a guard on the `schedule` event. `path: app/Dav/SabreServerFactory.php:127`, `path: app/Dav/Server/CalendarScheduleDeliveryGuardPlugin.php:40`
- External invites can be turned off, and local scheduling then continues. `path: tests/Feature/Calendars/CalendarsSchedulingImipTest.php:286`

**Rename surface**

- Admin: "Users & Groups", "Groups", "New group", "Edit group", "Group name", toasts and errors. `path: admin-core/src/use-admin-sidebar-model.tsx:24`, `path: admin-core/src/admin-users-pane.tsx:126`, `path: admin-core/src/admin-workspace-modals.tsx:120`, `path: admin-core/src/admin-workspace-dialogs.tsx:286`, `path: admin-core/src/use-admin-group-mutations.tsx:35`, `path: admin-core/src/admin-group-directory.ts:4`
- Settings: "Groups" pane and "Groups you belong to". `path: settings-core/src/settings-memberships-pane.tsx:11`, `path: settings-core/src/register-builtin-settings.tsx:52`
- Share and move copy: `path: calendar-core/src/calendar-labels.ts:329`, `path: calendar-core/src/calendar-labels.ts:510`, `path: meet-core/src/meet-labels.ts:146`, `path: meet-core/src/meet-labels.ts:163`, `path: notes-core/src/notes-labels.ts:245`, `path: notes-core/src/notes-labels.ts:260`, `path: drive-core/src/drive-labels.ts:165`, `path: drive-core/src/drive-labels.ts:169`, `path: ui/owner-scope-labels.ts:18`, `path: lib/workspace-pwa-head.ts:58`, `path: lib/offline/docs/docs-body-sync.ts:71`
- Drive UI root "Groups" is both a label and a path segment. `path: drive-core/src/drive-path-utils.ts:7`, `path: drive-core/src/drive-path-utils.ts:87`, `path: drive-core/src/drive-breadcrumbs.ts:5`
- Contact groups use the word "Groups" for vCard groups. `path: contacts-core/src/contacts-labels.ts:172`
- API errors shown in the app: `path: app/Http/Controllers/Api/V1/Admin/GroupsController.php:23`, `path: app/Services/Admin/AdminGroupManagementService.php:74`, `path: app/Services/Calendars/CalendarRepository.php:98`
- 33 test, story or e2e files match the current Group copy. `cmd: git grep -l -E "Users & Groups|New group|Edit group|Group name|\"Groups\"|people or groups|Group created|\(Group\)" origin/main -- packages/apps/e2e packages/apps/src '*.test.*' '*.stories.*' | wc -l`
  ```text
  33
  ```

**Issues and specs**

- `feat/projects` treats a Project as a group principal and already calls `administrators` a "system Team". `path: .agents/specs/811-projects/spec.md:6` on branch `feat/projects`
- [#1614](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1614) asks for the same Team rule for attendee busy blocks. `gh issue view 1614`: "The caller gets busy periods only for users who share at least one Team with them"

- Item-level `/changes` fill `destroyed` for a collection that disappeared from the since-state by reading a per-viewer id registry that does not filter on visibility: `recordedEventIdsForCalendar`, `recordedCardIdsForBook`, `recordedNoteIdsForNotebook`. `path: app/Services/Calendars/JmapCalendarEventStateService.php:87`, `path: app/Services/Jmap/Methods/ContactCardChangesMethod.php:86`, `path: app/Services/Jmap/Methods/NoteChangesMethod.php:74`. `ChatMessage/changes` sends no per-message `destroyed` for a channel that disappeared; the client prunes by channel. `path: app/Services/Jmap/Methods/ChatMessageChangesMethod.php:26`
- Address book sync tokens are built from `AddressBookCollectionAccess::accessibleListings`, which already applies `AddressBookShareVisibility`. `path: app/Services/Contacts/AddressBookRepository.php:200`, `path: app/Services/Contacts/AddressBookCollectionAccess.php:31`
- The web app keeps the owner's `shareWith` in its offline cache (calendars, task lists, address books, channels). `path: packages/apps/src/lib/offline/calendars-offline-store.test.ts:68`

## Considered

- **Existing component reused:** the dismissal filter (`CalendarShareVisibility::rejectDismissedSharees`, `AddressBookShareVisibility`, the dismissed check in `WgwCalendarBackend::getCalendarsForUser`). It already hides a share on every read path without deleting it, and it has tests on the CalDAV home and on lookup by id. Hiding a non-colleague's share is the same operation with a computed set.
- **Revoke grants on membership change, re-create on rejoin:** rejected. It is destructive and cannot restore the access level. It also has to name every caller (review finding 2026-10-07): five membership write paths, plus DAV `group-member-set`.
- **Stored suspension rows written by a reconciler on membership change:** rejected. It is the same set of five write paths, and a missed one leaves stale state. A computed filter is correct on the next request by construction.
- **Filter in the UI only:** rejected. DM open, share writes and MCP accept any username today (What exists, Write paths).
- **One filtered `workspace` presence room:** rejected. Presence is a peer-to-peer mesh, so peers in one room see each other's roster and broadcasts, and the server cannot filter what peers send. Per-Team rooms already exist and are authorised by membership.
- **Rename code, API and DAV identifiers too:** rejected. It breaks DAV paths, OpenAPI clients and offline keys, and it collides with `feat/projects`.
- **Rename contact groups:** rejected. They are vCard groups, a different concept.
- **Default "Everyone" Team:** rejected by the product owner, 2026-11-04.
- **Per-Project access, or sharing a Project with a second Team:** rejected by the product owner, 2026-11-04. Teams are the access boundary; Projects are a filter.
- **Read-only archive for old DMs:** rejected by the product owner, 2026-11-04, in favour of hiding everything.
- **Blocking typed addresses of internal non-colleagues:** rejected by the product owner, 2026-11-04. A refusal would itself reveal that the address is internal.
- **Owner keeps an "Inactive" row for a hidden share, with a revoke action:** rejected by the product owner, 2026-11-04. The share is hidden from the owner too. Patch writes already leave hidden grants alone; only revoke-all touches them (see the merge-back line below).
- **Anonymise non-colleagues inside items you can open** ("Someone outside your Teams"): rejected by the product owner, 2026-11-04. Attendee addresses are in the iCalendar data that CalDAV clients read, comment authors are in the stored document, and a thread with anonymous authors is hard to follow. Names show; pickers and actions stay closed.
- **Docs threads in the visibility fingerprint:** not needed. A hidden document answers 404 on its thread routes. The existing problem that Docs threads never recover from `cannotCalculateChanges` is Bug #1930.
- **Admin stays a group principal, excluded in one place:** rejected by the product owner, 2026-11-04, in favour of making admin a real role (chunk J). The central rule then needs no exception. The old `administrators` group stays as an ordinary Team "Administrators", so no channel, calendar or file is lost.
- **Upgrade migration that puts every existing user in one Team, or the rule staying off until the first Team exists:** rejected by the product owner, 2026-11-04. "No Team now is no Team later": after the update, a user who is in no Team sees no colleagues until an admin adds them.
- **Milestone "Pioneer programme":** not set, by the product owner, 2026-11-04.
- **Sync-token bump per affected collection on membership change:** rejected. The fan-out is unbounded, and it is not needed.
- **A colleague-set fingerprint in every `/changes` state, plus a push on membership writes:** rejected after the second review. Push is pull-only, so there is nothing to push, and every state except FileNode is already a map keyed by the visible collections (What exists). Hiding a share changes that map on the next poll. Only FileNode needs extra state: a hash of the viewer's visible grants and their access levels, because its sequence is global (chunk E2). A Team-set fingerprint would also have been wrong: when C joins A's Team, A's Team set does not change, but A's colleagues do.
- **Admins who share the old "Administrators" Team see each other's presence and free/busy:** accepted by the product owner, 2026-11-04. It is a real Team. Fresh installs have no such Team.
- **DAV invites to non-colleagues via a new DAV-to-iMIP route:** rejected by the product owner, 2026-11-04. A non-colleague invited from a native client gets exactly what an external address gets today. The missing DAV-to-iMIP route is Bug #1929, for every external address.
- **Merge-back layer for every share write:** rejected after review. Calendar and Drive writes are already patches. Only the revoke-all paths matter, and there an explicit "share with nobody" also revokes hidden grants (least privilege: a later shared Team must not reopen something the owner closed).
- **One chunk E for every resource:** rejected after review. The calendar family reuses an existing filter. Drive and Docs have none, so they are their own chunk (E2).
- **A cap on presence rooms per user:** rejected. A user in N Teams polls N small rooms instead of one room of up to 32. Chunk F measures it and builds a combined poll in the same chunk only if 4 Teams poll more than twice today's rate.
- **Merging D and E1:** rejected. D is writes and E1 is reads; E1 is rebased on D instead.
- **Admins get free/busy for everyone:** rejected by the product owner, 2026-11-04 (in the Team availability session). Admins can find and invite anyone, but free/busy follows real Team membership.
- **Admins join every Team presence room:** rejected by the product owner, 2026-11-04. Presence rooms are a peer-to-peer mesh capped at 32 peers (`app/Services/Principal/PrincipalSignalingService.php:28`). Admins see presence in their own Teams only.

- **The owner's open app or offline cache updates its `shareWith` list when a grantee stops being a colleague:** rejected, 2026-11-04 (third review). The owner's collection does not change, so neither its state nor a poll moves. A cached sharee row stays until the owner's next fetch of that collection, the same lag a native CalDAV client has. It shows a name the owner already knew, and every write path goes through the server gate (chunk D) and the patch rule. Accepted and documented in the spec next to the native-client rule; chunk V checks the owner side after a reload.
- **FileNode `grantHash` over root paths:** rejected, 2026-11-04 (third review). Two grants can share a root path (two owners sharing the same Team folder, or a re-share with another level), so one hidden grant can leave the path set unchanged. `grantHash` hashes the sorted `(grant id, access)` pairs of the viewer's resolved, visible member grants. The access level is in the hash because `DriveShareGrantWriter` updates `access` in place on the same row and does not touch `change_seq` (`path: app/Services/Drive/DriveShareGrantWriter.php:107`): with ids only, a grant going from `read` to `readwrite` would leave the grantee's cache on the old level. Including it also closes that existing gap.

- **Admins reach everyone with DM and share, and hiding exempts admin-owned shares:** rejected by the product owner, 2026-11-04 (PR review). With hiding checked on the recipient's side, an admin's DM to someone outside the admin's Teams was accepted and then never shown. A DM or share from an admin reaches only people in the admin's own Teams; admins still find and invite everyone.
- **FileNode grant hash only in the StateChange string, or the push basis set to the global seq:** rejected (PR review). The first never wakes an open app, because the event id is built from the basis. The second wakes every browser on any file write, which `docs/architecture/jmap-push.md` is designed to avoid.

## Affected packages

- `packages/api`
- `packages/apps`
- `docs` (only if the product owner wants it)

## Dependencies

1. Epic #1915 is filed under WeGotWorkspace/Product#114, with one Task per chunk (see each chunk's **Issue**). No milestone.
2. Chunks A (rename), B (colleague resolver) and J (admin role) start in parallel. J must land before F and before chunk V: until J, `administrators` is still a group, so admins would share its presence room.
3. C, D, F and H need B. E1 needs B and is rebased on D. E2 needs B and E1 (same filter pattern). G needs H, because a 404 from `getChild` breaks Sabre's local delivery unless H's guard has already stopped local delivery to that recipient.
4. I needs C and H.
5. `feat/projects` rebases onto main after A and J.
6. Team availability and #1614 build on B, and on H's schedule-plugin subclass.

## Open decisions

None — every choice for this work is made. The former OD1–OD3, the review blockers BL1–BL5 and the third-review points (owner cache lag, `grantHash` over grant ids and access levels on every FileNode method and in the push basis, admin DMs and shares only within own Teams) were settled on 2026-11-04; see Considered.

## Admin rule

One paragraph, so that every chunk applies the same rule. Admin is a **role**, not a Team (chunk J). An admin **finds and invites everyone**: people lists, the attendee picker, calendar invites (delivered locally), and the CalDAV group directory and principal lookup. For **DMs, shares, presence and free/busy** an admin follows real Team membership, as for any user. Decided 2026-11-04 after the PR review: a DM or share from an admin reaches only people in the admin's own Teams. Otherwise the recipient would never see it, because hiding is checked on the recipient's side. In code, the first group of checks calls `isColleague`. The second calls `sharesTeamIgnoringAdminRole` (or `assertMayShareWith` / `isOwnTeam`, which use the same membership). No other variant exists.

| Surface | Chunk | Check |
|---|---|---|
| Scheduling invitees: attendee picker, mentions | C | `isColleague` |
| DM rail and share dialogs (`sharesTeam` flag), Drive share principals | C | `sharesTeamIgnoringAdminRole` |
| DM open, share writes, group sharee | D | `assertMayShareWith`, `isOwnTeam` (admins too) |
| Hidden shares, owner share lists | E1, E2 | `sharesTeamIgnoringAdminRole` |
| Presence rooms | F | own Teams only (admins too) |
| `principals/groups/`, `group-member-set`, `principals/{user}` | G | `isColleague` / own Teams (admins: all) |
| iTIP: JMAP → iMIP; DAV → same result as an external address | H | `isColleague` |
| VFREEBUSY, availability, #1614 | H | `sharesTeamIgnoringAdminRole` |

**Two layers.** A 404 on `principals/{user}` (G) and a name shown in a channel's member list (E1, I) are not in conflict. G closes the directory, the place where you discover people. Names inside an item you can already open are the content of that item.

**Not transitive.** A shares T1 with B, and B shares T2 with C. A and C are not colleagues. Every check is relative to the viewer, and nothing is cached across viewers or requests.

## Invariants

- Dismissing and restoring a share keeps working, and restore does not bring back a hidden share. A wrong change in the shared filter breaks dismissal on DAV or by id. Proof: `path: packages/api/tests/Feature/Calendars/CalendarShareDismissTest.php` assertions `test_dismissed_calendar_is_gone_from_the_caldav_home`, `test_dismissed_calendar_no_longer_resolves_by_id`, `test_restoring_a_dismissed_calendar_brings_access_back`
- Team members keep seeing Team-owned items. A colleague filter applied to group-owned instances would hide every Team calendar. Proof: `path: packages/api/tests/Feature/Calendars/CalendarMetadataStateTest.php` assertion `test_group_calendar_rename_reaches_every_member`, `path: packages/api/tests/Feature/Calendars/CalendarFeedBindingTest.php` assertion `test_every_group_member_sees_and_can_revoke_the_group_calendar_feed`
- DM open between colleagues keeps working, and self, group and unknown targets stay rejected. Proof: `path: packages/api/tests/Feature/Chat/ChatDmsTest.php` assertions `test_open_dm_provisions_channel_shared_to_both_sides`, `test_open_dm_rejects_self_groups_and_unknown_principals`
- Collab joins stay denied without a grant, and a hidden share is denied like a missing one. Proof: `path: packages/api/tests/Feature/Collab/CollabJoinAuthorizationTest.php` assertion `test_join_denied_for_other_users_private_doc_room_without_share_grant`
- Removed Team members lose the Team presence room. Proof: `path: packages/api/tests/Feature/Principal/PrincipalRoomAccessTest.php` assertions `test_a_removed_member_can_no_longer_poll_the_group_room`, `test_a_removed_member_gets_no_relay_credentials`
- External attendees still get iMIP and not a local copy, and turning external invites off still keeps local scheduling between colleagues. Proof: `path: packages/api/tests/Feature/Calendars/CalendarsSchedulingImipTest.php` assertions `test_external_attendee_receives_imip_and_not_local_inbox`, `test_external_invites_disabled_skips_mail_and_keeps_local_scheduling`
- Drive principal search still finds groups by name and excludes the container principal, now limited to the caller's own Teams. Proof: `path: packages/api/tests/Feature/Drive/DriveSharePrincipalsTest.php` assertions `test_principals_search_finds_groups_by_name`, `test_principals_search_excludes_groups_container_principal`
- Admin management keeps working. Removing someone's admin role still revokes their refresh token, and an admin cannot remove their own role. Proof: `path: packages/api/tests/Feature/Admin/AdminGroupsTest.php` assertions `test_patch_administrators_members_revokes_removed_member_refresh_token`, `test_admin_cannot_remove_self_from_administrators` (J moves them to the role, with the same assertions)
- After chunk A, the app works with only the copy changed: no route, path or API field changed. Proof: `cmd: git diff --stat origin/main -- packages/api/routes packages/api/openapi packages/openapi-types` is empty for chunk A, and `cmd: pnpm --dir packages/apps exec vitest run` passes.
- After chunk B, behaviour is unchanged until a consumer chunk lands. `DriveGroupResolver` and `groupsForUser` return the same results through the new reader. Proof: `cmd: composer --working-dir packages/api done-gate`
- After chunk J, every current admin is still admin and every current member of `administrators` still sees its channel, calendar and files. Proof: a migration test in J, plus `cmd: composer --working-dir packages/api done-gate`
- After each of C–I, main works without the later chunks. Proof: `cmd: composer --working-dir packages/api done-gate` per chunk PR.

## Chunks

### Chunk A: Rename Groups to Teams in user-facing copy

- **id:** `team-rename-copy`
- **Issue:** #1916
- **Skill:** apps-ui
- **Inputs:** the rename surface in What exists; Drive root label and path share one constant — `path: drive-core/src/drive-path-utils.ts:7`; contact groups stay, except the principal-sharing placeholder — `path: contacts-core/src/contacts-labels.ts:172`, `path: contacts-core/src/contacts-labels.ts:302`; share copy in five places — `path: share-ui/share-labels.ts:51`, `path: calendar-core/src/calendar-labels.ts:510`, `path: notes-core/src/notes-labels.ts:245`, `path: meet-core/src/meet-labels.ts:163`
- **Done when:**
  - Every string listed under What exists, Rename surface, says Team or Teams ("Users & Teams", "New team", "Team name", "Add people or teams…", "{name} (Team)", "Teams you belong to").
  - `contacts-labels.ts:302` says "Add people or teams". The vCard-group strings in the same file are unchanged.
  - The share copy ("Add people or teams…", "No people or teams found", the hint) comes from one source in `share-ui/share-labels.ts`. The app label modules reference it instead of copying it.
  - Drive and Docs show "Teams" as the root label, while paths, URLs and offline keys still use `Groups/`. The label and the path segment are separate constants.
  - Every PHP error message that the app shows and that says "Group" says "Team" (`cmd: git grep -n -i -E "'[^']*\bgroups?\b[^']*'" -- packages/api/app | grep -E "Exception\("`). Error codes are unchanged.
  - Tests, stories and e2e selectors are updated in the same PR.
  - Screenshots of Admin, Settings, one share dialog and the Drive sidebar, for review by the product owner (visible UI).
- **Verify with:** `pnpm --dir packages/apps exec vitest run`; `pnpm --dir packages/apps exec tsc -p tsconfig.typecheck.json --noEmit`
- **Parallel with:** B, J

### Chunk J: Admin becomes a role

- **id:** `admin-role`
- **Issue:** #1925
- **Skill:** api, apps-ui
- **Inputs:** `path: app/Services/Auth/AdminRoleResolver.php:11`, `path: app/Services/Admin/AdminConstants.php:12`, `path: app/Services/Installer/InstallerSeeder.php:92`, `path: app/Services/Settings/GroupDirectoryService.php:224`; admin UI — `path: admin-core/src/admin-workspace-dialogs.tsx:286`
- **Done when:**
  - Admin is stored as a role per user, not as membership of `principals/groups/administrators`. `AdminRoleResolver::isAdmin` reads the role.
  - A wgw migration gives the role to every current member of `administrators`. It leaves the group and its members in place as an ordinary Team named "Administrators", with its channel, calendar, Drive and address book. The migration's `down()` restores the membership rule, or says in the migration that it is one-way.
  - The installer gives the first user the role. It no longer creates an `administrators` group.
  - Admin UI: a user's admin toggle replaces the `administrators` group membership. The old Team "Administrators" shows like any Team and can be renamed or deleted (deleting it no longer touches anyone's role).
  - Removing the role still revokes that user's refresh tokens. An admin still cannot remove their own role, and the last admin cannot be removed.
  - `AdminGroupsTest` cases about `administrators` move to the role, with the same assertions.
  - Screenshots of the admin toggle for review by the product owner (visible UI).
- **Verify with:** `composer --working-dir packages/api done-gate`; `pnpm --dir packages/apps exec vitest run src/admin-core`
- **Parallel with:** A, B

### Chunk B: Colleague resolver

- **id:** `colleague-resolver`
- **Issue:** #1917
- **Skill:** api
- **Inputs:** membership readers — `path: app/Services/Drive/DriveGroupResolver.php:14`, `path: app/Services/Settings/GroupMembershipResolver.php:25`, `path: app/Services/Settings/GroupDirectoryService.php:161`; admin check — `path: app/Services/Auth/AdminRoleResolver.php:16`
- **Done when:**
  - A `TeamColleagues` service exposes:
    - `colleagues(viewer)`, which returns a `ColleagueSet` value object with `isUnrestricted()`, `contains(username)` and `usernames()`. It is never `null`.
    - `isColleague(viewer, username)`, where admins are colleagues of everyone
    - `sharesTeamIgnoringAdminRole(viewer, username)`, real Team membership for admins too: DMs, shares (writes, pickers, hiding), presence and free/busy
    - `isOwnTeam(viewer, groupSlug)`, real membership for admins too
    - `assertMayShareWith(viewer, username)`, which refuses unless `sharesTeamIgnoringAdminRole` and throws the same exception as the existing unknown-user paths
  - The Admin rule table in this plan is copied into the class docblock.
  - One query (a self-join on `groupmembers`) computes the set, memoised per request. Nothing is cached on a singleton or across requests.
  - `DriveGroupResolver::allowedGroupSlugs` and `GroupDirectoryService::groupsForUser` delegate to the same membership reader. `groupsForUser` becomes one query.
  - Feature tests cover: shared Team, no shared Team, no Team at all, admin (colleague of everyone, `sharesTeamIgnoringAdminRole` false outside own Teams), self, non-transitivity (A–B–C across two Teams), and a membership change taking effect on the next request.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** A, J

### Chunk C: Filter people directories

- **id:** `people-directory-filter`
- **Issue:** #1918
- **Skill:** api, apps-ui
- **Inputs:** invitees without a username parameter, sharing a response with `canSubmitEmail` — `path: app/Services/Calendars/CalendarSchedulingNotificationService.php:43`; Drive principals — `path: app/Services/Drive/DriveSharePrincipalDirectoryService.php:21`
- **Done when:**
  - `invitees(string $username)` returns only colleagues; admins get everyone. Each entry carries `sharesTeam: boolean` (always true for non-admins). `canSubmitEmail` is unchanged. The controller passes the caller.
  - Drive principals return only people who share a Team with the caller and own Teams, admins included (they only feed share dialogs). Any `LIKE ... ESCAPE` stays valid on MySQL and SQLite.
  - OpenAPI descriptions of both endpoints state the rule.
  - Feature tests per endpoint, for a non-admin and an admin.
  - One server filter covers the DM rail, mentions, the attendee picker and the share dialogs (`path: lib/api/wgw/meet-chat-directory.ts:47`, `path: lib/api/wgw/calendar.ts:272`). Small client change: the DM rail and share dialogs offer only entries with `sharesTeam: true`, the attendee picker and mentions offer all. Vitest covers the filter.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** D, F, H

### Chunk D: Gate DM open and every share write

- **id:** `interaction-gates`
- **Issue:** #1919
- **Skill:** api, security
- **Inputs:** `path: app/Services/Chat/ChatChannelRepository.php:183`, `path: app/Services/Calendars/CalendarShareInvites.php:158`, `path: app/Services/Contacts/AddressBookShareInvites.php:119`, `path: app/Services/Drive/DriveShareShareeCheck.php:51`, `path: app/Mcp/McpMemberShareCommand.php:39`, `path: app/Mcp/Tools/MeetChannelWriteTool.php:118`
- **Done when:**
  - The PR description names every caller of the four sharee checks: REST, JMAP `*/set shareWith`, MCP share tools and MCP DM.
  - Each refuses a user who shares no Team with the caller, and a group that is not one of the caller's own Teams, admins included, with a response byte-identical to the unknown case. There is a test per write path, for a non-admin and an admin caller.
  - Existing grants are not touched.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** C, F, H

### Chunk E1: Hide shares from non-colleagues — calendar family and address books

- **id:** `hide-shares-caldav-carddav`
- **Issue:** #1920
- **Skill:** api
- **Inputs:** `path: app/Services/Calendars/CalendarShareVisibility.php:56` (viewer side, also used by `findReachable`), `path: app/Dav/Server/WgwCalendarBackend.php:199` (CalDAV home), `path: app/Services/Jmap/Methods/CalendarChangesMethod.php:52` and `path: app/Services/Jmap/Push/JmapPushStateResolver.php:156` (states keyed by visible collections), `path: app/Services/Contacts/AddressBookShareVisibility.php:17` (no filter method yet), `path: app/Services/Contacts/AddressBookCollectionAccess.php:25`, `path: app/Services/Calendars/CalendarShareInvites.php:90` (revoke-all), `path: app/Mcp/McpMemberShareCommand.php:39`
- **Done when:**
  - `CalendarShareVisibility` gets `rejectHiddenSharees(viewer, instances)` next to `rejectDismissedSharees`. It drops sharee instances whose owner is a user principal who shares no Team with the viewer (`sharesTeamIgnoringAdminRole`, admins included). `accessibleInstances`, `findReachable` and `WgwCalendarBackend::getCalendarsForUser` apply both filters. That covers calendars, task lists, notebooks and Meet channels, DMs included.
  - `AddressBookShareVisibility` gets the same pair of filters, applied in `AddressBookCollectionAccess` and on the CardDAV home.
  - Owner side: the `shareWith` map that the owner reads (JMAP, CalDAV sharee properties, MCP listing) omits sharees who share no Team with the owner (admins included).
  - Test: an existing DM or calendar share between an admin and a user outside the admin's Teams is hidden for both and comes back when they share a Team.
  - Patch writes of `shareWith` leave hidden grants untouched (test). Revoke-all (`shareWith: null` on calendars and address books, MCP `set` with `shareWith: null`) also revokes hidden grants, and OpenAPI says so.
  - Team-owned items are never filtered. Restoring a dismissed share does not bypass hiding.
  - Tests show that after a membership change, with no other write, these report the hidden collection as destroyed and the returning one as created: JMAP `Calendar/changes` (`CalendarChangesMethod`), `AddressBook/changes`, the push state from `JmapPushStateResolver`, and the REST `/changes` routes for task lists, notebooks and chat channels (`computeInstancesState`).
  - Item level: `CalendarEvent/changes`, `ContactCard/changes` and `Note/changes` list every item of the hidden collection in `destroyed` and every item of the returning one in `created`. The id registries (`recordedEventIdsForCalendar`, `recordedCardIdsForBook`, `recordedNoteIdsForNotebook`) stay unfiltered; a test fails if a visibility filter is added to them. `ChatMessage/changes` keeps its documented behaviour (no per-message `destroyed`; the client prunes by channel), covered by one test.
  - A test shows that `AddressBookRepository::syncTokens` drops a hidden address book, through `AddressBookCollectionAccess`.
  - The dead `CalendarRepository::changes` and `AddressBookRepository::changes` are removed.
  - Known behaviour, stated in OpenAPI and in the issue: native CalDAV and CardDAV clients remove their local copy of a hidden collection and sync it again when it comes back. Nothing is deleted on the server. On the owner's side, an open app or offline cache keeps a hidden sharee in `shareWith` until its next fetch of that collection (see Considered).
  - No grant row is deleted or updated outside revoke-all (tests assert row counts).
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** F, H (rebased on D)

### Chunk E2: Hide shares from non-colleagues — Drive and Docs

- **id:** `hide-shares-drive-docs`
- **Issue:** #1926
- **Skill:** api
- **Inputs:** `path: app/Services/Jmap/Methods/FileNodeChangesMethod.php:51` (digits-only guard), `path: app/Services/Drive/DriveShareGrantResolver.php:131`, `path: app/Services/Drive/DriveShareGrantResolver.php:181`, `path: app/Services/Drive/DriveShareService.php:360`, `path: app/Services/Drive/DriveShareAuthorizer.php:28`, `path: app/Services/Collab/CollabJoinAuthorizer.php:82`, `path: app/Services/Collab/DocCollabSignalingService.php:262`, `path: app/Services/Drive/DriveShareGrantWriter.php:26`
- **Done when:**
  - A new filter in `DriveShareGrantResolver` drops member grants whose share owner is a user who shares no Team with the viewer (admins included). `resolveMemberGrant`, `memberShareRootPaths` and `DriveShareService::memberGrantRows` use it, so "shared with me", path access, JMAP FileNode, WebDAV and collab joins follow.
  - Owner side: the owner's grant list and access panel omit grantees who share no Team with the owner (admins included). `mergeShareWith` keeps hidden grants. A revoke-all of a share revokes hidden grants too.
  - The FileNode state is `<seq>.<grantHash>` on every method that returns it: `FileNode/get` (`path: app/Services/Jmap/Methods/FileNodeGetMethod.php:95`), `FileNode/changes`, `FileNode/set` including the `ifInState` guard (`path: app/Services/Jmap/Methods/FileNodeSetMethod.php:45`), `FileNode/query` (`path: app/Services/Jmap/Methods/FileNodeQueryMethod.php:100`) and the push StateChange value. Otherwise the Drive client's `fullResync` stores a bare digit token and every later sync resets the tree.
  - `grantHash` is a 128-bit hash (as `JmapPushEventId::hash`) of the sorted `(grant id, access)` pairs of the viewer's resolved, visible member grants (not their root paths; see Considered).
  - A matching `grantHash` gets a normal delta from the seq prefix. A different one answers `cannotCalculateChanges`. A legacy all-digit state answers `cannotCalculateChanges`, so each client resyncs FileNode once after the deploy.
  - The push event-id basis (`path: app/Services/Jmap/Push/JmapPushStateResolver.php:173`) keeps the root-marker composite and appends the sorted `(grant id, access)` pairs. The event source wakes an open app only when that hash changes (`path: app/Http/Controllers/Api/V1/Jmap/JmapEventSourceController.php:49`). The basis does not become the global seq, which would wake every browser on any file write.
  - Tests: hiding one of two grants on the same root path, and a grant going from `read` to `readwrite`, each give `cannotCalculateChanges` and, with no file write, put `FileNode` in the next event-source response. After a resync, `FileNode/get` returns the new form and the next `FileNode/changes` is a delta.
  - The FileNode rows in `docs/architecture/jmap-push.md` are updated.
  - A hidden document answers its thread routes (`files/threads/*`) exactly as an unknown document. The thread state itself is unchanged.
  - A live Docs or Notes collab session is dropped on the next signaling check (`pnpm test:collab-api`).
  - Guest links and public links are unaffected.
  - No grant row is deleted or updated outside revoke-all (tests assert row counts).
- **Verify with:** `composer --working-dir packages/api done-gate`; `pnpm test:collab-api`
- **Parallel with:** F, G, H (after E1)

### Chunk F: Presence per Team

- **id:** `presence-team-rooms`
- **Issue:** #1921
- **Skill:** api, apps-ui
- **Inputs:** `path: app/Services/Principal/PrincipalRoomAuthorizer.php:38`, `path: presence-core/src/presence-provider.tsx:99`, `path: presence-core/src/presence-types.ts:25` (unused `presenceGroupRoom`), `path: presence-core/src/presence-store.ts:457`
- **Done when:**
  - The server refuses `workspace` for everyone, admins included.
  - The client joins one `presenceGroupRoom(slug)` room per own Team, merges rosters by username, and rejoins when the Team list in `settings/state` changes.
  - Vitest covers the roster merge; API tests cover the refusal.
  - Own browser e2e with two users in different Teams shows that they do not see each other's presence.
  - Load check in the PR: steady-state polls per minute for a user in 1 and in 4 Teams, against today's one `workspace` room. If 4 Teams poll more than twice today's rate, a combined poll for all of a user's rooms goes into this chunk. Otherwise no combined poll is built, now or later.
- **Verify with:** `composer --working-dir packages/api done-gate`; `pnpm --dir packages/apps exec vitest run src/presence-core`
- **Parallel with:** C, D, E1, H

### Chunk G: DAV group directory and principal lookup

- **id:** `dav-group-directory`
- **Issue:** #1922
- **Skill:** api, security
- **Inputs:** `path: app/Dav/Server/GroupPrincipalContainer.php:39`, `path: app/Dav/Server/GroupPrincipalContainer.php:58`, `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:57`, `path: app/Dav/Server/AppCalDAVPrincipalCollection.php:89` (why `getChild` resolves every account)
- **Done when:**
  - `principals/groups/` lists only own Teams for non-admins; admins see every Team.
  - A Team's `group-member-set` is readable only by its members and by admins.
  - `principals/{user}` for a non-colleague returns the same 404 as for an unknown user. The filter sits on the collection node (`getChild`, `childExists`). The principal backend stays unfiltered.
  - The comment at `AppCalDAVPrincipalCollection.php:89` is **updated, not removed**. It says that `getChild` now resolves colleagues only, and that delivery to non-colleagues never reaches it because H's guard stops local delivery to them first.
  - Tests: a CalDAV invite to a colleague is delivered locally; one to a non-colleague leaves no copy in that user's inbox and gets the same schedule-status as an external address in the same request (the test compares the two, it does not pin a code; the code follows Bug #1929); an admin's invite to anyone is delivered locally.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** E2 (after H)

### Chunk H: Scheduling and free/busy as external guest

- **id:** `scheduling-as-guest`
- **Issue:** #1923
- **Skill:** api, security
- **Inputs:** `path: app/Services/Calendars/CalendarSchedulingService.php:314`, `path: app/Services/Calendars/CalendarSchedulingService.php:128`, `path: app/Dav/Server/CalendarScheduleDeliveryGuardPlugin.php:27`, `path: app/Dav/SabreServerFactory.php:127`; Sabre `getFreeBusyForEmail` — `vendor/sabre/dav/lib/CalDAV/Schedule/Plugin.php:831`
- **Done when:**
  - JMAP delivery (`deliver`) sends to a non-colleague through iMIP; when external invites are off, it is skipped like any external address.
  - DAV delivery: the guard (priority 90, before Sabre's local delivery at 100) stops local delivery to a non-colleague, and the recipient's schedule-status is the one an external address gets today. No DAV-to-iMIP route is built here (Bug #1929).
  - Typed addresses of non-colleagues are not canonicalised.
  - Free/busy is **new code**: this is the first change on the outbox route. A `WgwSchedulePlugin extends Sabre\CalDAV\Schedule\Plugin` overrides `getFreeBusyForEmail`. For a user who shares no Team with the caller (`sharesTeamIgnoringAdminRole`, so admins too), it answers exactly as for an unknown address. `SabreServerFactory` registers the subclass. #1614 builds on the same subclass.
  - Existing `CalendarsSchedulingImipTest` cases still pass. New tests post a real VFREEBUSY request to the outbox and assert behaviour, not method calls: a colleague gets busy blocks; a non-colleague and an admin outside their Teams get `request-status` `3.7;Could not find principal`, byte-identical to an unknown address.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** C, D, E1, F

### Chunk I: Empty states and copy for "no Team yet"

- **id:** `no-team-empty-states`
- **Issue:** #1924
- **Skill:** apps-ui
- **Inputs:** DM rail and share pickers read invitees — `path: lib/api/wgw/meet-chat-directory.ts:47`, `path: lib/api/wgw/calendar.ts:272`; Settings memberships pane — `path: settings-core/src/settings-memberships-pane.tsx:11`
- **Done when:**
  - Member lists, attendee lists and comment authors show non-colleagues by name, without "message" or "share" actions.
  - A user with no Team sees "You're not in a Team yet. Ask your admin to add you." in the DM rail, in share and attendee pickers, and in Settings → Teams.
  - A picker with no match says "No people or teams found", without hinting that more users exist.
  - Stories cover both states. Screenshots for review by the product owner.
- **Verify with:** `pnpm --dir packages/apps exec vitest run`; Storybook build
- **Parallel with:** none (after C and H)

### Chunk V: Cross-chunk verify

- **id:** `teams-visibility-verify`
- **Skill:** testing
- **Done when:** the verifier returns `PASS` or `PASS_WITH_NITS` (prompt from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md)), and the parent ran [done-checklist](../../skills/developer/done-checklist.md). Own browser e2e with two admins (in no shared Team) and four users (A–B share T1, B–C share T2, D is alone). It checks every surface in the Admin rule table (admins find and invite everyone but cannot DM or share outside their Teams), non-transitivity (A and C), admin-to-admin presence and free/busy (none on a fresh install; present on an upgraded instance where both admins are in the old "Administrators" Team), and hidden shares coming back when D joins T1. It runs once on a fresh install and once on an instance upgraded from main. It includes a second tab, a refresh on the owner's side while a share is hidden (the hidden sharee is gone from the owner's share dialog after the reload), and a native CalDAV client (DAVx⁵ or Apple Calendar) seeing a hidden calendar disappear and come back.
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `composer done-gate`, per chunk B–J
- [ ] An existence-oracle test per write path and for `principals/{user}` and VFREEBUSY: the unknown and non-colleague responses are equal
- [ ] Hiding: every read path, comeback after a shared Team, `/changes` destroyed/created without another write (JMAP, push state, REST), FileNode resync when the `(grant id, access)` hash changes, an open app woken by an access change, collab drop, no grant row changed outside revoke-all
- [ ] Admin role migration: current admins stay admin, and the old group stays a working Team
- [ ] UI: copy rename with updated selectors and one share-copy source; admin toggle; empty-state stories; presence roster merge in Vitest
- [ ] Own e2e (chunk V)

## Release note

- For existing instances: after the update, a user who is in no Team sees no colleagues and no shares from users, until an admin adds them to a Team. Admins keep DMs and shares only with people in their own Teams. Admins become a role; the old "Administrators" group stays as a Team. Goes into the changelog and the pioneer update notes.

## Doc updates (only if user wants)

- `docs/architecture/team-visibility.md`: the colleague rule, the Admin rule table, and the list of enforcement points

## Removed since previous revision

- `Chunk E: Hide shares from non-colleagues on read` was split: renamed Chunk E → Chunk E1 (calendar family and address books), plus a new Chunk E2 (Drive and Docs), after the external review found that Drive has no visibility filter to reuse.

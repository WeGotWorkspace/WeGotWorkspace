Source: #2392 (body-hash: 8df45896)
Goal: WeGotWorkspace/Product#155

# Per-member sharing only on personal collections

Technical translation of Epic #2392. Decisions were made with the product lead on 2026-11-26 and are listed in the Epic body. This spec turns them into one API rule, one migration, one UI rule and one confirm-dialog change, and lists what is still open.

## Goal

A collection owned by a Team (including the four default collections of a Project) cannot carry a grant to a single person. Access to it comes from Team membership only. Personal collections keep per-person sharing. The rule is enforced in the API for every app and every entry point (REST, JMAP, MCP, DAV), not only by hiding the UI section. Existing per-person grants on Team-owned collections are removed once by a migration. Moving a personal collection into a Team drops its per-person grants, and the confirm dialog says so before the move.

## Terms

- **Team-owned collection:** the owner principal is `principals/groups/<slug>` (`GROUP_PREFIX`). Projects own their collections through the Team, so Project collections are Team-owned too (they carry a `projectId` on top).
- **Per-person grant:** a share to a user principal `principals/<username>`. In JMAP this is a `shareWith` key without the `groups/` prefix.
- **Team grant:** a share to a Team principal (`shareWith` key `groups/<slug>`). The Epic says "per-member"; Team grants are out of scope (D1).
- **Where grants live:**
  - Calendars, task lists, notebooks, chat channels: one extra `calendarinstances` row per grantee on the same `calendarid` (`access` 2 read or 3 read-write, `principaluri` = grantee, `share_href`). The owner row has `access` 1 (`SHAREDOWNER`).
  - Address books: rows in `addressbook_shares` (`addressbookid`, `principaluri`, `access`). CardDAV has no sharing, so these grants are visible only in the browser app and JMAP.
  - Drive: `drive_share_grants`. Out of scope.

## Non-goals

- Drive per-document access (Drive, Docs share dialog): unchanged.
- Guests and external people; who counts as a team admin.
- A viewer role inside a Team.
- Per-person availability choices (Settings → Calendar → Availability stay personal, also for Team calendars).
- Calendar event invitees (attendees of one event) and task assignees: these are not collection grants.
- Renaming or restructuring Team membership screens.

## Affected packages

- packages/api (share rule, owner move, migration, JMAP/MCP/DAV entry points)
- packages/apps (shared `CollectionShareSection`, the dialogs of Calendar, Tasks, Notes, Meet, the Project dialog, owner-move confirm copy)
- docs (this spec only)

## Rule

1. **Refuse (hard block).** When the target collection is Team-owned, a `shareWith` patch that grants a user principal is refused with HTTP 403 `forbidden` ("Team collections are shared through the Team."). Revoking (`null` grant for a user, or `shareWith: null`) is always allowed, so a leftover grant can still be removed.
2. **One rule, two choke points.** All apps already funnel shares through `CalendarShareInvites::apply` (Calendar, Tasks, Notes, Chat channels) or `AddressBookShareInvites::apply` (Contacts). REST, JMAP and MCP reach those through the repositories' `update()`/`create()`, so the rule lives in one shared helper that both `apply` methods call. DAV (CalDAV `CS:share`/`DAV:share-resource`) enters through `TeamGatedSharingPlugin::shareResource`, which needs the same helper.
3. **Create path.** `create()` also accepts `shareWith` on a new collection (`CalendarRepository` create path). Creating a Team-owned collection with `shareWith` is refused by the same rule.
4. **Move into a Team.** `transferOwner` (calendars, task lists, notebooks, chat channels) changes only `principaluri` today; grants stay untouched (a comment in `TaskListRepository` and `NotebookRepository` says so). The new behaviour: when the new owner is a Team, remove all per-person grants of that collection in the same transaction as the owner change. Moving between Teams or to personal has nothing to drop.
5. **Migration.** One data migration deletes per-person grants on every Team-owned collection (both storage shapes above). It is idempotent and has no `down`. Revoked grantees lose access immediately; no notification is sent (see D6).
6. **UI.** The per-person section (titled "Team access" in `workspaceLabels.sharing.teamAccess`, which is a misleading name for a section that lists individual people) is not rendered for Team-owned collections. This covers the Calendar, Tasks, Notes and Meet collection dialogs and the Project dialog. The default collection of a Project follows the same rule; this replaces the UI-only lock that today hides the pencil.
7. **Confirm dialog.** The owner-move confirm dialogs name the loss when the collection has per-person grants and the target is a Team (Calendar dialog, Project dialog for Tasks/Notes, Meet channel dialog). Wording is part of the UI slice; the dialog shows the count or names of the people who lose access.

## Technical constraints

- OpenAPI: no new field. The refusal is a documented 403 on the existing PATCH/`/set` responses; the OpenAPI file and typegen are updated for it. The UI decides to hide the section from `groupSlug` (already in every collection response), not from `myRights.mayShare`: Team members sit on `SHAREDOWNER`, and `mayShare` also gates other behaviour, so its meaning is not repurposed.
- A user who is a Team admin keeps all other rights; only the per-person grant ability is removed.
- The rule must not break existing flows that write grants internally: chat DM channels are personal (`$groupSlug` null) and use `apply` to add the peer; Project collections are created by `ProjectCollections` which bypasses client guards. Neither writes per-person grants on a Team-owned collection.
- The migration must not run the Sabre invite code (it needs an authenticated caller); it deletes rows directly, like the other data migrations in `database/migrations/wgw/`.
- No change to Team membership resolution: Team members keep access through the group principal, so removing grants does not touch them.

## Edge cases

- **Revoke on a Team collection** stays allowed (clean-up path, also used by the migration's logic in tests).
- **Grant row without a principal** (a refused or unknown-address share Sabre stored as invalid): these rows give nobody access but still sit in `calendarinstances`. The migration removes them too on Team-owned collections.
- **Hidden grants** (a sharee who no longer shares a Team with a personal owner, Epic #1915) are different from this rule. The migration deletes by owner type, not by visibility, so hidden rows on Team-owned collections go as well.
- **Personal → Team → personal.** The grants are gone after the first move and are not restored by moving back. The dialog says so.
- **Per-item moves** (a task to another list, an event to another calendar; `TaskRepository::resolveMoveTarget`, `CalendarEventMutationSupport` patch target): grants live on the collection, not on the item, so an item moved into a Team collection stops being visible to people who only had a grant on the source. Nothing is copied. The reverse (a Team item moved into a personal collection that is shared with someone) makes Team content visible to that person. See D4.
- **Subscribed (read-only) calendars** have no owner change and no grants; unaffected.
- **Meeting rooms.** A meeting room started with a Team is not a Team collection (`assertMayAddChannelToTeam`: every member may open one), but it is stored under the Team principal. See D3.
- **Live sessions.** Docs and Tasks collaboration derive audiences from `TaskListAudience`, which reads grants; after removal the audience shrinks on its next computation. Whether already-open sessions must be cut is part of the per-app check (chunk `per-app-check`).

## Offline and sync effects of removing a grant

Applies to a person whose per-person grant is removed by the migration or by a move into a Team. Read from the code; not yet reproduced on a running stack (the per-app check reproduces it, see plan chunk `per-app-check`).

**Server side: the collection simply leaves their list.** Collection changes are computed over the collections a person can currently see, and one that was in their last sync state and is no longer visible is reported as `destroyed` (Calendar, Tasks, Notes, chat channels in `CalDavCollections::changes`; Contacts in `AddressBookChangesMethod`). Nothing is sent for the person; the next sync tells their device.

**Web app, device already synced (a):**
- The collection and its cached items are removed from the offline store on the next collection sync: Calendar (`ingestRemoteCalendarDestroyed`), Tasks (`ingestRemoteTaskListDestroyed`), Notes (`ingestRemoteNotebookDestroyed`), Contacts (`ingestRemoteAddressBookDestroyed`), chat channels (`ingestRemoteChatChannelDestroyed`). After a full re-list the same cleanup runs (Contacts, chat). No stale copy stays and no error is shown for the removal itself.
- It is not instant while the app is closed or offline: the old copy stays readable until the device next syncs (open tab: next poll or live push; closed app: next start while online).
- **Unsent offline edits** to items of that collection are kept, not deleted. Items with a queued write are left in the cache (Calendar, Tasks, Notes, Contacts), and on the next flush the server refuses the write (403 or 404). A refused write is not retried forever: it is marked failed and shown to the person, as a conflict (Calendar conflict dialog, `calendars-outbox-flush.ts`) or in the sync notice that lists permanent 403/404 rejections (`isPermanentlyFailedOutboxRow`). The person's offline work in a collection they no longer have is therefore visible as a refused change, and is not applied.
- The disappearance itself is silent: there is no message that says why. The person sees the calendar, list, notebook, address book or channel vanish from the sidebar.
- Chat channels: removal drops the channel and its cached messages and sync tokens without checking queued messages; queued messages for it fail permanently on flush and wait in the sync notice.

**Native DAV clients (b):** a removed Calendar/Tasks/Notes grant deletes the grantee's `calendarinstances` row, so the collection drops out of their CalDAV home set. What the client does with its local copy is client-specific; the usual behaviour is that the calendar disappears on the next refresh and its local items are removed, and a client that tries to sync it directly gets 404. Edits made offline in the client to that calendar are refused on upload. CardDAV is not affected: address-book grants are not exposed over CardDAV.

**Notice to the person (c):** the existing notification code only sends "shared with you" (`CollectionSharedNotify`, actions `shared` and `list_shared`). There is no "stopped sharing" notice today; adding one is new work in every app. Decision: none (see D6). The owner and the team admin are told at the moment of action, by the confirm dialog on a move, and the migration is a one-time pre-beta cleanup.

## Decisions (product lead, 2026-11-26)

All seven proposals of the first draft were accepted. They are decided, not open.

- **D1 (Q1). Team grants.** The rule covers grants to single people only. Grants of a Team collection to another Team (`groups/<slug>`) stay as they are, in the API and in the migration.
- **D2 (Q2). Address books.** Same rule for Team-owned address books: refuse and migrate. The Contacts dialog hides the section for Team-owned books. No owner-move flow is added.
- **D3 (Q3). Meeting rooms.** A meeting room stored under a Team is treated like a Team-owned channel: no per-person grants. Guests are out of scope and are not affected.
- **D4 (Q4). Items moved out of a Team.** Moving a task or event from a Team collection into a personal collection shared with other people is allowed as today. No new block or warning.
- **D5 (Q5). Dialog.** For a Team collection the section is replaced by one read-only line "Everyone in <Team> has access". On personal collections the section title changes from "Team access" to a people-based title ("Share with people").
- **D6 (Q6). Notification.** Nobody is notified when their grant is removed, by the migration or by a move. Their collection disappears at the next sync (section above). The confirm dialog on a move is the warning, for the person moving.
- **D7 (Q7). Team back to personal.** Allowed for team admins as today. The collection then has no grants and can be shared again.

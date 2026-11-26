Source: #2392 (body-hash: 8df45896)
Goal: WeGotWorkspace/Product#155

# Per-member sharing only on personal collections

Technical translation of Epic #2392. Decisions were made with the product lead on 2026-11-26 and are listed in the Epic body. This spec turns them into one API rule, one migration, one UI rule and one confirm-dialog change, and lists what is still open.

## Goal

A collection owned by a Team (including the four default collections of a Project) cannot carry a grant to a single person. Access to it comes from Team membership only. Personal collections keep per-person sharing. The rule is enforced in the API for every app and every entry point (REST, JMAP, MCP, DAV), not only by hiding the UI section. Existing per-person grants on Team-owned collections are removed once by a migration. Moving a personal collection into a Team drops its per-person grants, and the confirm dialog says so before the move.

## Terms

- **Team-owned collection:** the owner principal is `principals/groups/<slug>` (`GROUP_PREFIX`). Projects own their collections through the Team, so Project collections are Team-owned too (they carry a `projectId` on top).
- **Per-person grant:** a share to a user principal `principals/<username>`. In JMAP this is a `shareWith` key without the `groups/` prefix.
- **Team grant:** a share to a Team principal (`shareWith` key `groups/<slug>`). The Epic says "per-member"; whether Team grants are in scope is an open question (Q1).
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
5. **Migration.** One data migration deletes per-person grants on every Team-owned collection (both storage shapes above). It is idempotent and has no `down`. Revoked grantees lose access immediately; no notification is sent (see Q6).
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
- **Per-item moves** (a task to another list, an event to another calendar; `TaskRepository::resolveMoveTarget`, `CalendarEventMutationSupport` patch target): grants live on the collection, not on the item, so an item moved into a Team collection stops being visible to people who only had a grant on the source. Nothing is copied. The reverse (a Team item moved into a personal collection that is shared with someone) makes Team content visible to that person. See Q4.
- **Subscribed (read-only) calendars** have no owner change and no grants; unaffected.
- **Meeting rooms.** A meeting room started with a Team is not a Team collection (`assertMayAddChannelToTeam`: every member may open one), but it is stored under the Team principal. See Q3.
- **Live sessions.** Docs and Tasks collaboration derive audiences from `TaskListAudience`, which reads grants; after removal the audience shrinks on its next computation. Whether already-open sessions must be cut is part of the per-app check (chunk `per-app-check`).

## Open questions for the product lead

- **Q1. Team grants.** Does the rule cover only grants to single people, or also grants of a Team collection to another Team (`groups/<slug>`)? Proposed default: only single people, because the Epic and Goal say "per-member"; a Team-to-Team grant is group access and is not a loophole for one member acting alone. Alternative: block all grants on Team-owned collections.
- **Q2. Address books.** Contacts has Team-owned address books (provisioned per Team) but no owner move and no `groupSlug` on the dialog. Proposed default: the same rule applies (refuse and migrate), the Contacts dialog hides the section for Team-owned books, and no move flow is added.
- **Q3. Meeting rooms.** Proposed default: a meeting room is not a collection that carries a Team grant list today; treat Team-created meeting rooms like Team-owned channels (no per-person grants), because they live under the Team principal. Confirm that guests are invited by link and not by per-person grant (guests are out of scope).
- **Q4. Moving items out of a Team.** Should moving a task or event from a Team collection into a personal collection that is shared with other people be blocked or warned? Proposed default: allowed as today (no new block), because the person doing it can already read the item; a warning is a later change.
- **Q5. What the dialog shows instead.** For a Team collection the section disappears. Proposed default: show one read-only line "Everyone in <Team> has access" in its place. Alternative: show nothing. Related: rename the section title on personal collections from "Team access" to something about people ("Share with people").
- **Q6. Notify revoked people?** The migration and the move drop access silently. Proposed default: no notification (pre-beta, and the Epic says the share is simply removed). Alternative: send the existing "stopped sharing" notice on a move (not in the migration).
- **Q7. Moving a Team collection back to personal.** Today the owner of a Team collection can be moved to personal by a team admin (`assertGroupOwnedTransferAllowed`). After the move there are no grants, and the admin can re-share. No change proposed; stated so it is a decision and not an accident.

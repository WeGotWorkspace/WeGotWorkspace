Source: #1915 (body-hash: 4a122c5f)
Goal: WeGotWorkspace/Product#114

# Teams: rename Groups, and see only colleagues you share a Team with

Written against `origin/main` at `0fa5d3521` and revised after an external review at `b25a99f` (both 2026-11-04). Each chunk in plan.md names its Task. API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

## Goal

Two steps ahead of the Projects revision:

1. **Rename.** Every user-facing "Group" that means an admin-managed group principal becomes "Team". This covers Admin, Settings, share dialogs, move-to dialogs, Drive and Docs labels. Code, API, OpenAPI, DAV paths and database names keep `group`.
2. **Visibility.** A non-admin user can find, see and interact only with **colleagues**: users who share at least one Team with them. Admins find everyone, but see presence and free/busy only in their own Teams. The server enforces this; the UI filtering follows from the server.
3. **Admin becomes a role.** Admin is no longer membership of the `administrators` group principal.

Product decisions (product owner, 2026-11-04):

- **Teams are the access boundary. Projects are a UI filter inside a Team.** A Project belongs to exactly one Team, and every Team member sees every Project of that Team. There are no per-Project rights. A Project holds only Team-owned items.
- Only admins create Teams. Two Teams that work together get a joint Team.
- A user in no Team sees no colleagues. There is no default "Everyone" Team, and the update does not put existing users in a Team: no Team now is no Team later.
- Admin is a role, not a Team. The old `administrators` group stays as an ordinary Team "Administrators", so nothing in it is lost.
- **Existing DMs and shares with a non-colleague disappear from view.** Nothing is deleted. They come back when the two users share a Team again.
- Typing the email address of an internal user who is not a colleague still works, but the invite is treated exactly like one to an external guest. There is no autocomplete, no free/busy, and nothing is delivered straight into their calendar.

## Non-goals

- Projects themselves (Epic #810, `feat/projects`). This work only fixes the Team boundary that Projects will sit on.
- Team availability calendars (Epic #1907) and attendee free/busy (#1614). Both reuse the colleague rule from this work.
- Letting non-admins create Teams or manage members
- A default or "Everyone" Team, or an instance setting to switch the rule off
- Renaming code identifiers, REST routes, JMAP properties (`scope: "group"`, `groupSlug`), DAV paths (`principals/groups/`, `files/groups/`) or the Drive path root `Groups/`
- Renaming contact groups in Contacts (vCard `KIND:group`). They are a different concept and keep the name "Groups".
- Guest links, public Drive links and published calendar feeds. They have no viewer principal, so the colleague rule does not apply.
- Disabled users. They count like any other user here; the existing disable flow is unchanged.
- An upgrade migration that puts existing users into a Team
- A milestone. This work is not tied to the Pioneer programme.

## Affected packages

- `packages/api`:
  - admin role (migration, resolver, installer)
  - colleague resolver
  - people directories (scheduling invitees, Drive share principals, group listings)
  - write gates (DM open, every share write path, MCP)
  - share hiding (calendar-backed kinds, address books, Drive grants, collab rooms)
  - presence rooms
  - DAV group container, principal lookup, scheduling and free/busy
  - PHPUnit
- `packages/apps`:
  - copy rename
  - admin toggle in Admin
  - presence rooms per Team
  - empty states for "no Team yet"
  - Storybook, Vitest, e2e text selectors
- `docs`: `docs/architecture/team-visibility.md`, a short description of the colleague rule and where it is enforced (only if the product owner wants it)

## Technical constraints

### Colleague rule

- `colleagues(viewer)` is the set of user principals that are members of at least one group principal the viewer is a member of, plus the viewer. Membership is `groupmembers` (`principal_id` = group, `member_id` = user).
- Admin is a role (chunk J), so no group grants anything beyond membership. Two admins share a Team only if they are both in a real Team. The old "Administrators" Team is a real Team from then on.
- **Admin rule** (product owner, 2026-11-04): an admin **finds and reaches everyone** (people lists, DM, share, invite, CalDAV group directory and principal lookup), but **watches only their own Teams** (presence and free/busy). The full mapping per surface is in plan.md, Admin rule.
- The resolver has two checks with deliberately different names: `isColleague` (admins: everyone) and `sharesTeamIgnoringAdminRole` (presence, CalDAV VFREEBUSY, Team availability calendars, #1614). It returns a `ColleagueSet` value object, never `null` for "everyone".
- The relation is **not transitive**. A shares a Team with B, and B with C. That does not make A and C colleagues. Every check is relative to the viewer.
- The set is computed per request and memoised on the request. It is never cached across requests, because a membership change must take effect on the next request.
- One query (a self-join on `groupmembers`) computes the set. There is no per-user loop.
- **Team-owned items** (owner is a group principal) are governed by membership, as today. A Team-owned item that a member shared with an individual stays visible to that individual. The owner is a Team, not a person, so no person is revealed, and the share was checked when it was created.

### Existence oracle

- Wherever a username, principal URI or calendar user address comes from the caller, an unknown user and a non-colleague produce the **same** status, error code and message. This covers DM open, every share write path (REST, JMAP, MCP) and DAV principal lookup.
- A non-admin may only name their own Teams as a group sharee. Another Team gives the same response as an unknown group.

### Discovery surfaces (lists)

- `GET calendars/scheduling/invitees` returns only colleagues. It feeds the DM rail, chat mentions, the calendar attendee picker and the share dialogs of Calendar, Tasks, Notes, Contacts and Meet.
- `GET files/shares/principals` returns only colleagues and the caller's own Teams. Admins get every user and every Team.
- Over DAV, `principals/groups/` and each group's `group-member-set` are readable only by the group's members and by admins.
- Presence: nobody joins the instance-wide `workspace` room any more, admins included. The client joins one `groups.{slug}` room per own Team and merges the rosters. The server already authorises those rooms by membership. Admins see presence only in their own Teams; pickers still show them every user.

### Interaction gates (writes)

The server refuses each of these when the target is not a colleague, with the response from "Existence oracle":

- opening a DM, over REST and through MCP `meet_channel_write kind=dm`
- adding a user sharee to a calendar, task list, notebook, Meet channel, address book, Drive item or Docs document, over REST, JMAP and MCP share tools
- adding a group sharee that is not one of the caller's own Teams

Existing grants are not touched by these gates.

### Hiding existing shares ("Alles weg")

- Hiding is **computed on read**. For the calendar family and address books, it sits next to the existing dismissal filter. Drive and Docs get a new filter in the grant resolver, because they have no dismissal mechanism. No grant row is deleted, revoked or rewritten.
- A sharee instance or grant whose owner is a user principal that is not a colleague of the viewer is treated like a dismissed share. It is absent from listings, unreachable by id, absent from the CalDAV/CardDAV home and denied to collab joins. DMs are calendar-backed chat channels, so they follow the same filter.
- Restoring a dismissed share does not bypass hiding. A hidden share becomes visible again only when the users share a Team again.
- `/changes` must report a hidden collection as destroyed and a re-shown one as created, so the Dexie caches on other devices follow. JMAP push is pull-only, and every state except FileNode is already a map keyed by the viewer's visible collections, so hiding changes it on the next poll with no extra mechanism. FileNode uses one global sequence, so its state gains a hash of the viewer's visible roots; a changed hash, or a legacy all-digit state, answers `cannotCalculateChanges` and the client resyncs once.
- Native CalDAV and CardDAV clients cannot tell hiding from deleting: they drop their local copy and sync it again when it comes back. Nothing is lost on the server. This is known and documented behaviour.
- A live collab session (Docs, Notes) of a user who stops being a colleague of the document owner ends on the next signaling check, like a revoked share.
- **The owner does not see it either.** A share to a non-colleague is absent from the owner's share list, on every surface (JMAP `shareWith`, Drive grant lists, the access panel, MCP). The owner cannot revoke it while it is hidden. It comes back, unchanged, when the two share a Team again.
- **Owner writes keep hidden grants.** Calendar and address book `shareWith` writes and Drive `mergeShareWith` are already patches, so they leave hidden grants alone. An explicit "share with nobody" (`shareWith: null`, MCP `set` with `null`) also revokes hidden grants. Otherwise a later shared Team would reopen something the owner closed. Deleting the item removes them too, as today.

### People inside an item you can open

- Other members of a channel, comment authors and collab cursors in a document, event attendees, and the "shared with" list of a file are shown by name, even when they are not the viewer's colleagues. This happens only when a user in several Teams brings people from different Teams together in one item.
- They are never offered in a picker or a directory, and the UI offers no "message" or "share" action for them. The server gates (Interaction gates) refuse those actions anyway.
- Anonymising them was rejected: attendee addresses live in the iCalendar data that CalDAV clients read, and comment authors live in the stored document.
- Exception: for the **owner**, a non-colleague sharee is absent from the "shared with" list (see the owner rule above).

### Scheduling and free/busy

- An invite or update from organiser A to an internal attendee B who is not A's colleague is treated as if B were external. It is not delivered into B's calendar. From the web app (JMAP) it goes through iMIP. From a native client (DAV) B gets exactly what an external address gets today, which is no mail: DAV has no iMIP route yet (Bug #1929). When external invites are off or the instance cannot send mail, the result is the same as for any external address.
- When A types B's address, the event keeps the address as typed. It is not canonicalised to B's principal, because that would reveal that B exists on this instance.
- A CalDAV outbox VFREEBUSY request for a user who shares no Team with the caller returns the same response as for an unknown address. This holds for admins too (`sharesTeamIgnoringAdminRole`). There is no free/busy code of our own today, so this is new code: a subclass of Sabre's schedule plugin that overrides `getFreeBusyForEmail` and answers `3.7;Could not find principal`.
- Sabre reaches an attendee's inbox through the principal node tree. When `principals/{user}` starts returning 404 for non-colleagues, delivery to them must already go to iMIP before Sabre's local delivery runs.
- B can still reply. The reply follows the existing path for replies to an organiser.

### Rename

- Only user-visible strings change: labels, titles, placeholders, toasts, empty states, `aria-label`s, the PWA description, and API error messages that the web app shows (`Group not found.`, `Group name is required.`).
- The Drive and Docs breadcrumb root shows "Teams". The path segment stays `Groups/`, for URLs, WebDAV clients and offline keys.
- MCP tool descriptions mention no Teams today, so nothing changes there. Contacts keeps its vCard-group strings, except the one principal-sharing placeholder ("Add people or groups"). The share copy, now in five places, moves to one source.
- e2e and Storybook text selectors follow the new copy in the same chunk.

## Edge cases

- A user removed from their last Team sees no colleagues. Every inbound share from a user disappears, and their own items stay.
- A user added back to a Team sees the hidden shares again, unchanged.
- Admin role removed: everything that was visible only because the user was admin disappears on the next request.
- A user who is both sharee and member of the owner's Team: visible. The membership makes them colleagues.
- A personal collection shared with a Team the owner belongs to: every member is a colleague of the owner, so it stays visible. Shares to a Team the owner left are covered by the same rule: members who no longer share a Team with the owner stop seeing it.
- Chat channel with several members, some of whom are not the viewer's colleagues: the viewer sees their names and messages, but cannot start a DM with them from the member list.
- An owner shares a calendar with B, then stops sharing a Team with B, then edits the share list to add C. B's grant survives the save and returns when they share a Team again.
- An owner deletes an item that has hidden shares: the hidden grants go with it, as for any share today.
- Dismissed and hidden at the same time: stays hidden after restore, and stays dismissed after the users share a Team again.
- MySQL `LIKE ... ESCAPE` in the Drive principal search must stay valid on MySQL and SQLite (review finding 2026-10-13).
- Instance with one admin and no Teams: the admin finds everyone, and other users see nobody until they are added to a Team. On an existing instance that is the state right after the update.
- Two admins in no shared Team: each finds the other, but neither sees the other's presence or free/busy. On an upgraded instance, the existing admins are all in the old "Administrators" Team, so they are colleagues there and do see each other. That is accepted (product owner, 2026-11-04).
- A user in Teams T1 and T2 is a colleague of both Teams' members. Members of T1 and T2 are not colleagues of each other unless they share a Team themselves.

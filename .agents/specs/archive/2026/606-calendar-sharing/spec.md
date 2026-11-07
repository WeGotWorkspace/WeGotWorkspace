Source: #606 (body-hash: bc667788)
Goal: #403

# Calendar collection ACL sharing

Technical translation of Task #606. Product context: Goal #403 (share a calendar with a person or group at read or read/write from the browser). Delivery parent: Epic #494.

## Goal

Persist JMAP `Calendar/set` `shareWith` through Sabre `CalPDO::updateInvites` so personal calendar owners can grant instance users or groups **read** (`access` 2) or **read-write** (`access` 3). Recipients already list via `principaluri` instances — populate owner `shareWith` / `myRights.mayShare`, enforce `access === 2` on event mutations, and keep the same grants visible over CalDAV (`CS:share` / `DAV:share-resource` / `{CS:}invite`). Browser share UI reuses `share-ui` primitives (not Drive-path `ShareDialog`). Include Bug #489 (group-member event edit) on this branch because write-sharing hits the same organizer lock.

## Non-goals

- Single-event ACL (invites own that)
- Delegation / `calendar-proxy-read/write` (#492)
- Guest / public links (#388)
- iTIP/iMIP invites (#478 / #479)
- iCloud-to-iCloud sharing; Apple public/webcal publish (`setPublishStatus` is `NotImplemented`)
- Reopening #500, #163, or #157
- Marking Goal #403 Fulfilled (product judgment after success signals)

## Affected packages

- `packages/api` — `CalendarRepository` / `CalendarSetMethod`, event ACL, CalDAV sharing interop, PHPUnit, stub docs (`jmap-calendars-summary.md`, `jmap-collection-crud.md`)
- `packages/apps` — `calendar-core` dialog/popover/surface write helper; `CalendarShareSection` from `share-ui` primitives on the edit-calendar surface; calendar cache `myRights` / `shareWith`

## Technical constraints

- JMAP-first — no new REST share resource. OpenAPI `calendar.json` already has `shareWith`; tighten only if it still implies null-only
- Who can share / publish: personal owners and group-collection managers (`access === 1` / `mayShare: true`). Sharees (`access` 2/3) cannot share or publish. Sharees may change **their instance name and color** (`calendarinstances.displayname` / `calendarcolor`); shareWith / publish stay owner-side.
- Principal ids: username (`alice`) and `groups/{slug}` (same as Drive)
- Persist CalDAV `share_href` as `mailto:` via `CalendarPrincipalAddresses` (profile email, else `mailto:{username}`) so Apple Calendar / Sabre `findByUri` resolve
- Rights: `shareWith` values are `JmapCalendarRights`. `mayWriteAll === true` → access 3; otherwise access 2. Null grant = revoke
- Owner `Calendar/get`: `shareWith` from `getInvites` (skip owner instance). Recipient: `shareWith: null`, `myRights` from `access`
- Event create/update/delete must `403 forbidden` when the resolved instance is `access === 2`. Group instances stay `access === 1`
- UI: do **not** reuse Drive/Notes `ShareDialog` as-is (path ACL). Compose `CalendarShareSection` from `ShareAccessCard`, `SharePrincipalSearchDropdown`, `SharePermissionSelect`, `SharePrincipalRow`. Calendar administrators (`mayShare`) see public ICS/webcal publish **and** member ACL on the **edit calendar** surface only — no sidebar share button. Sharees get neither control; they can still open Edit calendar to set a personal name and color. Sidebar: unified A–Z My calendars (owned + team + ICS subscriptions), **Shared with me** for inbound ACL. Subscriptions get an Rss mark; view-only ACL items get an eye mark. No group mark on sidebar rows.
- Publish is owner/`mayShare` only (same as sharing) — not `mayWrite`. API `POST/GET/DELETE …/feed` rejects sharee instances (`access !== SHAREDOWNER`).
- Revoke must drop the sharee's calendar from sidebar, events, and open edit dialogs without `location.reload()`. Apply `Calendar/changes` destroyed/created into Dexie (`ingestRemoteCalendar*`) and reconcile controller selection.
- Chunk A must land before Chunk B so live `mayShare` exists. Treat **undefined** `mayShare` like owner on non-group calendars so the invitee RSVP lock does not drop
- Hybrid/offline: persist `mayWrite` / `mayShare` / `shareWith` on cached calendars; share mutations stay online (like Notes)

## Edge cases

- Non-owner sharee: `Calendar/set` `shareWith` rejected. Group members can share and publish the group collection.
- Sharing an owned calendar with a group you belong to must not list a second view-only copy. `Calendar/get` and `Calendar/changes` keep one instance per `calendarid` (prefer owner).
- Sharee **Remove** hides the collection for that user only (`calendar_share_dismissals`). Owner `shareWith` is unchanged so a later “add again” is `CalendarShareVisibility::restore` — do not model leave as `deleteCalendar` of the owner collection.
- Read-only share (`access === 2`): JMAP event mutation and CalDAV `PUT` denied
- Revoke on JMAP or CalDAV clears the other side
- Incoming CalDAV `CS:share` / `DAV:share-resource` with `mailto:alice@…` maps back to JMAP id `alice` (or `groups/{slug}`)
- Sabre auto-accepts invites (`INVITE_ACCEPTED`) — no accept UI
- Group share is browser/JMAP; Apple’s picker is email-only
- Invitee RSVP lock stays on **owned personal** calendars; group + write-share recipients can edit/delete when `mayWrite`
- Details popover and drag-create/resize must use per-calendar `mayWrite`, not a global `canWrite`

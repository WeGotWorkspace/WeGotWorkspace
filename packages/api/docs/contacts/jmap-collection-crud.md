# JMAP collection CRUD and sharing — REST status

> **Issue:** [#157](https://github.com/WeGotWorkspace/wegotworkspace/issues/157)

## Implemented (contacts)

| Operation | REST | Backend |
|-----------|------|---------|
| List | `GET /contacts/addressbooks` | `addressbooks` table |
| Show | `GET /contacts/addressbooks/{id}` | same |
| Create | `POST /contacts/addressbooks` | **Forbidden** (`mayCreateAddressBook: false`) |
| Update | `PATCH /contacts/addressbooks/{id}` | Description only; **name patch forbidden** |
| Delete | `DELETE /contacts/addressbooks/{id}` | **Forbidden** on owned/membership books (`mayDelete: false`). Sharee destroy dismisses. |

**Constraints:**

- One server-provisioned book per principal (user and each group). Personal id is `default`; group membership books are `group-{slug}`.
- Create / rename / delete are `403 forbidden` (RFC 9610 SetError).
- Names are server-set from the principal display name.
- Book `id` is the JMAP id (`default`, `group-{slug}`, or inbound `shared-{addressbookId}`); CalDAV uri on the principal is always `default`.

## Implemented (calendars)

| Operation | REST | Backend |
|-----------|------|---------|
| List | `GET /calendars/calendars` | `calendarinstances` (VEVENT-capable) |
| Show | `GET /calendars/calendars/{id}` | same |
| Create | `POST /calendars/calendars` | Sabre `CalPDO::createCalendar` (VEVENT only) |
| Update | `PATCH /calendars/calendars/{id}` | Sabre `updateCalendar` (name, description, color, timeZone) |
| Delete | `DELETE /calendars/calendars/{id}` | Sabre `deleteCalendar`; `onDestroyRemoveContents` when non-empty |

**Constraints:** same as address books — `default` protected; non-empty calendars return `409 calendarHasContents` without `onDestroyRemoveContents`.

## Implemented (task lists)

| Operation | REST | Backend |
|-----------|------|---------|
| List | `GET /tasks/tasklists` | `calendarinstances` (VTODO-capable) |
| Show | `GET /tasks/tasklists/{id}` | same |
| Create | `POST /tasks/tasklists` | Sabre `CalPDO::createCalendar` (VTODO component set) |
| Update | `PATCH /tasks/tasklists/{id}` | Sabre `updateCalendar` |
| Delete | `DELETE /tasks/tasklists/{id}` | Sabre `deleteCalendar`; `onDestroyRemoveContents` when non-empty |

**Constraints:** `default` list protected; non-empty lists return `409 taskListHasContents` without `onDestroyRemoveContents`.

## Sharing (RFC 9670)

| Collection | `shareWith` | `myRights.mayShare` |
|------------|-------------|---------------------|
| **Calendars** | Persisted for personal owners **and group-collection managers** via Sabre `CalPDO::updateInvites` / `getInvites`. JMAP ids are `username` or `groups/{slug}`. `share_href` is `mailto:` (profile email, else `mailto:{username}` / `mailto:groups/{slug}`). `mayWriteAll` (or REST `mayWrite`) → access 3; otherwise access 2. Null grant revokes. Recipients see the shared instance on their principal with `shareWith: null`. Event create/update/delete is `403 forbidden` when instance `access === 2`. CalDAV `CS:share` / `DAV:share-resource` and `{CS:}invite` / `{DAV:}invite` use the same rows (href ↔ JMAP id via `mailto:`). | `true` for personal owners and group members (`access === 1`) |
| **Address books** | Persisted for personal owners **and current group-book members** in `addressbook_shares` (`AddressBookShareInvites`). CardDAV has no `calendarinstances` analog — sharing is JMAP/browser only (no CS:share / DAV:share-resource). JMAP ids are `username` or `groups/{slug}`. `mayWrite` (or `mayWriteAll`) → access 3; otherwise access 2. Null grant revokes. Recipients see `shareWith: null`, live `myRights`, `isSharee: true`, and id `shared-{addressbookId}`. Card writes are `403` when view-only. Sharee destroy / `isSubscribed: false` hides via `addressbook_share_dismissals`. Group-delete drops grants from that book and to `groups/{slug}`. Dedup only when a personal book is shared with a group the owner belongs to. | `true` for personal owners and current group-book members; `false` on inbound sharees |
| **Task lists** | Persisted for personal owners **and group-collection members** via the same Sabre `CalPDO::updateInvites` / `getInvites` layer as calendars (`PATCH /tasks/tasklists/{id}` `shareWith`). Recipients see the inbound instance with `shareWith: null` and live `myRights`. Shared Inbox is never the recipient’s `role: inbox` / `isDefault`. Item writes are `403` when the instance is read-only (`access === 2`). | `true` for personal owners and group members (`access === 1`); `false` on inbound sharees |

Apple Calendar caveats (this instance only): the account must be a CalDAV account on this server, not iCloud “Share Calendar”. The sharee’s `principals.email` must match the `mailto:` Apple sends. Sabre auto-accepts invites (`INVITE_ACCEPTED`) — no separate accept UI. Group share is JMAP/browser only (Apple’s picker is email-only). `calendar-proxy-read/write` is delegation (#492), not collection sharing. Public/webcal publish (`setPublishStatus`) is unimplemented.

## Related docs

- [jmap-sync-rest-mapping.md](./jmap-sync-rest-mapping.md) — incremental sync ([#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158))
- [rfc9610-summary.md](./rfc9610-summary.md) — contacts field mapping
- [jmap-calendars-summary.md](../calendars/jmap-calendars-summary.md) — calendar field subset
- [jmap-tasks-summary.md](../tasks/jmap-tasks-summary.md) — task list field subset

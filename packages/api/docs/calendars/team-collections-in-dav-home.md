# Team collections in a member's DAV home

Native apps (Apple Calendar, Apple Reminders, Apple Contacts, DAVx5, Thunderbird) find collections in one place only: the signed-in person's `calendar-home-set` (`/calendars/{user}/`) or `addressbook-home-set` (`/addressbooks/{user}/`). Team collections are owned by the Team principal (`principals/groups/{slug}`), so until #2158 no native app could find them.

## What the home lists

`AppCalendarHome` and `AppAddressBookHome` list the person's own collections, then the collections of every Team they are a member of, under the name `team~{slug}~{uri}`:

| In the member's home | Same collection on its canonical path |
|----------------------|----------------------------------------|
| `/calendars/bob/team~sales~sales/` | `calendars/groups/sales/sales` |
| `/calendars/bob/team~sales~tasks-sales/` | `calendars/groups/sales/tasks-sales` |
| `/addressbooks/bob/team~sales~default/` | `addressbooks/groups/sales/default` |

- Nothing is stored per member. The list is computed from `groupmembers` on each request, so a collection appears when someone joins a Team and disappears when they leave.
- The backend's own filters still apply to the Team principal: API-only kinds (chat channels, thread pools) stay hidden, and so do shares hidden by the Team rules (#1915).
- A collection already in the person's home (their own calendar shared with their Team) is listed once, under its own name.
- `team~` is reserved: `MKCALENDAR` and `MKCOL` refuse a personal collection with that prefix. Team slugs never contain `~`, so `TeamCollectionName::parse()` is unambiguous.

## Access

The ACL stays on the Team principal. Members get access through their Team membership, which Sabre's ACL plugin already resolves; nobody gets new rights.

| Case | Served as | Member can |
|------|-----------|------------|
| Collection the Team owns | read-write share (`share-access` 3) | read, write, change name and colour (as in the web app) |
| Collection shared with the Team | the access of that share | what the share allows, e.g. read only |

Because a Team collection is served as a share, it is never the `schedule-default-calendar-URL` and carries no `{DAV:}share` privilege, so a member cannot share it on from a native app. `DELETE` on the collection answers 403: deleting a Team collection stays an admin action in the web app. Objects inside it can be created, edited and deleted as usual.

## Server-side hooks

Hooks that read a DAV path (Meet links, task change notifications, search index, workspace events, vCard prop ids) map the member-home path back to the canonical Team path with `TeamCollectionName::canonicalPath()`. A change made in Apple Calendar is therefore indexed, announced and live-updated exactly like the same change made in the web app.

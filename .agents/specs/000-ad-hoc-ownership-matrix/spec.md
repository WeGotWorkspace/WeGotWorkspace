Source: ad-hoc

# Ownership access matrix (REST + JMAP)

## Goal

Add a PHPUnit suite that proves horizontal authorization on every REST operation and every JMAP method.

- Each case runs one operation as one actor against an object in one scope, and asserts the declared outcome.
- A coverage guard fails when an operation or JMAP method has no declaration. A new endpoint therefore cannot skip the matrix.

`tests/Architecture/RoleAccessMatrixTest.php` already proves the vertical layer: which role passes the route middleware. This suite proves the layer below it: whether that caller may touch this object.

### Actors

| id | Who | Token |
|----|-----|-------|
| `anonymous` | Not signed in | none |
| `guest` | Drive share-link session | guest-role JWT (`share:<key>`) |
| `member` | Non-admin member of group `crew` | user JWT |
| `admin` | Instance admin, also a member of `crew` | admin JWT |

### Fixture principals

| Principal | Role in the fixture world |
|-----------|---------------------------|
| `member` | The non-admin actor. Member of `crew` |
| `admin` | The admin actor. Member of `crew` and `administrators` |
| `carol` | Another user. Member of `outsiders`. Not in `crew` |
| `dave` | Another user. Member of `crew` only. Used for grants that reach the actor through `crew` |
| `crew` | The actors' group |
| `outsiders` | A group neither actor belongs to |
| `alumni` | A group the actor leaves after its token is issued |

### Scopes

Each scope says how the actor relates to the target object. Scopes come in three families.

**Ownership: who owns the target**

| id | Owner of the target |
|----|---------------------|
| `own-user` | The actor |
| `own-group` | `crew` |
| `other-user` | `carol`, with no grant to the actor |
| `other-group` | `outsiders`, with no grant to the actor |
| `former-group` | `alumni`. The actor was a member when the token was issued and was removed before the request |

**Grants: someone else owns the target and granted access to an internal user**

| id | Grant |
|----|-------|
| `user-to-actor-read` / `-write` | `carol`'s object, shared directly to the actor |
| `group-to-nonmember-read` / `-write` | An `outsiders`-owned object, shared directly to the actor. The actor is not in `outsiders` |
| `user-to-actor-group` | `carol`'s object, shared to group `crew`. The actor reaches it through membership |
| `grant-revoked` | Was shared to the actor; the owner revoked it |
| `grant-dismissed` | Was shared to the actor; the actor dismissed it |

Each grant scope applies to every collection type that supports sharing: calendar, task list, notebook, chat channel, address book, and drive path. Drive uses the levels `view`, `comment`, `edit`, and `full`. The other types use `read` and `write`.

**Public: access by capability token, without an account**

| id | Token |
|----|-------|
| `calendar-feed` | Published calendar feed token (`GET /calendars/feeds/{token}`) |
| `link-open` | Drive public link without a password |
| `link-password` | Drive public link with a password. Cases: correct, wrong, and missing password |
| `link-expired` | Drive public link past `expiresAt` |
| `link-revoked` | Drive public link that was revoked, or whose password changed after the session was issued |
| `email-invite` | Pending drive invite token for an external address (`POST /files/share-sessions/accept`) |
| `rsvp` | iTIP RSVP token (`/calendar/rsvp/{token}`) |

### Default outcomes: ownership and grants

A row may override a default only with a reason in the declaration.

| Scope | Read and list | Item write | Collection delete | Share or publish |
|-------|---------------|------------|-------------------|------------------|
| `own-user` | allowed | allowed | allowed, unless it is a provisioned default | allowed |
| `own-group` | allowed | allowed | `admin` only; `member` gets 403 `group_delete_admin_only`. Provisioned group defaults cannot be deleted by anyone | allowed for every member, `admin` included |
| `other-user`, `other-group`, `former-group`, `grant-revoked`, `grant-dismissed` | denied as not found | denied as not found | denied as not found | denied as not found |
| `*-read` | allowed | 403 `forbidden` | dismisses the grant; the owner's object stays | 403 `forbidden` |
| `*-write`, `user-to-actor-group` | allowed | allowed | dismisses the grant; the owner's object stays | 403 `forbidden` |

"Denied as not found" means:

- REST returns 404 `not_found`.
- JMAP returns `notFound`, `notUpdated`, or `notDestroyed` with type `notFound`.
- A JMAP call with another principal's `accountId` returns `accountNotFound`.
- A JMAP method without a per-id result slot (`BlobAssembly/append`, `BlobAssembly/finish`) answers another account's id with the same method error, byte for byte, as an id that does not exist. A blob the caller cannot see is `blobNotFound`.

Every denied write also proves that the target is unchanged afterwards. Every list, `changes`, `query`, and `queryChanges` call proves that ids from denied scopes are absent.

`admin` has no bypass over per-object access. The one admin-only right is deleting a group-owned collection.

A sharee never gets re-share or publish rights. The `Share or publish` column covers:

- `shareWith` on collections
- `POST /files/shares`
- share invites
- `POST /calendars/{calendarId}/feed`, and `GET` and `DELETE` on it: reading a feed returns its public URL, so it is publish management, not a calendar read
- `POST /files/shares/public/revoke-all`

A sharee who calls share management on a share granted to them gets 403 `forbidden`: they can see that the share exists. A caller with no part in the share gets 404 `not_found`.

### Decided exceptions to the defaults

These rows follow a product decision instead of the default denial:

- **Share directory:** `GET /files/shares/principals` lists every user and group of the instance, for every signed-in actor. It is a directory for picking share targets, not a read of their data.
- **Drive roots:** `GET /files/children` on `/users` and `/groups` lists every home and group drive, for the same reason. Each entry's `myRights` are the caller's own rights on it, so another owner's entry shows no rights. Its contents stay denied as not found.
- **Invisible parent in JMAP:** `FileNode/set` that creates under, or moves into, a folder the caller cannot see rejects the create or update with `invalidProperties` (RFC 8620 §5.3), not `notFound`.
- **Push endpoints:** registering a push endpoint that another account registered creates a separate record for the caller. Deleting by that endpoint removes only the caller's own record. Neither touches the other account's subscription.
- **Client-chosen ids:** a note `uid`, chat channel `id` or chat message `id` that only an object the caller cannot see uses does not collide. The create succeeds under a fresh id, exactly as for an unused id, and the other object is untouched. A chat channel `id` must be `chat-` plus a ULID or UUID; any other shape, including a group default channel id, is a 400 `invalidProperties` for every caller.
- **Meeting codes:** a meeting code is its own invite. A signed-in actor who has the code of an ad-hoc meeting joins it and reads its configuration. A reserved code admits link guests only through the lobby.
- **Batch local-ack:** `POST /notifications/local-ack` skips ids that are not the caller's and answers exactly as for unknown ids. It changes nothing for their owner.

### Default outcomes: public

| Scope | Expected |
|-------|----------|
| `calendar-feed` | A valid token returns ICS for that one calendar only, with private and unclassified events redacted. An unknown or revoked token, or one whose calendar was deleted, returns 404. The token grants nothing on REST or JMAP |
| `link-open` | Session exchange returns a guest JWT. That JWT reads only the link's subtree, at the link's level, on `files/children`, `files/content` and `POST /jmap/guest`. A view link is read-only. An edit link is an upload link: its guest may also add files inside the subtree (`POST /jmap/guest/upload/{accountId}`, `FileNode/set` create), but not rename, delete, or write outside it. Live collaboration (`files/collaboration` GET and PUT) returns 403 `forbidden` for every guest, also inside the subtree. Paths outside the subtree and every `wgw.role:user` route are denied |
| `link-password` | A missing password returns 401 `share_password_required`. A wrong password returns 401 `share_password_invalid`. A correct password behaves as `link-open` |
| `link-expired` | Session exchange returns 410 `share_unavailable`. A session issued before expiry stops at `expiresAt` |
| `link-revoked` | Session exchange returns 410 `share_unavailable`, like an expired link. A guest JWT issued before the revoke or password change is denied on its next request |
| `email-invite` | Accepting binds the grant to the accepting user. An expired invite returns 410 `invite_expired`. A used invite token does not accept a second time |
| `rsvp` | The token answers only its own invitation. It cannot read the event beyond what the RSVP page shows, or answer for another attendee |

## Non-goals

- **Sabre DAV:** WebDAV, CalDAV, and CardDAV (the `routes/web.php` front controller). This is a follow-up that reuses the same fixture world.
- **MCP tools:** `POST /mcp` and `app/Mcp/McpToolCatalog.php`. This is a follow-up.
- **Fixes:** changes to production code. A row that does not hold is fixed in its own branch, as `plan.md` describes.
- **Existing ACL tests:** removing or merging the per-domain ACL tests. That happens after the matrix covers the same rows.
- **MySQL parity:** running the matrix in the MySQL parity group.
- **Role gates already covered:** role-gate assertions that `RoleAccessMatrixTest` already makes for `anonymous`, `member`, and `admin`.
- **Password-reset tokens:** these prove identity, not object access, and they have their own tests.

## Affected packages

- `packages/api`: tests and test support only. No changes under `packages/api/app`.

## Technical constraints

- **Coverage source for REST:** `OpenApiContract::documentedApiOperations()`. The 154 routes and the 154 OpenAPI operations match today.
- **Coverage source for JMAP:** `JmapMethodDispatcher::METHODS`, resolved through the container to `name()`. There are 34 methods.
- **One declaration per operation or method,** in one of two forms:
  - A matrix row set with at least one `member` or `admin` row. `anonymous` and `guest` rows prove the role gate, so a cross-cutting suite (the guest role gate, group sharing) may add them, and signed-in rows, for an operation another suite owns. Case keys stay unique across all suites.
  - An exemption with a reason class: `admin-target`, `public-token`, `self`, `no-object`, or `jmap-envelope`. `jmap-envelope` is only for `POST /jmap`, whose methods are declared one by one.

  `public-token` exemptions are exempt only from the ownership columns. They are covered by the public scopes. A declaration for an operation or method that no longer exists also fails the guard.
- **JMAP addressing:** each JMAP account is the caller's own username. Group and shared objects live inside that account and are addressed by object id. Cross-scope JMAP cases therefore send the actor's own `accountId` with the target's ids. A separate case sends a foreign `accountId`.
- **Tokens:** minted through `JwtTokenService::issue` instead of `POST /auth/token`, to keep per-test cost down. Guest tokens for public scopes come from the real `POST /files/share-sessions`, because that exchange is under test.
- **Database:** each test runs in a rolled-back transaction (`RefreshDatabase`). A test seeds only its own domain's world.
- **File size:** `tools/file-size-ratchet.mjs` does not count test files. The suite still uses one class per domain, and each file stays reviewable.
- **No pending rows at merge:** the suite merges with every row holding. A row marked pending names only an opaque id (see `plan.md` Delivery order).

## Edge cases

- **Predictable group ids:** group collection ids follow `group-<slug>`. `other-group` cases use the real id, not a guessed one.
- **Provisioned defaults:** the group default channel, notebook, task list, and calendar refuse deletion for every actor.
- **DMs** are the creator's collection, shared read-write with the peer. They cannot be modified or deleted.
- **Chat authorship:** message edit and delete are author-only. A `*-write` actor or a group member who is not the author gets 403.
- **Drive caps:** notes paths cap shares at `edit`, and a public link is either view-only or an upload link (see `link-open`). Share management matches the share owner only.
- **Two-target writes:** a move or create that names a target in the body gets one case per scope for the source and one for the destination. Such fields include `notebookId`, `taskListIds`, `filter.inTaskList`, `groupSlug`, a client-chosen chat channel `id`, and the `/chat/dms` `principal`.
- **`former-group`** proves that losing membership takes effect on the next request with the same token.
- **`group-to-nonmember-*`:** the grant gives the actor the granted level on that one collection. It gives no other right in the owning group: its other collections, its group drive, or its default channel.
- **`user-to-actor-group`:** removing the actor from `crew` removes that access on the next request.
- **`changes` and `queryChanges` after a revoke or dismiss** return the object as destroyed or omit it. They never return its contents.
- **Guest scope:** a `guest` token from one link cannot reach another link's subtree, even when both links share an owner.
- **Public link traversal:** a path with `..`, encoded separators, or a sibling prefix (`/users/carol/pub` and `/users/carol/public`) does not leave the link's subtree.

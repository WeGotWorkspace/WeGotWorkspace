# Meet signaling

Meet uses shared room session routes under `/api/v1/rooms/{roomId}/*` and meeting lifecycle under `/api/v1/meetings/rooms` (OpenAPI). Signaling is implemented in Laravel only:

| Component | Role |
|-----------|------|
| `app/Services/Meet/MeetSignalingService.php` | PDO tables `meet_peers` / `meet_messages` via `DB::connection('wgw')` |
| `app/Services/Meet/MeetActorResolver.php` | Guest `sessionKey` and authenticated owner markers |
| `app/Services/Meet/MeetRequestAuth.php` | JWT bearer, `sabre_ui_auth` cookie, HTTP Basic |
| `app/Http/Controllers/Api/V1/Rooms/RoomSessionController.php` | HTTP entry (meet + file collab dispatch) |
| `app/Http/Controllers/Api/V1/Meetings/MeetingsController.php` | Room reserve / status / expiry |
| `app/Services/Meet/MeetReservationService.php` | Reserved rooms (`ownerPrincipal`, `createdBy`, nullable `expiresAt`) |

Meet **UI** is in `packages/apps` (`meet-core`); client RTC channel is `meet`.

## HTTP mapping

| Action | Route |
|--------|-------|
| Join | `POST /rooms/{roomId}/participants` |
| Poll | `GET /rooms/{roomId}/events?peerId=&since=` |
| Send | `POST /rooms/{roomId}/events` |
| Leave | `DELETE /rooms/{roomId}/participants/{participantId}` |
| Chat | `POST /rooms/{roomId}/messages` |
| RTC config | `GET /rooms/{roomId}/configuration` |
| Reserve room | `POST /meetings/rooms` (`room` + `ownerPrincipal`, optional `expiresAt`) |
| Room status | `GET /meetings/rooms/{roomId}` — guests `{ reserved, active }`; owner-principal member or `createdBy` get the full body; **404** = not reserved |
| Patch expiry | `PATCH /meetings/rooms/{roomId}` (`expiresAt`; `createdBy` or owner-principal member) |

For meet rooms, `roomId` equals the room code (e.g. `abcd-efgh-ijkl`).

## Room kinds

`RoomIdCodec` dispatches the shared `/rooms/{roomId}/*` routes on the roomId prefix:

| Prefix | Kind | Service | Auth on join |
|--------|------|---------|--------------|
| *(none)* | `meet` | `MeetSignalingService` | guest `sessionKey` or authenticated |
| `f_` (base64url file path / note UID) | `collab` | `DocCollabSignalingService` | authenticated + document access (`CollabJoinAuthorizer`) |
| `p_` (plain token) | `principal` | `PrincipalSignalingService` | authenticated members only |

Principal rooms (presence/chat/typing over data channels, `principal_peers` / `principal_messages`):

- `p_workspace` — workspace-wide room, any authenticated user may join.
- `p_groups.{slug}` — addresses the Sabre group principal `principals/groups/{slug}`; membership is checked on join via `GroupDirectoryService::memberPrincipalUris`. Any other room form is denied.
- Peer identity is the Sabre username: `owner_user = u:{username}` is exposed as `user` in the roster (authoritative); the peer id is `{sanitized-username}-{6 hex}` (random suffix keeps multiple tabs apart).
- Policy: SinceCursor poll with the conditional 204 fast path, 90 s peer timeout, send types `offer`/`answer`/`ice` only.

## Reserved rooms

Calendar and ad-hoc `/meet` Start persist a row via `MeetReservationService` (`meet_reservations`). Architecture lock: [`docs/architecture/meet-reserved-rooms.md`](../../docs/architecture/meet-reserved-rooms.md).

- **POST** is authenticated. `createdBy` is the acting user (`u:{username}`). `ownerPrincipal` must be `u:{username}` or a `groups/{slug}` whose calendar the caller can write (same CalDAV/JMAP ACL as event create — group membership **or** a write share / delegated ACL). Membership-only is not required. Otherwise **403**. Idempotent: an existing row keeps `ownerPrincipal` / `createdBy`. Omit or `null` `expiresAt` means no inactivity GC. GET/PATCH manage rights still use `createdBy` or `GroupMembershipResolver` membership.
- **GET** is guest-reachable. Public body is only `{ reserved, active }`. Full body (`ownerPrincipal`, `createdBy`, `expiresAt`) only for an `ownerPrincipal` member or `createdBy`. **404** means not reserved (including sweeper-pruned never-activated rooms).
- **PATCH** sets `expiresAt` (Remove / detach / discarded scope / reschedule). `createdBy` or owner-principal member only.
- Ad-hoc Start writes `ownerPrincipal = createdBy = acting user` with `expiresAt = start + 30 days`.
- Sweeper deletes **never-activated** rows only when `expiresAt` is non-null and past. `expiresAt = null` is skipped. First joinable peer sets `activated_at`.
- Calendar ICS-write hook calls `MeetReservationService::reserve()` internally (not only the browser). Fail-open: reserve errors log `calendar_meet_link_reserve_failed` and do not fail the calendar write.

## Tests

```bash
cd packages/api && composer test -- --filter Meet
pnpm test:meet-api
```

Coverage includes guest join/poll/leave, `sessionKey` reuse on re-join, and room active probe.

## History

Migration from main-branch PDO signaling completed on branch `migrate/meet-api`: parity tests, staging validation, then removal of `packages/api/legacy/Voice/` and `WGW_VOICE_SIGNALING`. Schema migration v8 renames legacy `voice_*` tables and settings keys to `meet_*`. REST route revision (`refactor/api-routes`) moved meet HTTP from `/meet/*` to `/meetings/rooms` + `/rooms/{roomId}/*`.

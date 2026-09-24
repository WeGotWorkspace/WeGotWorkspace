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
| Room status | `GET /meetings/rooms/{roomId}` — guests `{ reserved, active }` for an ad-hoc room code; owner-principal member or `createdBy` get the full body; **404** = unknown. Named channels, DMs, meeting name slugs, and any room that is not an ad-hoc code are **404** for guests. Authenticated callers still see `active` on those rooms. |
| Patch expiry | `PATCH /meetings/rooms/{roomId}` (`expiresAt`; `createdBy` or owner-principal member) |

For meet rooms, `roomId` equals the room code (e.g. `abcd-efgh-jklm`). The code uses the mint alphabet only: `[a-hj-np-z2-9]{4}-[a-hj-np-z2-9]{4}-[a-hj-np-z2-9]{4}` (no `i`, `o`, `0`, or `1`).

## Channel-linked rooms (chat ACL join policy)

A call in a chat channel uses the deterministic room id = the channel collection id (`chat-{ulid}` / `dm-…`); a meeting channel's stored call room uses its `chat_channel_meta.room_code`. Both resolve to the channel via `MeetChannelJoinPolicy`, and `MeetSignalingService` enforces the policy on join, poll, send, and chat (Epic #701 chunk H, Goal #859):

- **Channel member** (owner / sharee / group member — any ACL read access via `ChatChannelRepository`): joins directly, never knocks, and is a host (any member may admit).
- **Internal non-member**: forced onto the knock path. A non-knock join is rejected with `knock_required` (403) unless the peer was previously admitted. Knock on a **meeting invite** (`chat-{slug}` / reserved leftover) may wait in an empty room; other channel rooms and unknown leftovers still return `room_not_active` 404 when nobody is joinable.
- **Guest (no account)**: refused on named channels, team channels, direct messages, and any room that is not an ad-hoc code from the mint alphabet (including a plain room name with no channel, and a `xxxx-xxxx-xxxx` name that uses `i`, `o`, `0`, or `1`, such as `team-sync-2026`). Join, knock, poll, and chat return `forbidden` (403), so that chat is not readable. An ad-hoc meeting is open on its room code only. A name slug that still points at a meeting is **404** on `GET /meetings/rooms/{id}` for guests. A **reserved** ad-hoc code (ad-hoc Start, before the meeting is saved) rejects a direct guest join with `knock_required` (403). Knock on that code may wait in an empty room. An ad-hoc code with no reservation and no channel still accepts a direct guest join, because there is no host who can admit.
- **Admission** is recorded server-side when a channel *member* sends an `admit` control message through the chat endpoint, and when `createdBy` or an owner-principal member does the same on a reserved code that has no channel yet: the target peer row in `meet_peers` gets `admitted = 1`, so the knocker's non-knock re-join (same peer id + owner marker) passes. The flag dies with the peer row, and every re-knock clears it. Admits from non-members and from signed-in users who cannot manage the reservation still deliver but record nothing. A guest can be admitted on an ad-hoc meeting room code (saved channel or reserved leftover). Guests are not admittable on named channels, team channels, direct messages, or meeting name slugs.
- Authenticated callers still join a room with no channel directly. Guests do not, except an unreserved ad-hoc code.

`MAX_PEERS_PER_ROOM` (4) is unchanged and counts knocking peers too — a channel call fills up host slots and pending knockers alike.

**Same-browser leftovers.** Join accepts an optional `browserId` (32 hex, minted in `localStorage` as `wgw.rtc.browserId`). When present, other peers in the room with that id are evicted immediately — a reload or second tab on the same device replaces the ghost instead of showing two avatars. A second device has its own token and both peers stay. Omitting `browserId` (old clients, tests) keeps the previous behavior.

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
- **GET** is guest-reachable for an ad-hoc room code, including a saved meeting's code. Public body is only `{ reserved, active }`. Full body (`ownerPrincipal`, `createdBy`, `expiresAt`) only for an `ownerPrincipal` member or `createdBy`. **404** means not reserved (including sweeper-pruned never-activated rooms), or the caller is a guest and the id is not an ad-hoc code.
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

## Release notes

Guest doors are ad-hoc room codes from the mint alphabet only (`abcdefghjklmnpqrstuvwxyz23456789`, shaped `xxxx-xxxx-xxxx`).

- Links that are a plain room name, a channel or meeting name slug (`chat-standup`, `daily-room`), or a code outside that alphabet no longer let a guest join, knock, poll, or chat. That includes links already shared in production or a demo. Workspace members can still open those rooms. There is no migration that reopens a plain-name guest link.
- Meetings stored only as a name slug (`room_code` null) receive a room code on upgrade (`2026_09_23_000420_wgw_backfill_meeting_room_codes`). The collection id stays the slug. Hosts must share the new `/meet/meetings/{code}` link. The old slug URL stays members-only.
- A reserved ad-hoc code requires a server-side knock. The client lobby is not the only check. `createdBy` or an owner-principal member admits the guest.

## History

Migration from main-branch PDO signaling completed on branch `migrate/meet-api`: parity tests, staging validation, then removal of `packages/api/legacy/Voice/` and `WGW_VOICE_SIGNALING`. Schema migration v8 renames legacy `voice_*` tables and settings keys to `meet_*`. REST route revision (`refactor/api-routes`) moved meet HTTP from `/meet/*` to `/meetings/rooms` + `/rooms/{roomId}/*`.

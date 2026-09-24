# REST API design (WeGotWorkspace)

Artifact-oriented routes for `/api/v1`. **Contract source:** `packages/api/openapi/openapi.json`.

## Principles

1. **Resources, not verbs** — nouns in path segments (`/files`, `/meetings/rooms`, `/mail/messages`).
2. **Query params for file paths** — always `?path=/users/alice/doc.md`, never encoded path segments.
3. **Jobs as resources** — long-running admin work uses `POST …/jobs` + `DELETE …/jobs/{jobId}` (updates, search reindex).
4. **One room session API** — meet and file collab share `/rooms/{roomId}/participants|events|configuration|messages`.
5. **Access in OpenAPI** — every operation carries `x-wgw-access`: `guest` | `user` | `admin`.

## Route families

| Domain | Base | Notes |
|--------|------|-------|
| Files | `/files/*` | Replaces `/drive/*`. Listing, search, content upload/download, stars, collab document. |
| Meetings | `/meetings/rooms` | Room lifecycle; `roomId` is opaque (e.g. `daily-room`). |
| Room session | `/rooms/{roomId}/*` | Signaling + RTC config. File collab uses `roomId = f_{base64url(path)}`. |
| Mail | `/mail/messages/{messageId}` | `messageId = {folder}:{uid}`. Drafts: `POST /mail/drafts`. Send: `POST /mail/messages`. |
| Search | `/search/results` | Unified search; download via `/search/results/{resultId}/content`. |
| Workspace | `/workspace/state` | Shell bootstrap (replaces `/home/state`). |
| Admin jobs | `/admin/update-jobs`, `/admin/search/jobs` | Async admin operations. |
| Plugins | `PUT /plugins/{id}/activation` | `{ "active": true\|false }`. |

## Room IDs

| Channel | `roomId` | Logical `room` in JSON body |
|---------|----------|-----------------------------|
| Meet | Same as room code (`daily-room`) | Room code |
| File collab | `f_` + base64url(path) | Virtual file path |

PHP: `App\Services\Rtc\RoomIdCodec`  
TypeScript: `encodeFileRoomId()` in `packages/apps/src/lib/rtc/room-id.ts`

## Signaling HTTP mapping

| Legacy | New |
|--------|-----|
| `POST /meet/join` | `POST /rooms/{roomId}/participants` |
| `POST /meet/poll` | `GET /rooms/{roomId}/events?peerId=&since=` |
| `POST /meet/send` | `POST /rooms/{roomId}/events` |
| `POST /meet/leave` | `DELETE /rooms/{roomId}/participants/{participantId}` |
| `POST /meet/chat` | `POST /rooms/{roomId}/messages` |
| `GET /meet/rtc` | `GET /rooms/{roomId}/configuration` |

Collab used `/collab/*` with the same shapes; file paths now resolve to `f_*` room IDs.

## Role matrix testing

- OpenAPI `x-wgw-access` is enforced by `tests/Architecture/RoleAccessMatrixTest.php`.
- Fixtures: `tests/Support/WgwRoleFixtures.php` (bob = user, alice = admin).
- Backfill missing annotations: `node scripts/backfill-openapi-access.mjs`.

## Microsoft REST guidelines (applied)

- Nouns for resources; HTTP methods express actions.
- Stable error shape (`error`, `message`, HTTP status).
- Version prefix `/api/v1` (breaking replace — no legacy aliases).
- Prefer query parameters for filters and sub-resource selectors (`?path=`, `?search=`).

## WebDAV

Unchanged at `/files/` on `routes/web.php` (Sabre). REST JSON lives under `/api/v1/files/*`.

## When adding endpoints

1. Add path + `x-wgw-access` to `openapi/openapi.json`.
2. Register route in `routes/api.php` with correct `wgw.auth` / `wgw.role` middleware.
3. Feature test under `tests/Feature/{Domain}/`.
4. Run `composer done-gate` and `pnpm --filter @wgw/openapi-types typegen`.

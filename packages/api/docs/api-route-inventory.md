# `/api/v1` Route Inventory

Artifact-based REST surface. **Authoritative contract:** `openapi/openapi.json` (each operation has `x-wgw-access`).

## Auth + System

| Route | Access | Notes |
|-------|--------|-------|
| `POST /api/v1/auth/token` | guest | Issue bearer + refresh token. |
| `POST /api/v1/auth/refresh` | guest | Rotate access token. |
| `POST /api/v1/auth/revoke` | guest | Revoke refresh token. |
| `GET /api/v1/me` | user | Current principal. |
| `GET /api/v1/health` | guest | Liveness. |
| `GET /api/v1/capabilities` | guest | Feature discovery. |
| `GET /api/v1/.well-known/jwks.json` | guest | JWT public keys. |

## Files (replaces Drive)

| Route | Access |
|-------|--------|
| `GET /api/v1/files/context` | user |
| `GET /api/v1/files/children?path=` | user |
| `GET /api/v1/files?search=` | user |
| `GET/HEAD /api/v1/files/content?path=` | user |
| `GET/PUT /api/v1/files/collaboration?path=` | user |
| `POST/DELETE /api/v1/files/star?path=` | user |
| `GET /api/v1/files/starred` | user |
| `POST /api/v1/files/rooms?path=` | user |

## Meetings + Rooms

| Route | Access |
|-------|--------|
| `POST /api/v1/meetings/rooms` | guest |
| `GET /api/v1/meetings/rooms/{roomId}` | guest |
| `POST /api/v1/rooms/{roomId}/participants` | guest |
| `GET /api/v1/rooms/{roomId}/events` | guest |
| `POST /api/v1/rooms/{roomId}/events` | guest |
| `DELETE /api/v1/rooms/{roomId}/participants/{participantId}` | guest |
| `GET /api/v1/rooms/{roomId}/configuration` | guest |
| `POST /api/v1/rooms/{roomId}/messages` | guest |

## Mail

| Route | Access |
|-------|--------|
| `GET /api/v1/mail/status` | user |
| `GET/POST/PATCH/DELETE /api/v1/mail/folders` | user |
| `GET/POST /api/v1/mail/messages` | user |
| `POST /api/v1/mail/drafts` | user |
| `GET/PATCH/DELETE /api/v1/mail/messages/{messageId}` | user |
| `GET /api/v1/mail/messages/{messageId}/attachments/{attachmentId}` | user |

## Search + Workspace

| Route | Access |
|-------|--------|
| `GET /api/v1/search/results` | user |
| `GET /api/v1/search/results/{resultId}/content` | user |
| `GET /api/v1/workspace/state` | user |

## Settings, Notes, Plugins, DAV

| Route | Access |
|-------|--------|
| `GET/PUT /api/v1/settings/*` | user |
| `GET/POST/PUT/PATCH/DELETE /api/v1/notes/*` | user |
| `GET /api/v1/plugins` | user |
| `PUT /api/v1/plugins/{id}/activation` | user |
| `POST /api/v1/plugins/{id}/session` | user |
| `GET /api/v1/dav/capabilities` | user |

## Admin

| Route | Access |
|-------|--------|
| `GET /api/v1/admin/state` | admin |
| `POST/PATCH/DELETE /api/v1/admin/users/{username}` | admin |
| `POST/PATCH/DELETE /api/v1/admin/groups/{group}` | admin |
| `PUT/DELETE /api/v1/admin/groups/{group}/members/{username}` | admin |
| `PUT /api/v1/admin/settings` | admin |
| `POST /api/v1/admin/mail-delivery/test` | admin |
| `GET /api/v1/admin/updates/state` | admin |
| `GET/DELETE /api/v1/admin/updates/log` | admin |
| `POST/DELETE /api/v1/admin/update-jobs/{jobId}` | admin |
| `POST/GET/DELETE /api/v1/admin/search/jobs/*` | admin |
| `POST /api/v1/admin/plugins` | admin |
| `GET/DELETE /api/v1/admin/backups/{name}` | admin |

## Installer

| Route | Access |
|-------|--------|
| `GET /api/v1/installer/state` | guest |
| `GET /api/v1/installer/bootstrap` | guest |
| `POST /api/v1/installer/action` | guest |

## Role matrix

| Role | Middleware | Scope |
|------|------------|-------|
| guest | none / optional auth | Public, auth, meet/rooms, installer |
| user | `wgw.auth` + `wgw.role:user` | Signed-in app features (admin satisfies user) |
| admin | `wgw.auth` + `wgw.role:admin` | `/admin/*` only |

Automated checks: `tests/Architecture/RoleAccessMatrixTest.php`.

Design notes: `.agents/skills/api/rest-design.md`.

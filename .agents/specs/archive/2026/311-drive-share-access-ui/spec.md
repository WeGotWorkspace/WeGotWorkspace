Source: #311 (body-hash: d5885300)
Goal: #388

# Drive guest / link sharing — access UI

Technical translation of Task #311 (guest / link sharing for Drive). Product context: Goal #388 (share Docs and Drive with guests via a link).

## Goal

Deliver Drive (and shared Docs) UI so signed-in users can create and manage guest/public/member shares, and guests can open share links with the correct session and rights. This branch focuses on the **access UI and client wiring** on top of the Drive share API: share dialog, public/guest routes, Shared with me, access indicators, and Docs collab gating from `myRights`.

## Non-goals

- Share **expiry** UX and enforcement UI (Goal #388 success signal; defer as follow-up if not delivered on this branch)
- Vault / E2EE guest sharing
- Public anonymous upload into arbitrary folders
- Replacing ACL-based sharing among signed-in workspace members
- Meet guest rooms (distinct product surface)
- Rate-limiting / auth throttling work (separate WIP; not part of this feature)

## Affected packages

- `packages/apps` — `share-ui`, `drive-core`, `docs-core`, WGW Drive/share clients, guest routing, AuthenticationPage
- `packages/api` — Drive share OpenAPI schemas / routes already used by the UI (share session off cookie middleware where required)
- docs — only as needed for env/share behavior already covered elsewhere

## Technical constraints

- HTTP shapes from OpenAPI → `@wgw-api-generated/drive-types`; UI operations interfaces in `drive-types.ts`
- Guest sessions use share tokens (not full `/me` + `/files/context`); client may fabricate local Drive shell user state outside OpenAPI `DriveUserData` (`role: "user"`, roots `/users`|`/groups`)
- Public links are view-only; member/guest access tiers follow share `defaultAccess` / grants
- Do not share top-level drive roots (`/users`, `/groups`, user home)
- Docs collab (edit/comment) gated by Drive share `myRights` for view-only guests
- Passwords shown once at create/regenerate; no client persistence of share passwords
- Apps handoff: `pnpm test:apps-done-gate`; API touch: `pnpm test:api-done-gate`

## Edge cases

- Guest re-auth after share password change
- File shares that cannot list parent directory (fabricate single-file listing after HEAD content check)
- Duplicate guest email invite → friendly conflict message / idempotent API
- Inherited grants vs direct grants in share dialog and Access manager
- Shared-with-me entries filtered for Docs home to Docs-compatible extensions only

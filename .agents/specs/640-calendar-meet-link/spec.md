Source: #640 (body-hash: 9b540e34)
Goal: #525

# Attach a Meet or meeting URL on a calendar event

Technical translation of Task [#640](https://github.com/WeGotWorkspace/wegotworkspace/issues/640). Product context: Goal [#525](https://github.com/WeGotWorkspace/wegotworkspace/issues/525). Architecture lock (review before Chunk M): [`docs/architecture/meet-reserved-rooms.md`](../../../docs/architecture/meet-reserved-rooms.md).

## Goal

Persist a principal-owned Meet reservation so a calendar event can carry a stable join URL **before** anyone is in-call. Write CalDAV-compatible conference fields (`URL` + `CONFERENCE` + `X-GOOGLE-CONFERENCE`). Show Join on popover, invitee dialog, and inbox. A shared **server** ICS-write hook (JMAP set **and** CalDAV PUT) recomputes finite `expiresAt` on reschedule and idempotent-reserves inbound same-origin WGW hrefs, including draft-clock **upgrade** on persist of an existing row.

## Non-goals

- Named reusable rooms ([#579](https://github.com/WeGotWorkspace/wegotworkspace/issues/579))
- Auto-Meet on every event
- Zoom / Teams APIs
- Writing `X-MICROSOFT-SKYPETEAMSMEETINGURL` (read-only)
- Changing iMIP `ORGANIZER` to the group
- Closing Goal #525
- Stealing week 26–30 Aug (connect-URL + Block B)

## Affected packages

- `packages/api` — Meet reservation table/API; calendar converters; ICS-write hook from `persistEventMutation` **and** CalDAV after-write
- `packages/apps` — Meet lobby reserved-empty wait; calendar form/wire/dialog/popover/inbox Join
- `docs` — sprint-plan, this architecture note, conversion matrix, meet-signaling

## Technical constraints

- **`createdBy` column** on every reservation insert, including inbound ICS-hook inserts (`createdBy` = authenticated DAV/JMAP actor). Full GET body only for `ownerPrincipal` members **or** `createdBy`.
- **Guest GET** is `{ reserved, active }` only. GET **404** = not-reserved (dead-link copy). Network errors stay errors.
- **Nullable `expiresAt`:** series master **and** this-and-future = `null` while the link stays attached. Single = DTEND+7. This-instance override = occurrence-end+7. Draft = now+30d. Ad-hoc `/meet` = start+30d **and always writes a row**.
- **Five GC triggers:** (1) sweeper of never-activated rows with past non-null `expiresAt`; (2) event delete / series destroy → `expiresAt = now`; (3) Remove while event remains → PATCH now+30d; (4) scope-change after reserve → same PATCH; (5) ad-hoc/draft finite clock elapsing into (1).
- **Shared ICS-write hook** (Chunk A, not UI): reschedule recompute **and** inbound WGW reserve. Invoked from JMAP `persistEventMutation` **and** CalDAV PUT. Draft-clock **upgrade** on persist of an existing row. Keep existing owner/`createdBy` on retry.
- **Origin equality** only (`origin === configuredWorkspaceOrigin`). No `includes` / `startsWith`.
- **Add Meet:** one room code per form session; disable while POST in-flight. Scope-change after reserve invalidates the staged code (PATCH now+30d, reserve again).
- Write-set: `URL` + `CONFERENCE` + `X-GOOGLE-CONFERENCE`. Read also `X-MICROSOFT-SKYPETEAMSMEETINGURL`. Never write the Microsoft property. Do not put the join URL in `LOCATION`.

## Edge cases

- Group calendar: `ownerPrincipal = groups/{slug}`; a non-member ACL writer still gets `createdBy` and full GET.
- Paste of an already-reserved ad-hoc `/meet` URL does not steal ownership.
- Far-future single saved after blur-draft must leave `now+30d` and become DTEND+7; series Save → `null`.
- CalDAV PUT of ICS with a WGW `URL`/`CONFERENCE` and no prior row creates a reservation with `createdBy` = the PUT principal.
- Mapping-only GET does not POST. Incomplete room codes do not POST.
- This-instance Add Meet must not reuse the master null-expiry room.

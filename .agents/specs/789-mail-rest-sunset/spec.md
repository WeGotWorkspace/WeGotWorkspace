Source: #789 (body-hash: 8f73cbc8)
Goal: #382

# Remove dual-protocol `/mail/*` REST except status

Technical translation of Task #789. After the Mail app talks JMAP, delete user mailbox REST routes. Keep `GET /mail/status`, Settings mail, Admin Email delivery, and `MailOperationService` for MCP.

## Goal

No dual protocol. Removed paths return 405/404. Feature asserts lift onto envelope contract tests.

## Non-goals

- Deleting `MailOperationService` / `MailImapClient`
- Admin Email delivery
- Per-user Settings mail
- Dexie / offline

## Affected packages

- packages/api (routes, OpenAPI, Feature tests, route inventory)

## Technical constraints

- Keep `GET /api/v1/mail/status`
- Keep `PUT/GET /settings/mail`
- Keep `/admin/mail-delivery/*`
- MCP stays on `MailOperationService`
- `composer done-gate`

## Edge cases

- ACL / compose / move / folders / unavailable coverage must still exist on the envelope after REST deletion

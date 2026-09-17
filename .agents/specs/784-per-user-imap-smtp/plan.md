# Per-user IMAP and SMTP — plan

Derived from [spec.md](./spec.md). Sequential with the Mail JMAP program; parallel with the IMAP fixture (#785).

## Goal

Per-user mailbox account in Settings; instance kill-switch only; wizard seeds admin.

## Non-goals

- JMAP methods, Dexie, multi-account rows

## Affected packages

- packages/api, packages/apps, docs

## Dependencies

None. Must land before M1 (#786) so `MailUserRuntime` is not built on instance hosts.

## Chunks

### Chunk S: Per-user servers

- **id:** `chunk-s-per-user-servers`
- **Skill:** api, workspace
- **Inputs:** existing `mail_user_credentials`, Settings/Admin panes, installer wizard
- **Done when:** AC on #784
- **Verify with:** `pnpm test:api-done-gate`; Settings mail stories; Admin mail pane no longer saves `mail_smtp_host`
- **Parallel with:** `chunk-a-fixture` (#785)

## Test plan

- [ ] Settings PUT/GET omit/clear password matrix
- [ ] User A SMTP ≠ user B
- [ ] `mail_enabled=false` vs user-empty error split
- [ ] MailDelivery still uses `mail_delivery_*` only
- [ ] MCP `mail_send` / `mail_status` pin user SMTP

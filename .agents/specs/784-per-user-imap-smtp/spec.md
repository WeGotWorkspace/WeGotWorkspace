Source: #784 (body-hash: 52b8f77d)
Goal: #382

# Per-user IMAP and SMTP for the Mail app

Technical translation of Task #784. Mail-app send/receive uses **this user’s** stored IMAP/SMTP endpoints and login. Admin Email delivery (`mail_delivery_*`) stays instance-wide. There is **no** instance Mail kill-switch: the Mail app, JMAP mail URN, and MCP mail tools follow this user’s mailbox row (and `ext-imap`).

## Goal

Move Mail-app IMAP and SMTP off instance `mail_imap_*` / `mail_smtp_*` onto the existing one-row-per-user `mail_user_credentials` table (plus optional SMTP login). Settings Mail pane edits the full mailbox account. The installer can seed the installing admin’s personal row from the wizard mailbox fields so the post-install path is not “mailbox not configured”.

## Non-goals

- Extra credential rows / add-switch UI (#407)
- Admin Email delivery / `mail_delivery_*`
- JMAP envelope methods (#786 / #787)
- Dexie / offline (#400)

## Affected packages

- packages/api
- packages/apps (Settings Mail pane, installer Mail pane)
- docs (`packages/api/docs/mail/`)

## Technical constraints

- Secrets stay AES-256-GCM; GET never echoes passwords (`imapHasPassword` / `smtpPasswordSet`)
- PUT omit or `""` password leaves the stored secret; non-empty replaces; `clearImapPassword` / `clearSmtpPassword` clears
- Empty SMTP login fields reuse IMAP login
- `MailUserRuntime::resolve` must not read instance `mail_imap_*` / `mail_smtp_*` hosts
- Distinct errors: missing ext-imap vs user-empty (`MAIL_SETTINGS_MISSING`)
- One-shot migration copies instance IMAP/SMTP endpoints onto existing credential rows that already have an IMAP username
- `mailAccountId` stays the constant `primary` (one row per user)

## Edge cases

- Changing only SMTP port must not require re-typing IMAP password
- Changing SMTP host without a new SMTP password keeps the stored SMTP secret (or IMAP reuse if none stored)
- Instance `mail_imap_host` empty must not 503 every user
- MCP `mail_send` / `mail_status` use that user’s SMTP via `MailOperationService`, never instance `mail_smtp_host`

# Mail

WeGotWorkspace has no mailbox client. The unshipped IMAP/SMTP client (mail REST, MCP mail tools, the Mail app, the Settings "Mail accounts" pane and the Admin IMAP pane) was removed in [#1573](https://github.com/WeGotWorkspace/wegotworkspace/issues/1573). The repository history keeps it for a later release.

## Email delivery stays

Admin → Email delivery sends password recovery, invites, and outbound iMIP. It does not read a mailbox. See [mail-delivery.md](../mail-delivery.md). The code lives in `app/Services/MailDelivery/`.

## Invitation replies (inbound iMIP)

A user can connect one IMAP mailbox in Calendar settings so that replies to their invitations, sent from Apple Calendar, Google Calendar, Outlook and other calendar apps, update their events ([#1589](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1589)). This is calendar plumbing, not a mail client:

- `wgw:calendar:imip-poll` runs every minute from the scheduler. Each mailbox is read at most every two minutes, and only mail that arrives after it was connected.
- The folder is opened read-only (`EXAMINE`, `BODY.PEEK`). Nothing is marked read, moved or deleted. Only the `text/calendar` part of a message is downloaded; other messages are not read past a few header fields.
- Only `METHOD:REPLY` is applied, and only when the receiving mail server's `Authentication-Results` header verifies the sender and the sender is an attendee of an event the mailbox owner organizes. Invitations and cancellations from outside organizers are skipped.
- The client is a small IMAP client on PHP stream sockets (`app/Services/Calendars/Imip/`): no `ext-imap`, no new Composer dependency. TLS is required (`ssl` or `starttls`). Hosts on private addresses are refused unless `WGW_IMIP_ALLOW_PRIVATE_HOSTS=true`.
- The password is encrypted at rest with the same data-dir secret as the SMTP delivery password, under its own key label, and is never returned by the API.
- Skipped and applied replies are logged as `calendar.imip_reply_skipped` / `calendar.imip_reply_applied` with identifiers and a reason code only.

Spec: [.agents/specs/1589-imip-replies/](../../../../.agents/specs/1589-imip-replies/spec.md).

## What is left on purpose

- `GET /mail` and `GET /mail/*` answer **302** to `/` (never 301: a client may return, and browsers cache a permanent redirect). The client router redirects the same paths, because a service worker can serve the shell from cache without asking the server. Old bookmarks and an installed Mail PWA land on the suite home.
- `GET /api/v1/capabilities` and MCP `whoami` still report `mailClient: false`, and the workspace state still reports `availability.mail: false`. Both are contract fields; they stay false.
- MCP `mail.read` and `mail.send` are retired. They are not advertised and not offered on consent, and no tool needs them. Passport still recognizes them: a refresh re-validates a token's scopes, so dropping them would break every grant issued with them. Settings → Connected assistants lists them under Other so an old grant can be revoked.
- The `mail_smtp_*` settings stay: the Admin Email delivery form prefills from them when no delivery host is set. The `mail_user_credentials` table and the `mail_imap_*` settings were dropped with #1589, which stores reply mailboxes in `calendar_reply_mailboxes` instead.
- The installer still accepts the `mail_enabled` / `mail_imap_*` / `mail_smtp_*` payload fields. They do not turn anything on, and `mail_imap_*` is no longer stored.

The client's PHP dependencies went with it: `phpmailer/phpmailer`, `zbateson/mail-mime-parser`, and the `ext-imap` extension in the Docker images and CI. The installer never checks for `imap`. Restoring the client from history means adding them back.

## Product target

The client is Goal [Product#18](https://github.com/WeGotWorkspace/Product/issues/18) on milestone v1.0. This release works alongside existing mail. It is not a mail replacement.

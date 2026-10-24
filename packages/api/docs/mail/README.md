# Mail

WeGotWorkspace has no mailbox client. The unshipped IMAP/SMTP client (mail REST, MCP mail tools, the Mail app, the Settings "Mail accounts" pane and the Admin IMAP pane) was removed in [#1573](https://github.com/WeGotWorkspace/wegotworkspace/issues/1573). The repository history keeps it for a later release.

## Email delivery stays

Admin → Email delivery sends password recovery, invites, and outbound iMIP. It does not read a mailbox. See [mail-delivery.md](../mail-delivery.md). The code lives in `app/Services/MailDelivery/`.

Inbound iMIP (reading replies) is not implemented.

## What is left on purpose

- `GET /mail` and `GET /mail/*` answer **302** to `/` (never 301: a client may return, and browsers cache a permanent redirect). The client router redirects the same paths, because a service worker can serve the shell from cache without asking the server. Old bookmarks and an installed Mail PWA land on the suite home.
- `GET /api/v1/capabilities` and MCP `whoami` still report `mailClient: false`, and the workspace state still reports `availability.mail: false`. Both are contract fields; they stay false.
- MCP `mail.read` and `mail.send` are retired. They are not advertised and not offered on consent, and no tool needs them. Passport still recognizes them: a refresh re-validates a token's scopes, so dropping them would break every grant issued with them. Settings → Connected assistants lists them under Other so an old grant can be revoked.
- Stored data stays. The `mail_user_credentials` table and the `mail_imap_*` / `mail_smtp_*` settings are not dropped. Nothing reads the credentials. The Admin Email delivery form prefills from `mail_smtp_*` when no delivery host is set. A cleanup migration is a separate decision.
- The installer still accepts the `mail_enabled` / `mail_imap_*` / `mail_smtp_*` payload fields. They do not turn anything on.

The client's PHP dependencies went with it: `phpmailer/phpmailer`, `zbateson/mail-mime-parser`, and the `ext-imap` extension in the Docker images and CI. The installer never checks for `imap`. Restoring the client from history means adding them back.

## Product target

The client is Goal [#400](https://github.com/WeGotWorkspace/wegotworkspace/issues/400) on milestone v1.0. This release works alongside existing mail. It is not a mail replacement.

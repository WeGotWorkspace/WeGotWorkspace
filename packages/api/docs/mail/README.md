# Mail in v0.9

The Mail client is not in the v0.9 suite. There is no Mail tile. `GET /mail` and `GET /mail/*` answer **302** to `/` (never 301 — the client returns in v1.0, and browsers cache a permanent redirect). The client router redirects the same paths, because a service worker can serve the shell from cache without asking the server.

An installed Mail PWA has scope `/mail`. Landing on `/` leaves that scope, so the platform may show a URL bar or open the browser. That is expected. Users can uninstall the Mail app.

## What stays in the repo

- [`packages/apps/src/mail-core`](../../../apps/src/mail-core) and its Storybook. The live shell does not mount it.
- `packages/api/app/Services/Mail/` and `MailController`.
- `PUT /api/v1/settings/mail`. The Settings → Mail pane is hidden. A direct `/settings/mail` visit explains that credentials are stored for a later release and this release does not read a mailbox. The login form is not shown.
- Admin → Mail (instance IMAP/SMTP hosts), with a note that those hosts are for the later client.

## What is not on the wire

Mailbox REST (`/api/v1/mail/*`) and MCP `mail_status` / `mail_send` are not registered unless `WGW_MAIL_CLIENT_ENABLED` is set. The default is false. OpenAPI matches that default.

`WGW_MAIL_CLIENT_ENABLED` is unsupported in v0.9 and test-only. Setting it serves routes without a contract and without a UI.

MCP `mail.read` and `mail.send` stay defined in the scope catalog and are hidden on the consent screen. Tokens that already have those scopes stay valid. Refresh does not strip them.

`GET /api/v1/capabilities` and MCP `whoami` report `mailClient: false`. `mail_enabled` in the installer payload does not mean the client is shipped.

Contacts, share flows, and unified search do not link to `/mail`. There is no command palette entry.

## Email delivery is a different feature

Admin → Email delivery stays. It sends password recovery, invites, and outbound iMIP. It does not read a mailbox.

Inbound iMIP (reading replies) is not implemented. Stored credentials exist so that can be built later.

`php-imap` is not part of this release and is not an installer check.

## Product target

The client is Goal [#400](https://github.com/WeGotWorkspace/wegotworkspace/issues/400) on milestone v1.0, not v0.9. This release works alongside existing mail. It is not a mail replacement.

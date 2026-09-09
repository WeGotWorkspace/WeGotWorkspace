# Connect an AI assistant (MCP)

WeGotWorkspace can expose a remote MCP server so Claude, ChatGPT, Mistral, Cursor, or Claude Code act **as you** on this instance (files, mail, calendar, and the other apps you grant). This is not an in-app chat panel. Your administrator must turn **Connected assistants** on in Admin before anyone can connect.

## What you need

- A **public HTTPS** URL for this instance (assistants on the public internet cannot reach `http://192.168.x.x`).
- An account on the instance.
- The **Connected assistants** kill-switch enabled (Admin → Connected assistants). It is off by default.

LAN-only installs can use a tunnel (ngrok, Tailscale Funnel, Cloudflare Tunnel, or similar) so the assistant can complete HTTPS OAuth. **ngrok’s free interstitial page will fail some vendors’ server checks** (often shown as HTTP 500 / “Not found”). Authenticate ngrok (`ngrok config add-authtoken`) so that warning is skipped. Do **not** rewrite the `Host` header to `wegotworkspace.localhost`: OAuth discovery must advertise the public tunnel origin (`/oauth/token` is called from the vendor’s servers).

You will **sign in again** on the instance when you connect. Being signed in to the WeGotWorkspace web app in another tab is not enough: granting an assistant is a high-trust action and always asks for your username and password.

Content the assistant reads may leave this instance for the vendor’s model. Uncheck any permission you do not want on the consent page. You can revoke a single assistant later in **Settings → Connected assistants**.

## Permissions (read vs write)

Consent is grouped by app. Each suite app has a **read** scope and a **write** scope. **Read does not include write.** Search and list tools use `*.read`. Create, update, delete, and share tools use `*.write` (there is no separate `*.share` or `*.search` OAuth id).

| App | Read | Write |
|-----|------|-------|
| Calendar | `calendar.read` | `calendar.write` |
| Notes | `notes.read` | `notes.write` |
| Contacts | `contacts.read` | `contacts.write` |
| Tasks | `tasks.read` | `tasks.write` |
| Docs | `docs.read` | `docs.write` |
| Drive | `drive.read` | `drive.write` |
| Meet | `meet.read` | `meet.write` |

Unchanged:

- `mail.read` — read mailboxes and messages
- `mail.send` — send mail as you
- `settings` — profile (`whoami`)

Refresh tokens are always issued so the assistant stays connected without repeating consent. `offline_access` is still listed in OAuth `scopes_supported` (MCP clients look for that literal id) but it is **not** a consent toggle and is **not** shown in Settings.

`docs.read` does **not** grant Notes. Notes needs `notes.read` / `notes.write`.

### Legacy grants

Existing assistants that already hold a **bare** scope keep working. Bare ids are not the default consent set:

| Legacy id | Grants |
|-----------|--------|
| `calendar` | `calendar.read` and `calendar.write` |
| `drive` | `drive.read` and `drive.write` |
| `tasks` | `tasks.read` and `tasks.write` |
| `contacts` | `contacts.read` and `contacts.write` |
| `docs` | `docs.read` + `docs.write` **and** `notes.read` + `notes.write` |

## Tools

The `capabilities` tool lists **MCP names** (not PHP class names). Tools for a domain appear only when that app is enabled (Admin kill-switches: Files, Calendar, Contacts, Tasks, Notes; Mail via mail enabled). Meet has no separate Admin kill-switch; its tools stay in the catalog when Connected assistants is on.

Search is `*.read`. Share is `*.write`.

| App | Read | Write / share |
|-----|------|----------------|
| Calendar | `calendar_list`, `calendar_events` | `calendar_write`, `calendar_event_write`, `calendar_share` |
| Notes | `notes_search`, `notebook_list`, `notes_query` | `notebook_write`, `note_write`, `notebook_share` |
| Contacts | `contacts_search`, `addressbook_list`, `contact_query` | `addressbook_write` (description / sharee dismiss only — **no** owner create/rename/delete), `contact_write`, `addressbook_share` |
| Tasks | `tasks_list` | `tasklist_write`, `task_write`, `tasklist_share` |
| Docs | `docs_search`, `docs_read` | `docs_write`, `docs_share` (Drive `**.md` text, not collaborative Yjs) |
| Drive | `drive_search`, `drive_list`, `drive_read` | `drive_write` (mkdir / write_text / move / delete), `drive_share` |
| Meet | `meet_channel_list`, `meet_message_list` | `meet_channel_write`, `meet_message_write`, `meet_create_scheduled` |

Always available when MCP is on: `whoami`, `capabilities`.

`meet_create_scheduled` needs `meet.write`. Creating the calendar event half also needs `calendar.write`; without it the tool still creates the meeting-kind channel and returns the href.

**Not MCP apps:** Mail, Admin, and Settings are not exposed as suite apps on MCP. Keep using `whoami` (scope `settings`) and `mail_status` / `mail_send`. There are no Admin tools and no Settings CRUD tools.

**Meet** has no join, call, or RTC/signaling tools. Channel and message CRUD only.

## Instance URL to paste

Use the origin of your site, for example `https://workspace.example.com` — not a path under `/api`.

MCP endpoint: `https://workspace.example.com/mcp`

OAuth discovery is at the **origin root**:

- `https://workspace.example.com/.well-known/oauth-authorization-server`
- `https://workspace.example.com/.well-known/oauth-protected-resource`

## Grok (grok.com)

1. Open [grok.com/connectors](https://grok.com/connectors) → New Connector → Custom.
2. Paste the **public** `/mcp` URL (a hostname xAI’s servers can resolve — not `localhost`).
3. Complete sign-in and consent on this instance. Treat the client origin (for example `https://grok.com`) as the identity.

## Claude (claude.ai)

1. Open Claude → custom connectors / MCP.
2. Add a connector with the **public** `/mcp` URL (a hostname Anthropic’s servers can resolve — not `localhost`).
3. Complete the browser sign-in and consent pages on your instance. The page shows the **client origin** (for example `https://claude.ai`) as the identity — treat that origin as the real client, not a self-asserted name.
4. Approve the app permissions you want (Read / Write per app). Staying connected is not a checkbox: refresh tokens are always issued.

### “Couldn’t determine the server settings”

Do **not** click Next to configure the connector manually. This instance requires OAuth discovery; skipping the check leaves Claude without an authorization server.

That warning means Claude’s probe to `/mcp` failed. Typical causes:

1. **The URL is not reachable from the public internet.** `https://wegotworkspace.localhost/mcp` and `http://127.0.0.1:9080/mcp` work for Cursor / Claude Code on your machine. They never work for claude.ai.
2. **ngrok Host rewrite.** If discovery JSON lists `https://wegotworkspace.localhost/oauth/token`, the tunnel is overwriting `Host`. Do **not** use `--host-header=wegotworkspace.localhost`. Restart ngrok so Host stays public, for example:
   ```bash
   ngrok http https://localhost:443 --url=https://YOUR-SUBDOMAIN.ngrok-free.dev --host-header=YOUR-SUBDOMAIN.ngrok-free.dev
   ```
   Paste that same origin — `https://YOUR-SUBDOMAIN.ngrok-free.dev/mcp` — into ChatGPT/Claude. Copying Connection URL while the admin UI is on `wegotworkspace.localhost` sends assistants to localhost.
3. **Connected assistants is off.** Admin → Connected assistants must be on and saved. When it is off, `/mcp` returns 403.
4. **Authorize URL shows the workspace 404 page** (“Page not found” / “Go to Drive”). The PWA service worker served the SPA instead of Laravel. Unregister service workers for this origin (DevTools → Application → Service Workers) and retry. A rebuilt worker ignores `/oauth`, `/mcp`, and `/.well-known/oauth-*`.
5. **Sign-in and consent succeed, then the assistant shows “Authorization with … failed.”** The browser completed `/oauth/authorize`; the vendor’s **servers** then call `/oauth/token` and `/mcp`. They cannot reach `https://wegotworkspace.localhost`. Re-add the connector using the public tunnel origin — not `localhost`.
6. **Sign-in succeeds, then “your account was authorized, but … returned an error when connecting.”** The vendor stored the token, then `POST /mcp` (initialize) failed. Confirm the connector URL is the public `/mcp` origin, then retry — a UI rebuild is not required. On this instance that handshake is an authenticated JSON-RPC `initialize`; HTTP 500 here is a server bug, not a missing frontend build.
7. **Consent succeeds, but Settings → Connected assistants only lists `mail.read` / `mail.send` / `settings`.** Claude requested the advertised `*.read` / `*.write` catalog; the stored OAuth client was still snapshotted on the older combined ids (`calendar`, `drive`, …). Passport then dropped every non-overlapping scope. Reconnect after this instance refreshes the client allowlist (revoke the assistant, then add the connector again) so the new authorize can grant Calendar, Drive, Notes, and the rest.

From a second machine (or a phone on cellular), confirm:

```bash
curl -sI https://YOUR_PUBLIC_HOST/mcp
```

You want **401** and a `WWW-Authenticate` header that points at `/.well-known/oauth-protected-resource/mcp`. HTML, empty 405, or 5xx will fail the wizard.

Also confirm discovery on the **same host** you pasted:

```bash
curl -sI https://YOUR_PUBLIC_HOST/.well-known/oauth-protected-resource/mcp
curl -sI https://YOUR_PUBLIC_HOST/.well-known/oauth-authorization-server
```

Both should be JSON `200` (not the SPA, not Apache’s default page).

## ChatGPT

1. Add a custom MCP connector / remote MCP server using this instance URL.
2. Sign in again on the instance and approve scopes.
3. ChatGPT then calls tools as you, limited to those scopes and your normal sharing permissions.

## Mistral (Le Chat)

1. Add a custom MCP / connector pointing at this instance.
2. Sign in on the consent page and approve scopes.

## Verify connect (Claude, ChatGPT, Mistral)

Use this checklist after a code change that touches MCP OAuth scopes, CIMD, or `/mcp`. Automated coverage lives in `packages/api/tests/Feature/Mcp/` (run `cd packages/api && composer test -- --filter Mcp`). Vendor UIs are not in CI.

**ChatGPT and Mistral are manual.** Do not mark those vendors done from PHPUnit or from a Claude-only pass.

Shared steps (every vendor):

1. **Revoke** any existing grant for that vendor in Settings → Connected assistants.
2. **Reconnect** using the **public** `https://<host>/mcp` URL. Do **not** rewrite the tunnel `Host` header to `wegotworkspace.localhost`.
3. On consent, grant **Read** and (if you intend to write) **Write** per app. Confirm the page lists `calendar.read` / `calendar.write` (and the other apps), not only `mail.read` / `mail.send` / `settings`. Staying connected is not a permission on this page.
4. After consent, Settings → Connected assistants must show `*.read` / `*.write` ids (for the apps you approved), **not** only `mail.read` + `mail.send` + `settings`. `offline_access` is not listed there.
5. Smoke tools: `whoami`, `capabilities`, then one read tool for an app you granted (`calendar_list`, `drive_list`, or `notes_search`).
6. Call a write tool **only if** that app’s `*.write` (or the matching legacy alias) was granted. A read-only grant must refuse write.
7. **CIMD stale-scope trap:** if Settings shows only mail + settings after a catalog change, the OAuth client was snapshotted on the old combined ids (`calendar`, `drive`, …). Revoke, reconnect, and complete consent again so the client allowlist can include `*.read` / `*.write`. See Claude troubleshooting item 7 above.

### Claude (claude.ai)

- [ ] Shared steps 1–7 against a public `/mcp` URL (Claude.ai cannot reach localhost).
- [ ] GET `/mcp` from a public network is **401** with `WWW-Authenticate` (not empty 405).
- [ ] Do **not** skip OAuth discovery (“configure the connector manually”).

### ChatGPT (manual)

- [ ] Shared steps 1–7 in ChatGPT’s custom MCP / remote MCP connector UI.
- [ ] Consent and Settings scopes match what ChatGPT requested (Read/Write per app).

### Mistral Le Chat (manual)

- [ ] Shared steps 1–7 in Mistral’s custom MCP / connector UI.
- [ ] Consent and Settings scopes match what Mistral requested (Read/Write per app).

## Local clients (Claude Code, Cursor)

The same OAuth flow applies. Loopback redirects such as `http://127.0.0.1:<port>/…` and `http://[::1]:<port>/…` are allowed. The hostname `localhost` is not (it is DNS-controllable on some systems).

## Revoke or turn off

- **One assistant:** Settings → Connected assistants → Revoke access. Access and refresh tokens for that client stop working immediately.
- **Whole instance:** Admin → Connected assistants → turn off and save. Every outstanding grant is revoked. Turning it back on does not restore old connections.

## Self-host / Apache notes

Supported ZIP and Docker installs serve Laravel from the **site document root**, so origin-root `/.well-known/oauth-*` reaches the app.

Docker also mounts REST under `Alias /api`. MCP clients must still discover OAuth at the origin root, not under `/api`. If you mount Laravel only under a path prefix, add rewrite rules so these two paths (and `/.well-known/oauth-protected-resource/<path>`) reach Laravel. See [INSTALL.md](../INSTALL.md) and [install-docker.md](install-docker.md).

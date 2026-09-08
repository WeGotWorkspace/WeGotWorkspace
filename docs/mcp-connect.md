# Connect an AI assistant (MCP)

WeGotWorkspace can expose a remote MCP server so Claude, ChatGPT, Mistral, Cursor, or Claude Code act **as you** on this instance (files, mail, calendar, and the other apps you grant). This is not an in-app chat panel. Your administrator must turn **Connected assistants** on in Admin before anyone can connect.

## What you need

- A **public HTTPS** URL for this instance (assistants on the public internet cannot reach `http://192.168.x.x`).
- An account on the instance.
- The **Connected assistants** kill-switch enabled (Admin → Connected assistants). It is off by default.

LAN-only installs can use a tunnel (ngrok, Tailscale Funnel, Cloudflare Tunnel, or similar) so the assistant can complete HTTPS OAuth. **ngrok’s free interstitial page will fail some vendors’ server checks** (often shown as HTTP 500 / “Not found”). Authenticate ngrok (`ngrok config add-authtoken`) so that warning is skipped. Do **not** rewrite the `Host` header to `wegotworkspace.localhost`: OAuth discovery must advertise the public tunnel origin (`/oauth/token` is called from the vendor’s servers).

You will **sign in again** on the instance when you connect. Being signed in to the WeGotWorkspace web app in another tab is not enough: granting an assistant is a high-trust action and always asks for your username and password.

Content the assistant reads may leave this instance for the vendor’s model. Uncheck any permission you do not want on the consent page. You can revoke a single assistant later in **Settings → Connected assistants**.

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
4. Approve the scopes you want. Leave **offline access** checked if you want the assistant to stay connected without signing in every hour.

### “Couldn’t determine the server settings”

Do **not** click Next to configure the connector manually. This instance requires OAuth discovery; skipping the check leaves Claude without an authorization server.

That warning means Claude’s probe to `/mcp` failed. Typical causes:

1. **The URL is not reachable from the public internet.** `https://wegotworkspace.localhost/mcp` and `http://127.0.0.1:9080/mcp` work for Cursor / Claude Code on your machine. They never work for claude.ai.
2. **ngrok Host rewrite.** If discovery JSON lists `https://wegotworkspace.localhost/oauth/token`, the tunnel is overwriting `Host`. Restart ngrok without that rewrite, for example:
   ```bash
   ngrok http https://localhost:443 --url=https://YOUR-SUBDOMAIN.ngrok-free.dev --host-header=YOUR-SUBDOMAIN.ngrok-free.dev
   ```
   Then paste `https://YOUR-SUBDOMAIN.ngrok-free.dev/mcp` into the assistant.
3. **Connected assistants is off.** Admin → Connected assistants must be on and saved. When it is off, `/mcp` returns 403.
4. **Authorize URL shows the workspace 404 page** (“Page not found” / “Go to Drive”). The PWA service worker served the SPA instead of Laravel. Unregister service workers for this origin (DevTools → Application → Service Workers) and retry. A rebuilt worker ignores `/oauth`, `/mcp`, and `/.well-known/oauth-*`.
5. **Sign-in and consent succeed, then the assistant shows “Authorization with … failed.”** The browser completed `/oauth/authorize`; the vendor’s **servers** then call `/oauth/token` and `/mcp`. They cannot reach `https://wegotworkspace.localhost`. Re-add the connector using the public tunnel origin — not `localhost`.
6. **Sign-in succeeds, then “your account was authorized, but … returned an error when connecting.”** The vendor stored the token, then `POST /mcp` (initialize) failed. Confirm the connector URL is the public `/mcp` origin, then retry — a UI rebuild is not required. On this instance that handshake is an authenticated JSON-RPC `initialize`; HTTP 500 here is a server bug, not a missing frontend build.

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

## Local clients (Claude Code, Cursor)

The same OAuth flow applies. Loopback redirects such as `http://127.0.0.1:<port>/…` and `http://[::1]:<port>/…` are allowed. The hostname `localhost` is not (it is DNS-controllable on some systems).

## Revoke or turn off

- **One assistant:** Settings → Connected assistants → Revoke access. Access and refresh tokens for that client stop working immediately.
- **Whole instance:** Admin → Connected assistants → turn off and save. Every outstanding grant is revoked. Turning it back on does not restore old connections.

## Self-host / Apache notes

Supported ZIP and Docker installs serve Laravel from the **site document root**, so origin-root `/.well-known/oauth-*` reaches the app.

Docker also mounts REST under `Alias /api`. MCP clients must still discover OAuth at the origin root, not under `/api`. If you mount Laravel only under a path prefix, add rewrite rules so these two paths (and `/.well-known/oauth-protected-resource/<path>`) reach Laravel. See [INSTALL.md](../INSTALL.md) and [install-docker.md](install-docker.md).

# Connect an AI assistant (MCP)

WeGotWorkspace can expose a remote MCP server so Claude, ChatGPT, Mistral, Cursor, or Claude Code act **as you** on this instance (files, mail, calendar, and the other apps you grant). This is not an in-app chat panel. Your administrator must turn **Connected assistants** on in Admin before anyone can connect.

## What you need

- A **public HTTPS** URL for this instance (assistants on the public internet cannot reach `http://192.168.x.x`).
- An account on the instance.
- The **Connected assistants** kill-switch enabled (Admin → Connected assistants). It is off by default.

LAN-only installs can use a tunnel (Tailscale Funnel, Cloudflare Tunnel, ngrok, or similar) so the assistant can complete HTTPS OAuth.

You will **sign in again** on the instance when you connect. Being signed in to the WeGotWorkspace web app in another tab is not enough: granting an assistant is a high-trust action and always asks for your username and password.

Content the assistant reads may leave this instance for the vendor’s model. Uncheck any permission you do not want on the consent page. You can revoke a single assistant later in **Settings → Connected assistants**.

## Instance URL to paste

Use the origin of your site, for example `https://workspace.example.com` — not a path under `/api`.

MCP endpoint: `https://workspace.example.com/mcp`

OAuth discovery is at the **origin root**:

- `https://workspace.example.com/.well-known/oauth-authorization-server`
- `https://workspace.example.com/.well-known/oauth-protected-resource`

## Claude (claude.ai)

1. Open Claude → custom connectors / MCP.
2. Add a connector with this instance URL (or the `/mcp` URL if the product asks for the server URL).
3. Complete the browser sign-in and consent pages on your instance. The page shows the **client origin** (for example `https://claude.ai`) as the identity — treat that origin as the real client, not a self-asserted name.
4. Approve the scopes you want. Leave **offline access** checked if you want the assistant to stay connected without signing in every hour.

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

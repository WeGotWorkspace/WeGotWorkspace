# Testing the JMAP envelope against the real frontend client

How to test the jmap client against this backend. The client originated as `@lit-calendar/jmap-client` (external repo, now archived into `packages/apps/src/lib/jmap-client/` as vendored first-class code) and needs **zero code changes**: auth is pure configuration (`JmapClientOptions.headers`), and the Session resource emits absolute URLs built from the request `Host`, which is what makes both setups below work. `tests/Feature/Jmap/JmapClientContractTest.php` replicates the same lifecycle backend-side.

Envelope reference: [jmap-envelope.md](./jmap-envelope.md).

## Backend: one command + one token

```bash
pnpm dev:api                                  # Laravel API on http://127.0.0.1:9080
JMAP_E2E_TOKEN="$(tools/jmap-e2e-token.sh --check)"   # or: pnpm jmap:e2e:token
```

The first `pnpm dev:api` run bootstraps the dev install (`wgw:dev-install`: user `admin`, password `storybook-dev`) and JWT keys. `tools/jmap-e2e-token.sh` mints a bearer via `POST /api/v1/auth/token` and prints it to stdout; `--check` additionally verifies `GET /api/v1/jmap/session` answers 200 with it. Overrides: `--base`, `--username`, `--password` (or `WGW_E2E_*` env vars). If auth fails, reset the dev password with `pnpm setup:storybook-live-api --set-password`.

## Tier 1 — interactive dev loop (Vite proxy, client untouched)

In the **lit-calendar** repo, add a dev proxy so the app and the API share an origin:

```ts
// lit-calendar vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api/v1": {
        target: process.env.WGW_API_TARGET ?? "http://127.0.0.1:9080",
        // Deliberately NO changeOrigin: the Session resource builds apiUrl/
        // downloadUrl/... absolutely from the request Host header. With the
        // Host preserved, apiUrl comes back same-origin with the Vite app, so
        // JmapClient.request() (which fetches apiUrl verbatim, no base-URL
        // resolution) goes back through this proxy — zero CORS involvement.
        configure: (proxy) => {
          const token = process.env.WGW_DEV_TOKEN;
          if (token) {
            proxy.on("proxyReq", (req) => {
              req.setHeader("Authorization", `Bearer ${token}`);
            });
          }
        },
      },
    },
  },
});
```

Run it:

```bash
# in the wegotworkspace repo
pnpm dev:api

# in the lit-calendar repo
WGW_DEV_TOKEN="$(path/to/wegotworkspace/tools/jmap-e2e-token.sh)" pnpm dev
```

Point the app's session URL at `/api/v1/jmap/session` (relative is fine in the browser — same origin). If the app already passes auth itself via `JmapClientOptions.headers`, skip the proxy-side header injection and just supply the token there.

**What to watch in the network tab:** `GET /api/v1/jmap/session` → repeated `POST /api/v1/jmap`. After any create/edit/delete + the next poll, the `CalendarEvent/changes` response must be an incremental delta — an `["error", {"type": "cannotCalculateChanges"}, …]` invocation there means the client fell back to `#refetchAll()`, which is the mismatch-13 regression the envelope exists to prevent.

## Tier 2 — automated e2e with the real client bytes

**One command, from this repo:**

```bash
pnpm test:jmap-client-e2e
```

The jmap client is **vendored into this monorepo** (`packages/apps/src/lib/jmap-client/`, copied verbatim from lit-calendar with its tests and `MockJmapServer`), so no cloning is involved. `tools/test-jmap-client-e2e.sh` starts a local API on `:9080` if none is running (and stops it again on exit — an already-running `pnpm dev:api` is reused), mints a token, and runs the gated suite with the apps vitest setup.

The test lives at [`packages/apps/src/lib/jmap-client/tests/wgw-backend.e2e.test.ts`](../../../apps/src/lib/jmap-client/tests/wgw-backend.e2e.test.ts). It is a gated Vitest suite: Node `fetch` has no browser origin, so no proxy/CORS is involved, auth header only. It skips unless `JMAP_E2E_URL` is set, so the normal offline run against `MockJmapServer` is untouched.

Notes:

- The suite **writes to the dev SQLite** behind `:9080` (and cleans up after itself). Point `JMAP_E2E_URL` at a throwaway instance if that matters; the repo's CI compose (`compose.ci.yml`, used by `pnpm test:api-e2e:docker`) is the existing recipe for a disposable API on `:9080`.
- This is the authoritative complement to `JmapClientContractTest` — same lifecycle, but with the genuine client request bytes and response parsing instead of a backend-side replica.

## CI direction (when ready)

Run `pnpm test:jmap-client-e2e` in this repo's CI against branches that touch `app/Services/Jmap/` or `app/Http/Controllers/Api/V1/Jmap/` — the script handles API boot, token, and cleanup, and the client is in-repo, so no secrets or checkouts are needed. That direction catches backend regressions before merge.

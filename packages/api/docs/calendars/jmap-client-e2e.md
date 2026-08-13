# Testing the JMAP envelope against the real frontend client

How to point the **unmodified** `@lit-calendar/jmap-client` (separate repo, e.g. `~/Sites/lit-calendar`) at this backend — the plan's "option (a)" live-client verification that `tests/Feature/Jmap/JmapClientContractTest.php` replicates backend-side. The client needs **zero code changes**: auth is pure configuration (`JmapClientOptions.headers`), and the Session resource emits absolute URLs built from the request `Host`, which is what makes both setups below work.

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

A gated Vitest suite in **lit-calendar** (Node `fetch` has no browser origin, so no proxy/CORS is involved — auth header only). Skips unless `JMAP_E2E_URL` is set, so the normal offline run against `MockJmapServer` is untouched:

```ts
// lit-calendar packages/jmap-client/src/tests/wgw-backend.e2e.test.ts
// Run: JMAP_E2E_URL=http://127.0.0.1:9080 JMAP_E2E_TOKEN=$(…/tools/jmap-e2e-token.sh) vitest run wgw-backend.e2e
// Adjust imports to the package's actual exports.
import { describe, expect, it } from "vitest";
import { JmapClient } from "../core/JmapClient";
import { JmapCalendarsClient } from "../calendars/JmapCalendarsClient";

const base = process.env.JMAP_E2E_URL;
const token = process.env.JMAP_E2E_TOKEN;
const CALENDARS_URN = "urn:ietf:params:jmap:calendars";

describe.skipIf(!base || !token)("wgw backend e2e (real client, live API)", () => {
  it("runs the full adapter lifecycle incrementally", async () => {
    const client = new JmapClient({
      sessionUrl: `${base}/api/v1/jmap/session`,
      headers: { Authorization: `Bearer ${token}` },
    });

    // connect(): key-checks both URNs, derives accountId from primaryAccounts.
    const session = await client.connect();
    expect(session.capabilities).toHaveProperty(CALENDARS_URN);
    const accountId = session.primaryAccounts[CALENDARS_URN];

    const calendars = new JmapCalendarsClient(client);

    // refreshCalendars() + loadRange() equivalents.
    const calendarGet = await calendars.getCalendars(accountId);
    expect(calendarGet.list.length).toBeGreaterThan(0);
    const calendarState = calendarGet.state;

    const range = {
      after: "2033-01-01T00:00:00Z",
      before: "2033-02-01T00:00:00Z",
    };
    const initial = await calendars.getCalendarEventsInRange(accountId, range);
    const eventState = initial.state;

    // create → flush.
    const set = await calendars.setCalendarEvents({
      accountId,
      create: {
        "e2e-1": {
          calendarIds: { [calendarGet.list[0].id]: true },
          title: "wgw e2e lifecycle",
          start: "2033-01-10T10:00:00",
          duration: "PT1H",
          timeZone: "Etc/UTC",
          "@type": "Event",
        },
      },
    });
    const createdId = set.created["e2e-1"].id;
    expect(createdId).toBeTruthy();

    // post-flush sync(): MUST take the incremental path — a
    // cannotCalculateChanges error here is the mismatch-13 regression
    // (adapter would fall back to the expensive #refetchAll()).
    const calDelta = await calendars.calendarChanges(accountId, calendarState);
    expect(calDelta.newState).toBeTypeOf("string");
    const delta = await calendars.calendarEventChanges(accountId, eventState);
    expect(delta.created).toContain(createdId);

    // self-clean: destroy + verify the next delta reports it.
    await calendars.setCalendarEvents({ accountId, destroy: [createdId] });
    const after = await calendars.calendarEventChanges(accountId, delta.newState);
    expect(after.destroyed).toContain(createdId);
  });
});
```

Notes:

- The suite **writes to the dev SQLite** behind `:9080` (and cleans up after itself). Point `JMAP_E2E_URL` at a throwaway instance if that matters; the repo's CI compose (`compose.ci.yml`, used by `pnpm test:api-e2e:docker`) is the existing recipe for a disposable API on `:9080`.
- This is the authoritative complement to `JmapClientContractTest` — same lifecycle, but with the genuine client request bytes and response parsing instead of a backend-side replica.

## CI direction (when ready)

Run the tier-2 suite in this repo's CI against branches that touch `app/Services/Jmap/` or `app/Http/Controllers/Api/V1/Jmap/`: check out lit-calendar (read token required), boot the API via `compose.ci.yml`, mint a token with `tools/jmap-e2e-token.sh`, run `vitest run wgw-backend.e2e` with `JMAP_E2E_URL`/`JMAP_E2E_TOKEN`. That direction catches backend regressions before merge — the backend is the moving part.

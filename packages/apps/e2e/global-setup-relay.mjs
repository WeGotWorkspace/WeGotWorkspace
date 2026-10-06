import liveGlobalSetup from "./global-setup-live.mjs";

const apiBase = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const username = process.env.WGW_E2E_USERNAME ?? "admin";
const password = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

export default async function globalSetup() {
  await liveGlobalSetup();

  const turnHost = process.env.WGW_TURN_HOST || process.env.TURN_HOST;
  if (!turnHost) {
    throw new Error("Relay tier requires WGW_TURN_HOST or TURN_HOST.");
  }

  const token = await adminAccessToken();
  const secret = process.env.WGW_TURN_SECRET ?? "devsecret";
  const saved = await adminFetch(token, "/api/v1/admin/settings", {
    method: "PUT",
    body: JSON.stringify({
      values: {
        rtc_stun_url: `stun:${turnHost}:3478`,
        // TCP only. Docker Desktop on macOS delivers published UDP into the
        // container but drops the reply. A UDP URL still produces a candidate
        // Chrome can nominate as prflx, so the selected pair is not relay.
        rtc_turn_url: `turn:${turnHost}:3478?transport=tcp`,
        rtc_turn_secret: secret,
      },
    }),
  });
  if (!saved.ok) {
    throw new Error(`Admin TURN settings failed (${saved.status}): ${saved.text}`);
  }

  const health = await adminFetch(token, "/api/v1/admin/realtime-health");
  if (!health.ok) {
    throw new Error(`Realtime health failed (${health.status}): ${health.text}`);
  }
  const body = JSON.parse(health.text);
  if (body.turnConfigured !== true) {
    throw new Error(`TURN is not configured: ${health.text}`);
  }
}

async function adminAccessToken() {
  const response = await fetch(`${apiBase}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Relay admin login failed (${response.status}): ${text}`);
  }
  const tokens = JSON.parse(text);
  if (!tokens.access_token) {
    throw new Error("Relay admin login did not return an access token.");
  }
  return tokens.access_token;
}

async function adminFetch(token, path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

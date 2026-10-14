import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(packageRoot, ".auth");
const authFile = path.join(authDir, "admin.json");

const username = process.env.WGW_E2E_USERNAME ?? "admin";
const password = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const apiBase = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const appOrigin = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default async function globalSetup() {
  try {
    execSync("php artisan cache:clear", {
      cwd: path.join(packageRoot, "..", "api"),
      stdio: "ignore",
    });
  } catch {
    // Best-effort when API package is unavailable; auth may still succeed.
  }

  const response = await fetch(`${apiBase}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `E2E auth setup failed (${response.status}): ${body}\n` +
        "Ensure API is running, run `pnpm setup:storybook-live-api`, and set WGW_DISABLE_LOGIN_THROTTLE=1 for e2e.",
    );
  }

  const tokens = await response.json();
  if (!tokens.access_token) {
    throw new Error("E2E auth setup response missing tokens.");
  }
  const refreshCookie = readRefreshCookie(response);
  const appUrl = new URL(appOrigin);

  await mkdir(authDir, { recursive: true });
  await writeFile(
    authFile,
    JSON.stringify(
      {
        cookies: [
          {
            name: "wgw_refresh",
            value: refreshCookie.value,
            domain: appUrl.hostname,
            path: "/api/v1/auth",
            httpOnly: true,
            sameSite: "Strict",
            secure: appUrl.protocol === "https:",
            expires: refreshCookie.expires,
          },
        ],
        origins: [
          {
            origin: appOrigin,
            localStorage: [
              { name: "wgw.api.access_token", value: tokens.access_token },
              { name: "wgw.api.session_kind", value: "member" },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
}

function readRefreshCookie(response) {
  const lines =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = lines.find((line) => line.toLowerCase().startsWith("wgw_refresh="));
  if (!raw) {
    throw new Error("E2E auth setup response missing the wgw_refresh cookie.");
  }
  const [pair, ...attrs] = raw.split(";").map((part) => part.trim());
  const value = pair.slice("wgw_refresh=".length);
  let maxAge = null;
  let expires = null;
  for (const attr of attrs) {
    const separator = attr.indexOf("=");
    if (separator === -1) continue;
    const key = attr.slice(0, separator).trim().toLowerCase();
    const attrValue = attr.slice(separator + 1).trim();
    if (key === "max-age") maxAge = Number(attrValue);
    if (key === "expires") expires = Date.parse(attrValue) / 1000;
  }
  const expiresAt = Number.isFinite(maxAge) ? Math.floor(Date.now() / 1000) + maxAge : expires;
  if (!value || !Number.isFinite(expiresAt)) {
    throw new Error("E2E auth setup could not parse the wgw_refresh cookie.");
  }
  return { value, expires: expiresAt };
}

export { authFile };

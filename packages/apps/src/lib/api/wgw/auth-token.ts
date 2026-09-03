import { wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";

export type WgwAuthTokenOptions = {
  authToken?: string;
  authTokenUrl?: string;
  authUser?: string;
  authPassword?: string;
};

/**
 * Resolve a bearer token for authenticated collab signaling.
 * Prefers an inline token, then a storybook token URL, then the live WGW session
 * (same store `wgwFetch` uses for `Authorization`).
 */
export async function fetchWgwAuthToken({
  authToken,
  authTokenUrl,
  authUser,
  authPassword,
}: WgwAuthTokenOptions): Promise<string | undefined> {
  if (authToken?.trim()) return authToken.trim();
  if (!authTokenUrl) {
    try {
      const sessionToken = await wgwEnsureFreshAccessToken();
      return sessionToken?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  if (!authUser || !authPassword) {
    throw new Error("Missing auth credentials for authenticated parity story");
  }

  const res = await fetch(authTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: authUser, password: authPassword }),
  });
  const text = await res.text();
  let data: { access_token?: string; error?: string } = {};
  try {
    data = JSON.parse(text) as { access_token?: string; error?: string };
  } catch {
    // ignore; handled by the checks below
  }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Auth token request failed (${res.status})`);
  }
  return data.access_token;
}

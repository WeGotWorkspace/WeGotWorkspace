import { wgwApiBaseUrl, wgwLiveApiEnabled } from "@/lib/api/wgw/http";

class AuthHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthHttpError";
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const base = wgwApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function assertOkResponse(res: Response): Promise<void> {
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new AuthHttpError(res.status, `Auth response was not JSON (${res.status})`);
  }
  if (!res.ok) {
    const err =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : text;
    throw new AuthHttpError(res.status, err || `HTTP ${res.status}`);
  }
}

export async function wgwFetchPasswordRecoveryEnabled(): Promise<boolean> {
  if (!wgwLiveApiEnabled()) return true;
  try {
    const res = await fetch(`${wgwApiBaseUrl()}/capabilities`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const payload = (await res.json()) as { auth?: { passwordRecovery?: unknown } };
    return payload.auth?.passwordRecovery === true;
  } catch {
    return false;
  }
}

export async function wgwRequestPasswordReset(identifier: string): Promise<void> {
  const normalized = identifier.trim();
  if (!normalized) {
    throw new Error("Username or email is required.");
  }
  if (!wgwLiveApiEnabled()) return;
  const res = await postJson("/auth/password-resets", { identifier: normalized });
  await assertOkResponse(res);
}

export async function wgwResetPasswordWithToken(token: string, password: string): Promise<void> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new Error("This reset link is invalid or has expired.");
  }
  if (password.length < 10) {
    throw new Error("Use a password of at least 10 characters.");
  }
  if (!wgwLiveApiEnabled()) return;
  const res = await postJson(`/auth/password-resets/${encodeURIComponent(normalizedToken)}`, {
    password,
  });
  await assertOkResponse(res);
}

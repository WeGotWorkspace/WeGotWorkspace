import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { activeWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { withAuthRefreshLock } from "@/lib/api/wgw/auth-refresh-lock";
import { decodeJwtExp, decodeJwtPayload } from "@/lib/api/wgw/jwt-exp";
import { readLoggedOutMarker, setLoggedOutMarker } from "@/lib/api/wgw/logged-out-marker";
import { appendRefreshFailure, appendSessionCleared } from "@/lib/api/wgw/session-debug";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import * as offlineWipe from "@/lib/offline/core/offline-wipe";
import { tunnelMutatingHttpMethod } from "@/lib/api/wgw/http-method-tunnel";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";

export { WgwSessionRenewalError };

/** When true, mail/notes routes load from WeGotWorkspace instead of mock adapters. */
export function wgwLiveApiEnabled(): boolean {
  const runtime = activeWgwApiRuntime();
  if (runtime) return runtime.useLiveApi;
  const v = parseEnvBoolean(import.meta.env.VITE_WGW_USE_LIVE_API as string | undefined);
  if (v !== null) return v;
  // In bundled/runtime environments we should talk to the real API by default.
  return Boolean(import.meta.env.PROD);
}

function parseEnvBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

/** API root including `/api/v1`. Dev uses the Vite proxy default to avoid CORS. */
export function wgwApiBaseUrl(): string {
  const runtime = activeWgwApiRuntime();
  if (runtime?.baseUrl) return runtime.baseUrl;
  const raw = (import.meta.env.VITE_WGW_API_BASE_URL as string | undefined)?.trim();
  return (raw && raw.length > 0 ? raw : "/api/v1").replace(/\/$/, "");
}

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

export type WgwSessionKind = "member" | "guest";

let accessToken: string | null = null;
let sessionKind: WgwSessionKind | null = null;
let accessExpiresAt: number | null = null;
let refreshExpiresAt: number | null = null;
let refreshPromise: Promise<boolean> | null = null;
let storageWriteFailed = false;
let refreshFailureCount = 0;
let refreshFailureWindowStartedAt: number | null = null;
let refreshRejectedByAuth = false;
/** Last refresh attempt never reached the server (network error while `navigator.onLine`). */
let refreshUnreachable = false;
let legacySwept = false;

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const SESSION_KIND_KEY = "wgw.api.session_kind";
/** Legacy key from before #1175 — removed on boot, never written. */
const LEGACY_REFRESH_TOKEN_KEY = "wgw.api.refresh_token";
const ACCESS_EXPIRES_AT_KEY = "wgw.api.access_expires_at";
const REFRESH_EXPIRES_AT_KEY = "wgw.api.refresh_expires_at";
const GUEST_SHARE_TOKEN_KEY = "wgw.api.guest_share_token";
const GUEST_SHARE_PATH_KEY = "wgw.api.guest_share_path";
const REFRESH_RETRY_CAP = 3;
const REFRESH_RETRY_WINDOW_MS = 15 * 60 * 1_000;
const RETRY_CAP_MARGIN_SEC = 0;

export type WgwSessionClearReason =
  "user_initiated" | "401_online" | "refresh_expired" | "retry_cap_exceeded";

class AuthHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthHttpError";
  }
}

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hasSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function sweepLegacyRefreshToken(): void {
  if (legacySwept || !hasWindowStorage()) return;
  legacySwept = true;
  try {
    window.localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
  } catch {
    // Storage unavailable; nothing to sweep.
  }
}

function readTokensFromStorage(): void {
  sweepLegacyRefreshToken();
  if (!hasWindowStorage() || storageWriteFailed) return;
  try {
    accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedKind = window.localStorage.getItem(SESSION_KIND_KEY);
    sessionKind = storedKind === "member" || storedKind === "guest" ? storedKind : null;
    const accessExpRaw = window.localStorage.getItem(ACCESS_EXPIRES_AT_KEY);
    const refreshExpRaw = window.localStorage.getItem(REFRESH_EXPIRES_AT_KEY);
    accessExpiresAt = parseTimestamp(accessExpRaw);
    refreshExpiresAt = parseTimestamp(refreshExpRaw);
    if (accessToken && accessExpiresAt === null) {
      accessExpiresAt = readAccessExpiryFromJwt(accessToken);
    }
  } catch {
    // Ignore storage failures and keep in-memory fallback.
  }
}

function persistTokens(): void {
  if (!hasWindowStorage()) return;
  try {
    if (accessToken) window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    else window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    if (sessionKind) window.localStorage.setItem(SESSION_KIND_KEY, sessionKind);
    else window.localStorage.removeItem(SESSION_KIND_KEY);
    if (accessExpiresAt !== null)
      window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(accessExpiresAt));
    else window.localStorage.removeItem(ACCESS_EXPIRES_AT_KEY);
    if (refreshExpiresAt !== null) {
      window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(refreshExpiresAt));
    } else {
      window.localStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
    }
    storageWriteFailed = false;
  } catch {
    storageWriteFailed = true;
  }
}

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowMs(): number {
  return Date.now();
}

function readAccessExpiryFromJwt(token: string): number | null {
  const exp = decodeJwtExp(token);
  return exp ? exp * 1_000 : null;
}

function resolveAccessExpiresAt(tokens: TokenResponse): number | null {
  const fromJwt = readAccessExpiryFromJwt(tokens.access_token);
  if (fromJwt !== null) return fromJwt;
  if (typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)) {
    return nowMs() + Math.max(0, tokens.expires_in) * 1_000;
  }
  return null;
}

function resolveRefreshExpiresAt(tokens: TokenResponse): number | null {
  if (
    typeof tokens.refresh_expires_in !== "number" ||
    !Number.isFinite(tokens.refresh_expires_in)
  ) {
    return null;
  }
  return nowMs() + Math.max(0, tokens.refresh_expires_in) * 1_000;
}

function isExpiredAt(timestamp: number | null, marginSec: number): boolean {
  if (timestamp === null) return false;
  return nowMs() + marginSec * 1_000 >= timestamp;
}

function resetRefreshFailures(): void {
  refreshFailureCount = 0;
  refreshFailureWindowStartedAt = null;
  refreshUnreachable = false;
}

function noteRefreshFailure(): void {
  if (!readBrowserOnline()) return;
  const now = nowMs();
  if (
    refreshFailureWindowStartedAt === null ||
    now - refreshFailureWindowStartedAt > REFRESH_RETRY_WINDOW_MS
  ) {
    refreshFailureWindowStartedAt = now;
    refreshFailureCount = 1;
    return;
  }
  refreshFailureCount += 1;
}

export function clearWgwSession(reason: WgwSessionClearReason): void {
  appendSessionCleared(reason, readBrowserOnline(), refreshExpiresAt !== null);
  accessToken = null;
  sessionKind = null;
  accessExpiresAt = null;
  refreshExpiresAt = null;
  resetRefreshFailures();
  refreshRejectedByAuth = false;
  persistTokens();
}

async function postJson(path: string, body: unknown, auth?: string): Promise<Response> {
  const base = wgwApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
}

async function readTokenResponse(res: Response): Promise<TokenResponse> {
  const text = await res.text();
  let j: unknown;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Auth response was not JSON (${res.status})`);
  }
  if (!res.ok) {
    const err =
      j && typeof j === "object" && "error" in j ? String((j as { error: unknown }).error) : text;
    throw new AuthHttpError(res.status, err || `HTTP ${res.status}`);
  }
  const o = j as Record<string, unknown>;
  const at = o.access_token;
  if (typeof at !== "string") {
    throw new Error("Auth response missing access_token");
  }
  const expiresIn = Number(o.expires_in);
  const refreshExpiresIn = Number(o.refresh_expires_in);
  return {
    access_token: at,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : undefined,
    refresh_expires_in: Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : undefined,
  };
}

function applyTokens(tokens: TokenResponse, kind: WgwSessionKind): void {
  accessToken = tokens.access_token;
  sessionKind = kind;
  accessExpiresAt = resolveAccessExpiresAt(tokens);
  refreshExpiresAt = resolveRefreshExpiresAt(tokens);
  persistTokens();
  resetRefreshFailures();
  refreshRejectedByAuth = false;
  setLoggedOutMarker(false);
  if (kind !== "guest") wgwClearGuestShareContext();
}

/** True when the stored session is a public share guest. */
export function wgwIsGuestSession(): boolean {
  readTokensFromStorage();
  return sessionKind === "guest";
}

/** True when access + refresh tokens are present (localStorage or memory). */
export function wgwHasAuthenticatedSession(): boolean {
  readTokensFromStorage();
  return Boolean(accessToken && sessionKind);
}

/** Remember the public share token for guest sign-out return navigation. */
export function wgwPersistGuestShareToken(token: string): void {
  const normalized = token.trim();
  if (!normalized || !hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(GUEST_SHARE_TOKEN_KEY, normalized);
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

export function wgwGuestShareToken(): string | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(GUEST_SHARE_TOKEN_KEY);
    const normalized = raw?.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export function wgwPersistGuestSharePath(apiPath: string): void {
  const normalized = apiPath.trim();
  if (!normalized || !hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(GUEST_SHARE_PATH_KEY, normalized);
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

export function wgwGuestSharePath(): string | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(GUEST_SHARE_PATH_KEY);
    const normalized = raw?.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export function wgwClearGuestShareToken(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(GUEST_SHARE_TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function wgwClearGuestSharePath(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(GUEST_SHARE_PATH_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function wgwClearGuestShareContext(): void {
  wgwClearGuestShareToken();
  wgwClearGuestSharePath();
}

/**
 * Drop a guest access JWT (and share path) before re-exchanging a public share session.
 * Keeps `wgw.api.guest_share_token` so logout / re-auth can return to `/share/:token`.
 */
export function wgwClearGuestShareAccess(): void {
  if (!wgwIsGuestSession()) return;
  clearWgwSession("user_initiated");
  wgwClearGuestSharePath();
}

/**
 * Public-share password rotation (and share revoke) invalidate the DB session while the
 * guest JWT may still be in localStorage. Send the visitor back to `/share/:token`.
 */
export function wgwRedirectGuestShareReauth(): boolean {
  if (typeof window === "undefined") return false;
  if (!wgwIsGuestSession()) return false;
  const shareToken = wgwGuestShareToken();
  clearWgwSession("401_online");
  wgwClearGuestSharePath();
  if (!shareToken) {
    wgwClearGuestShareToken();
    return false;
  }
  window.location.assign(`/share/${encodeURIComponent(shareToken)}`);
  return true;
}

/** Store a guest JWT from POST /files/share-sessions (no refresh flow in v1). */
export function wgwEstablishGuestShareSession(
  response: {
    access_token: string;
    expires_in?: number;
  },
  shareToken?: string,
  sharePath?: string,
): void {
  const expiresIn =
    typeof response.expires_in === "number" && Number.isFinite(response.expires_in)
      ? response.expires_in
      : 3600;
  if (shareToken?.trim()) {
    wgwPersistGuestShareToken(shareToken);
  }
  if (sharePath?.trim()) {
    wgwPersistGuestSharePath(sharePath);
  }
  applyTokens(
    { access_token: response.access_token, expires_in: expiresIn, refresh_expires_in: expiresIn },
    "guest",
  );
}

export type WgwLogoutNavigation = "guest_share" | "guest_reload" | "member_login";

/**
 * Clear the current session and navigate away. Guest share viewers return to the
 * public share entry (or reload) instead of the member login screen.
 */
export async function wgwCompleteLogoutNavigation(): Promise<WgwLogoutNavigation> {
  const isGuest = wgwIsGuestSession();
  const shareToken = wgwGuestShareToken();
  await wgwLogout();
  if (isGuest) {
    if (shareToken) {
      window.location.assign(`/share/${encodeURIComponent(shareToken)}`);
      return "guest_share";
    }
    window.location.reload();
    return "guest_reload";
  }
  return "member_login";
}

/** Current in-memory/storage access token, if available. */
export function wgwCurrentAccessToken(): string | null {
  readTokensFromStorage();
  return accessToken;
}

export function isAccessTokenExpired(marginSec = 180): boolean {
  readTokensFromStorage();
  if (!accessToken) return true;
  if (accessExpiresAt === null) {
    accessExpiresAt = readAccessExpiryFromJwt(accessToken);
    persistTokens();
  }
  return isExpiredAt(accessExpiresAt, marginSec);
}

export function isRefreshTokenExpired(): boolean {
  readTokensFromStorage();
  if (sessionKind !== "member") return true;
  if (refreshExpiresAt === null) return false;
  return isExpiredAt(refreshExpiresAt, 0);
}

/** True when the UI may skip the login form (stored session or dev auto-login). */
export function wgwSessionAvailable(): boolean {
  if (wgwHasAuthenticatedSession()) return true;
  if (readLoggedOutMarker()) return false;
  const username = import.meta.env.VITE_WGW_DEV_USERNAME as string | undefined;
  const password = import.meta.env.VITE_WGW_DEV_PASSWORD as string | undefined;
  return Boolean(username?.trim() && password && password.trim());
}

/** Offline / Storybook: accept any credentials without calling `/auth/token`. */
export function wgwEstablishMockSession(): void {
  applyTokens({ access_token: "mock" }, "member");
}

export async function wgwLoginWithCredentials(username: string, password: string): Promise<void> {
  const normalized = username.trim();
  if (!normalized || !password) {
    throw new Error("Username and password are required.");
  }
  if (!wgwLiveApiEnabled()) {
    wgwEstablishMockSession();
    return;
  }
  const res = await postJson("/auth/token", { username: normalized, password });
  const tokens = await readTokenResponse(res);
  applyTokens(tokens, "member");
}

/** Origin-root Passport login. Relative `/api/v1` stays same-origin (Vite proxy). */
export function wgwOAuthSessionUrl(): string {
  const base = wgwApiBaseUrl();
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL("/oauth/session", base).toString();
    } catch {
      return "/oauth/session";
    }
  }
  return "/oauth/session";
}

/** Laravel web session for Passport `/oauth/authorize`. The SPA JWT is not that session. */
export async function wgwEstablishMcpWebSession(
  username: string,
  password: string,
  intent?: string | null,
): Promise<string | null> {
  const normalized = username.trim();
  if (!normalized || !password) {
    throw new Error("Username and password are required.");
  }
  if (!wgwLiveApiEnabled()) {
    return null;
  }
  const body: Record<string, string> = { username: normalized, password };
  const token = intent?.trim();
  if (token) body.intent = token;
  const res = await fetch(wgwOAuthSessionUrl(), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
  if (payload && typeof payload === "object" && "redirect" in payload) {
    const redirect = (payload as { redirect: unknown }).redirect;
    return typeof redirect === "string" && redirect.startsWith("/") ? redirect : null;
  }
  return null;
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

export async function wgwLogout(): Promise<void> {
  readTokensFromStorage();
  const guest = wgwIsGuestSession();
  setLoggedOutMarker(true);
  if (!guest) {
    await offlineWipe.runLogoutStep(() => offlineWipe.releasePushOnLogout(wgwFetch), "push");
  }
  await offlineWipe.runLogoutStep(async () => {
    if (sessionKind || accessToken) {
      await postJson("/auth/revoke", {}, accessToken ?? undefined);
    }
  }, "revoke");
  setLoggedOutMarker(true);
  if (!guest) {
    await offlineWipe.runLogoutStep(offlineWipe.wipeOfflineAccountData, "wipe");
  }
  clearWgwSession("user_initiated");
}

/** Obtain tokens using `VITE_WGW_DEV_USERNAME` / `VITE_WGW_DEV_PASSWORD` (local `.env.local` only). */
export async function wgwEnsureSession(): Promise<void> {
  readTokensFromStorage();
  if (accessToken && !isAccessTokenExpired()) return;

  if (wgwIsGuestSession()) {
    if (accessToken && !isAccessTokenExpired()) return;
    clearWgwSession("refresh_expired");
    throw new Error("Share session expired. Open the link again.");
  }

  if (sessionKind === "member") {
    if (readBrowserOnline() && isRefreshTokenExpired()) {
      clearWgwSession("refresh_expired");
      throw new Error("Missing auth session. Sign in to continue.");
    }
    const refreshed = await wgwTryRefresh();
    if (refreshed && accessToken) return;
    // Unreachable is offline: the request fails as a network error and hybrid reads fall back to cache.
    if (accessToken && (!readBrowserOnline() || refreshUnreachable)) return;
    if (accessToken) throw new WgwSessionRenewalError();
  }

  if (accessToken && !readBrowserOnline()) return;

  if (readLoggedOutMarker()) {
    throw new Error("Missing auth session. Sign in to continue.");
  }

  const username = import.meta.env.VITE_WGW_DEV_USERNAME as string | undefined;
  const password = import.meta.env.VITE_WGW_DEV_PASSWORD as string | undefined;
  if (!username?.trim() || password === undefined || password === "") {
    throw new Error("Missing auth session. Sign in to continue.");
  }
  await wgwLoginWithCredentials(username.trim(), password);
}

function failRefresh(error: unknown): false {
  const http = error instanceof AuthHttpError ? error : null;
  const cleared = http !== null && (http.status === 401 || http.status === 403);
  if (cleared) {
    refreshRejectedByAuth = true;
    clearWgwSession("401_online");
  } else {
    noteRefreshFailure();
    maybeClearOnRetryCap();
  }
  refreshUnreachable = http === null && isFetchNetworkError(error);
  const reason = http !== null ? "http" : refreshUnreachable ? "network" : "error";
  appendRefreshFailure(reason, {
    status: http?.status ?? null,
    message: error instanceof Error ? error.message : null,
    cleared,
  });
  return false;
}

async function wgwTryRefresh(rejectedAccessToken?: string): Promise<boolean> {
  if (sessionKind !== "member") return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = withAuthRefreshLock(async () => {
    refreshUnreachable = false;
    readTokensFromStorage();
    if (accessToken && accessToken !== rejectedAccessToken && !isAccessTokenExpired()) return true;
    if (sessionKind !== "member") return false;
    if (!readBrowserOnline()) {
      return false;
    }
    if (isRefreshTokenExpired()) {
      appendRefreshFailure("refresh_expired", { cleared: true });
      clearWgwSession("refresh_expired");
      return false;
    }

    try {
      const res = await postJson("/auth/refresh", {});
      const tokens = await readTokenResponse(res);
      applyTokens(tokens, "member");
      return true;
    } catch (error) {
      return failRefresh(error);
    }
  }).then((didRefresh) => {
    if (didRefresh) return true;
    // Another tab owned the lock and may have updated tokens while we waited.
    readTokensFromStorage();
    return Boolean(accessToken && accessToken !== rejectedAccessToken && !isAccessTokenExpired());
  });

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function maybeClearOnRetryCap(): void {
  if (!readBrowserOnline()) return;
  if (refreshFailureCount < REFRESH_RETRY_CAP) return;
  if (refreshFailureWindowStartedAt === null) return;
  if (nowMs() - refreshFailureWindowStartedAt > REFRESH_RETRY_WINDOW_MS) return;
  if (!isAccessTokenExpired(RETRY_CAP_MARGIN_SEC)) return;
  if (!(isRefreshTokenExpired() || refreshRejectedByAuth)) return;
  clearWgwSession("retry_cap_exceeded");
}

export function wgwRefreshInFlight(): Promise<void> | null {
  return refreshPromise ? refreshPromise.then(() => undefined) : null;
}

export async function wgwEnsureFreshAccessToken(): Promise<string | null> {
  await wgwEnsureSession();
  if (accessToken && !isAccessTokenExpired()) return accessToken;

  if (sessionKind === "member") {
    // wgwEnsureSession() just found the server unreachable: do not post the refresh twice.
    if (readBrowserOnline() && !refreshUnreachable) {
      const refreshed = await wgwTryRefresh();
      if (refreshed && accessToken) return accessToken;
    }
  }

  return accessToken;
}

export async function wgwAwaitSessionRefreshForReconnect(): Promise<void> {
  const inFlight = wgwRefreshInFlight();
  if (inFlight) {
    await inFlight;
    return;
  }
  if (!readBrowserOnline()) return;
  try {
    await wgwEnsureFreshAccessToken();
  } catch {
    // Reconnect flows should proceed and let callers surface retry UI.
  }
}

export async function wgwFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await wgwEnsureFreshAccessToken();
  if (!accessToken) {
    throw new Error("Missing auth session. Sign in to continue.");
  }
  const requestInit = tunnelMutatingHttpMethod(init);
  const base = wgwApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;

  const doOnce = (token: string) => {
    const headers = new Headers(requestInit.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...requestInit, headers });
  };

  const token = accessToken!;
  let res = await doOnce(token);
  if (res.status === 401) {
    const ok = await wgwTryRefresh(token);
    if (ok && accessToken) res = await doOnce(accessToken);
    // Refresh failed but was not rejected: the session stands, so this 401 is not a sign-out.
    else if (accessToken && sessionKind === "member") throw new WgwSessionRenewalError();
  }
  return res;
}

/** Read a short error message from a WGW API error response body. */
export function wgwLooksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 240).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<br") ||
    head.includes("<b>warning</b>")
  );
}

export function parseApiErrorJson(
  body: string,
): { error?: unknown; message?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(body) as { error?: unknown; message?: unknown; code?: unknown };
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(body.slice(start, end + 1)) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
      };
    } catch {
      return null;
    }
  }
}

export function wgwErrorMessageFromBody(body: string, status: number, statusText = ""): string {
  const fallback = statusText.trim() || `HTTP ${status}`;
  const trimmed = body.trim();
  if (!trimmed) {
    return fallback;
  }
  const json = parseApiErrorJson(trimmed);
  if (json) {
    const candidate =
      typeof json.error === "string"
        ? json.error
        : typeof json.message === "string"
          ? json.message
          : typeof json.code === "string"
            ? json.code
            : null;
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

export function wgwReadJsonFailureMessage(body: string, status: number): string {
  const fromJson = wgwErrorMessageFromBody(body, status);
  if (fromJson && fromJson !== `HTTP ${status}` && fromJson !== "OK") {
    return fromJson;
  }
  if (wgwLooksLikeHtml(body)) {
    return "Server returned HTML instead of a result";
  }
  return `Server returned a non-JSON response (${status})`;
}

export async function wgwReadJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const extracted = parseApiErrorJson(text);
    if (extracted) return extracted;
    throw new Error(wgwReadJsonFailureMessage(text, res.status));
  }
}

function wgwGuestPrincipalFromAccessToken(token: string): WorkspaceSession {
  const json = decodeJwtPayload(token);
  const username = typeof json?.sub === "string" && json.sub.trim() ? json.sub.trim() : "guest";
  const displayName = "Guest";
  return {
    user: {
      displayName,
      initials: workspaceUserInitials({ displayName }),
      username,
    },
    viewerInboxLabel: "guest",
  };
}

export async function wgwFetchPrincipal(): Promise<WorkspaceSession> {
  readTokensFromStorage();
  if (wgwIsGuestSession()) {
    if (!accessToken) {
      throw new Error("Share session expired. Open the link again.");
    }
    return wgwGuestPrincipalFromAccessToken(accessToken);
  }

  const res = await wgwFetch("/me");
  if (!res.ok) throw new Error(`GET /me failed (${res.status})`);
  const j = (await wgwReadJson(res)) as Record<string, unknown>;
  const meUsername = typeof j.username === "string" ? j.username : "User";

  // Keep identity consistent with Settings when available.
  let settingsUser:
    | {
        username?: string;
        displayName?: string;
        email?: string;
      }
    | undefined;
  try {
    const settingsRes = await wgwFetch("/settings/state");
    if (settingsRes.ok) {
      const settingsJson = (await wgwReadJson(settingsRes)) as Record<string, unknown>;
      const user = settingsJson.user;
      if (user && typeof user === "object") {
        const candidate = user as Record<string, unknown>;
        settingsUser = {
          username: typeof candidate.username === "string" ? candidate.username : undefined,
          displayName:
            typeof candidate.displayName === "string" ? candidate.displayName : undefined,
          email: typeof candidate.email === "string" ? candidate.email : undefined,
        };
      }
    }
  } catch {
    // Optional enrichment only; /me remains the fallback source.
  }

  const username = settingsUser?.username?.trim() || meUsername;
  const explicitDisplayName =
    typeof settingsUser?.displayName === "string"
      ? settingsUser.displayName
      : typeof j.displayName === "string"
        ? j.displayName
        : typeof j.displayname === "string"
          ? j.displayname
          : typeof j.name === "string"
            ? j.name
            : null;
  const normalizedDisplayName =
    explicitDisplayName?.trim() ||
    username
      .trim()
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ||
    "User";
  const user = {
    displayName: normalizedDisplayName,
    initials: workspaceUserInitials({ displayName: normalizedDisplayName }),
    username,
    email: settingsUser?.email ?? (typeof j.email === "string" ? j.email : undefined),
  };
  return { user, viewerInboxLabel: "me" };
}

export function resetWgwSessionStateForTests(keepTokens = false): void {
  refreshPromise = null;
  legacySwept = false;
  if (keepTokens) return;
  accessToken = null;
  sessionKind = null;
  accessExpiresAt = null;
  refreshExpiresAt = null;
  storageWriteFailed = false;
  resetRefreshFailures();
  refreshRejectedByAuth = false;
}

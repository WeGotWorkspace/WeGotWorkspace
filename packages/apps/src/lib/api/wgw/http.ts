import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { activeWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { withAuthRefreshLock } from "@/lib/api/wgw/auth-refresh-lock";
import { decodeJwtExp, decodeJwtPayload } from "@/lib/api/wgw/jwt-exp";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";

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

/**
 * API root including `/api/v1`. In dev, keep the default so requests hit the Vite proxy
 * (see `vite.config.ts`) and avoid CORS against `wegotworkspace.localhost`.
 */
export function wgwApiBaseUrl(): string {
  const runtime = activeWgwApiRuntime();
  if (runtime?.baseUrl) return runtime.baseUrl;
  const raw = (import.meta.env.VITE_WGW_API_BASE_URL as string | undefined)?.trim();
  return (raw && raw.length > 0 ? raw : "/api/v1").replace(/\/$/, "");
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

let accessToken: string | null = null;
let refreshToken: string | null = null;
let accessExpiresAt: number | null = null;
let refreshExpiresAt: number | null = null;
let storageHydrated = false;
let refreshPromise: Promise<boolean> | null = null;
let refreshFailureCount = 0;
let refreshFailureWindowStartedAt: number | null = null;
let refreshRejectedByAuth = false;

/** Sentinel refresh token for public share guest JWTs (no refresh endpoint in v1). */
export const WGW_GUEST_REFRESH_TOKEN = "__guest__";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const REFRESH_TOKEN_KEY = "wgw.api.refresh_token";
const ACCESS_EXPIRES_AT_KEY = "wgw.api.access_expires_at";
const REFRESH_EXPIRES_AT_KEY = "wgw.api.refresh_expires_at";
const LOGGED_OUT_KEY = "wgw.api.logged_out";
const GUEST_SHARE_TOKEN_KEY = "wgw.api.guest_share_token";
const GUEST_SHARE_PATH_KEY = "wgw.api.guest_share_path";
const SESSION_DEBUG_RING_KEY = "wgw.api.session_debug";
const SESSION_DEBUG_RING_MAX = 20;
const REFRESH_RETRY_CAP = 3;
const REFRESH_RETRY_WINDOW_MS = 15 * 60 * 1_000;
const RETRY_CAP_MARGIN_SEC = 0;

export type WgwSessionClearReason =
  | "user_initiated"
  | "401_online"
  | "refresh_expired"
  | "retry_cap_exceeded";

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

function readTokensFromStorage(): void {
  if (!hasWindowStorage()) return;
  try {
    accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
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

function hydrateTokensFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  readTokensFromStorage();
}

function reloadTokensFromStorage(): void {
  storageHydrated = true;
  readTokensFromStorage();
}

function persistTokens(): void {
  if (!hasWindowStorage()) return;
  try {
    if (accessToken) window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    else window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    if (refreshToken) window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    if (accessExpiresAt !== null)
      window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(accessExpiresAt));
    else window.localStorage.removeItem(ACCESS_EXPIRES_AT_KEY);
    if (refreshExpiresAt !== null) {
      window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(refreshExpiresAt));
    } else {
      window.localStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
    }
  } catch {
    // Ignore storage failures and keep in-memory fallback.
  }
}

function readLoggedOutMarker(): boolean {
  if (!hasWindowStorage()) return false;
  try {
    return window.localStorage.getItem(LOGGED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setLoggedOutMarker(value: boolean): void {
  if (!hasWindowStorage()) return;
  try {
    if (value) {
      window.localStorage.setItem(LOGGED_OUT_KEY, "1");
    } else {
      window.localStorage.removeItem(LOGGED_OUT_KEY);
    }
  } catch {
    // Ignore storage failures and keep in-memory fallback.
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

function appendSessionDebugEvent(reason: WgwSessionClearReason): void {
  const payload = {
    event: "wgw.session.cleared",
    reason,
    online: readBrowserOnline(),
    hadRefreshExpiry: refreshExpiresAt !== null,
    timestamp: new Date().toISOString(),
  };
  if (import.meta.env.DEV) {
    console.debug(payload.event, payload);
  }
  if (!hasWindowStorage()) return;
  try {
    const raw = window.localStorage.getItem(SESSION_DEBUG_RING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    const ring = Array.isArray(parsed) ? parsed.slice(-(SESSION_DEBUG_RING_MAX - 1)) : [];
    ring.push(payload);
    window.localStorage.setItem(SESSION_DEBUG_RING_KEY, JSON.stringify(ring));
  } catch {
    // Ignore localStorage debug write failures.
  }
}

export function clearWgwSession(reason: WgwSessionClearReason): void {
  appendSessionDebugEvent(reason);
  accessToken = null;
  refreshToken = null;
  accessExpiresAt = null;
  refreshExpiresAt = null;
  storageHydrated = true;
  resetRefreshFailures();
  refreshRejectedByAuth = false;
  persistTokens();
}

async function postJson(path: string, body: unknown, auth?: string): Promise<Response> {
  const base = wgwApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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
  const rt = o.refresh_token;
  if (typeof at !== "string" || typeof rt !== "string") {
    throw new Error("Auth response missing access_token or refresh_token");
  }
  const expiresIn = Number(o.expires_in);
  const refreshExpiresIn = Number(o.refresh_expires_in);
  return {
    access_token: at,
    refresh_token: rt,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : undefined,
    refresh_expires_in: Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : undefined,
  };
}

function applyTokens(tokens: TokenResponse): void {
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  accessExpiresAt = resolveAccessExpiresAt(tokens);
  refreshExpiresAt = resolveRefreshExpiresAt(tokens);
  storageHydrated = true;
  persistTokens();
  resetRefreshFailures();
  refreshRejectedByAuth = false;
  setLoggedOutMarker(false);
  if (tokens.refresh_token !== WGW_GUEST_REFRESH_TOKEN) {
    wgwClearGuestShareContext();
  }
}

/** True when the stored refresh token marks a public share guest session. */
export function wgwIsGuestSession(): boolean {
  hydrateTokensFromStorage();
  return refreshToken === WGW_GUEST_REFRESH_TOKEN;
}

/** True when access + refresh tokens are present (localStorage or memory). */
export function wgwHasAuthenticatedSession(): boolean {
  hydrateTokensFromStorage();
  return Boolean(accessToken && refreshToken);
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
  applyTokens({
    access_token: response.access_token,
    refresh_token: WGW_GUEST_REFRESH_TOKEN,
    expires_in: expiresIn,
    refresh_expires_in: expiresIn,
  });
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
  hydrateTokensFromStorage();
  return accessToken;
}

export function isAccessTokenExpired(marginSec = 180): boolean {
  hydrateTokensFromStorage();
  if (!accessToken) return true;
  if (accessExpiresAt === null) {
    accessExpiresAt = readAccessExpiryFromJwt(accessToken);
    persistTokens();
  }
  return isExpiredAt(accessExpiresAt, marginSec);
}

export function isRefreshTokenExpired(): boolean {
  hydrateTokensFromStorage();
  if (!refreshToken) return true;
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
  applyTokens({ access_token: "mock", refresh_token: "mock" });
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
  applyTokens(tokens);
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
  hydrateTokensFromStorage();
  setLoggedOutMarker(true);
  try {
    if (refreshToken || accessToken) {
      await postJson(
        "/auth/revoke",
        refreshToken ? { refresh_token: refreshToken } : {},
        accessToken ?? undefined,
      );
    }
  } catch {
    // Best effort: local token cleanup always runs.
  } finally {
    clearWgwSession("user_initiated");
  }
}

/** Obtain tokens using `VITE_WGW_DEV_USERNAME` / `VITE_WGW_DEV_PASSWORD` (local `.env.local` only). */
export async function wgwEnsureSession(): Promise<void> {
  hydrateTokensFromStorage();
  if (accessToken && !isAccessTokenExpired()) return;

  if (wgwIsGuestSession()) {
    if (accessToken && !isAccessTokenExpired()) return;
    clearWgwSession("refresh_expired");
    throw new Error("Share session expired. Open the link again.");
  }

  if (refreshToken) {
    if (readBrowserOnline() && isRefreshTokenExpired()) {
      clearWgwSession("refresh_expired");
      throw new Error("Missing auth session. Sign in to continue.");
    }
    const refreshed = await wgwTryRefresh();
    if (refreshed && accessToken) return;
    if (!readBrowserOnline() && accessToken) return;
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

async function wgwTryRefresh(): Promise<boolean> {
  if (!refreshToken || wgwIsGuestSession()) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = withAuthRefreshLock(async () => {
    hydrateTokensFromStorage();
    if (!refreshToken) return false;
    if (!readBrowserOnline()) return false;

    if (isRefreshTokenExpired()) {
      clearWgwSession("refresh_expired");
      return false;
    }

    try {
      const res = await postJson("/auth/refresh", { refresh_token: refreshToken });
      const tokens = await readTokenResponse(res);
      applyTokens(tokens);
      return true;
    } catch (error) {
      if (error instanceof AuthHttpError && (error.status === 401 || error.status === 403)) {
        refreshRejectedByAuth = true;
        clearWgwSession("401_online");
        return false;
      }

      if (isFetchNetworkError(error)) {
        noteRefreshFailure();
        maybeClearOnRetryCap();
        return false;
      }

      noteRefreshFailure();
      maybeClearOnRetryCap();
      return false;
    }
  }).then((didRefresh) => {
    if (didRefresh) return true;
    // Another tab owned the lock and may have updated tokens while we waited.
    reloadTokensFromStorage();
    return Boolean(accessToken && !isAccessTokenExpired());
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

  if (refreshToken) {
    if (readBrowserOnline()) {
      const refreshed = await wgwTryRefresh();
      if (refreshed && accessToken) return accessToken;
    } else if (accessToken) {
      return accessToken;
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

const TUNNELED_HTTP_METHODS = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Some Apache/nginx frontends redirect PUT/PATCH/DELETE with 301/302, which browsers
 * follow as GET. Tunnel through POST + Symfony/Laravel method override instead.
 */
function tunnelMutatingHttpMethod(init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (!TUNNELED_HTTP_METHODS.has(method)) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set("X-HTTP-Method-Override", method);

  return { ...init, method: "POST", headers };
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

  let res = await doOnce(accessToken!);
  if (res.status === 401) {
    const ok = await wgwTryRefresh();
    if (ok && accessToken) res = await doOnce(accessToken);
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
  hydrateTokensFromStorage();
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

export async function wgwEnsurePluginSession(sessionApiPath: string): Promise<void> {
  if (!wgwLiveApiEnabled()) return;
  let path = sessionApiPath.trim();
  if (path.startsWith("/api/v1")) {
    path = path.slice("/api/v1".length);
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const res = await wgwFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status})`);
  }
}

export function resetWgwSessionStateForTests(): void {
  accessToken = null;
  refreshToken = null;
  accessExpiresAt = null;
  refreshExpiresAt = null;
  storageHydrated = false;
  refreshPromise = null;
  resetRefreshFailures();
  refreshRejectedByAuth = false;
}

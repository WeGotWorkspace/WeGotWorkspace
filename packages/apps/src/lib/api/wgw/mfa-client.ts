import { parseAuthLoginBody, type AuthLoginResult } from "@/lib/api/wgw/auth-login";
import {
  wgwApiBaseUrl,
  wgwApplyTokenResponse,
  wgwFetch,
  wgwLiveApiEnabled,
  wgwReadJson,
} from "@/lib/api/wgw/http";

export class MfaRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "MfaRequestError";
    this.status = status;
    this.code = code;
  }
}

export type TotpProvision = {
  secret: string;
  otpauthUri: string;
  davWarning: boolean;
};

export type MfaAccount = {
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
  suggest: boolean;
};

export type AppPasswordItem = {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedClient: string | null;
};

export type TotpWizardSource = {
  mode: "enroll" | "replace";
  username: string;
  /** Challenge setup is full screen. Session setup can be embedded. */
  presentation: "challenge" | "session";
  /** Enforcement and login challenges cannot be skipped. */
  forced: boolean;
  start: () => Promise<TotpProvision>;
  confirm: (code: string) => Promise<{ recoveryCodes: string[] }>;
};

async function readMfaPayload(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new MfaRequestError(`Auth response was not JSON (${res.status})`, res.status);
    }
  }
  if (!res.ok) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message =
      typeof record.error === "string"
        ? record.error
        : typeof record.message === "string"
          ? record.message
          : `HTTP ${res.status}`;
    const code = typeof record.code === "string" ? record.code : undefined;
    throw new MfaRequestError(message, res.status, code);
  }
  return body;
}

async function postPublic(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${wgwApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readMfaPayload(res);
}

function asProvision(body: unknown): TotpProvision {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof record.secret !== "string" || typeof record.otpauth_uri !== "string") {
    throw new MfaRequestError("Authenticator setup did not return a secret.", 500);
  }
  return {
    secret: record.secret,
    otpauthUri: record.otpauth_uri,
    davWarning: record.dav_warning === true,
  };
}

function recoveryCodesFrom(body: unknown): string[] {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const codes = record.recovery_codes;
  if (!Array.isArray(codes)) return [];
  return codes.filter((code): code is string => typeof code === "string");
}

export async function verifyMfaChallenge(
  challenge: string,
  body: { code?: string; recovery_code?: string },
): Promise<AuthLoginResult> {
  const payload = await postPublic(
    `/auth/mfa-challenges/${encodeURIComponent(challenge)}/verification`,
    body,
  );
  const parsed = parseAuthLoginBody(payload);
  if (parsed.status === "ok") wgwApplyTokenResponse(parsed.tokens);
  return parsed;
}

export async function provisionMfaChallenge(challenge: string): Promise<TotpProvision> {
  return asProvision(
    await postPublic(`/auth/mfa-challenges/${encodeURIComponent(challenge)}/totp`, {}),
  );
}

export async function confirmMfaChallenge(
  challenge: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const payload = await postPublic(
    `/auth/mfa-challenges/${encodeURIComponent(challenge)}/confirmation`,
    { code },
  );
  const parsed = parseAuthLoginBody(payload);
  if (parsed.status !== "ok") {
    throw new MfaRequestError("Confirmation did not return a session.", 500);
  }
  wgwApplyTokenResponse(parsed.tokens);
  return { recoveryCodes: recoveryCodesFrom(payload) };
}

export async function provisionSessionTotp(): Promise<TotpProvision> {
  const res = await wgwFetch("/settings/totp", { method: "POST" });
  return asProvision(await readMfaPayload(res));
}

export async function confirmSessionTotp(code: string): Promise<{ recoveryCodes: string[] }> {
  const res = await wgwFetch("/settings/totp/confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = await readMfaPayload(res);
  const parsed = parseAuthLoginBody(payload);
  if (parsed.status !== "ok") {
    throw new MfaRequestError("Confirmation did not return a session.", 500);
  }
  wgwApplyTokenResponse(parsed.tokens);
  return { recoveryCodes: recoveryCodesFrom(payload) };
}

export function challengeWizardSource(
  login: Exclude<AuthLoginResult, { status: "ok" }>,
  username: string,
): TotpWizardSource | null {
  if (login.status === "mfa_required") return null;
  return {
    mode: login.status === "mfa_replace_required" ? "replace" : "enroll",
    username,
    presentation: "challenge",
    forced: true,
    start: () => provisionMfaChallenge(login.challenge),
    confirm: (code) => confirmMfaChallenge(login.challenge, code),
  };
}

export function sessionWizardSource(username: string, forced: boolean): TotpWizardSource {
  return {
    mode: "enroll",
    username,
    presentation: "session",
    forced,
    start: provisionSessionTotp,
    confirm: confirmSessionTotp,
  };
}

export async function fetchMfaAccount(): Promise<MfaAccount | null> {
  if (!wgwLiveApiEnabled()) return null;
  const res = await wgwFetch("/me");
  if (!res.ok) return null;
  const body = (await wgwReadJson(res)) as { mfa?: Record<string, unknown> };
  const mfa = body.mfa;
  if (!mfa) return null;
  return {
    enabled: mfa.enabled === true,
    required: mfa.required === true,
    recoveryCodesRemaining:
      typeof mfa.recovery_codes_remaining === "number" ? mfa.recovery_codes_remaining : 0,
    suggest: mfa.suggest === true,
  };
}

export async function snoozeMfaSuggestion(): Promise<void> {
  const res = await wgwFetch("/settings/totp/suggestion", { method: "POST" });
  await readMfaPayload(res);
}

export async function listAppPasswords(): Promise<AppPasswordItem[]> {
  const res = await wgwFetch("/settings/app-passwords");
  const body = (await readMfaPayload(res)) as { appPasswords?: AppPasswordItem[] };
  return Array.isArray(body.appPasswords) ? body.appPasswords : [];
}

export async function createAppPassword(
  name: string,
  reauth: { password?: string; code?: string },
): Promise<{ password: string; item: AppPasswordItem }> {
  const res = await wgwFetch("/settings/app-passwords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...reauth }),
  });
  return (await readMfaPayload(res)) as { password: string; item: AppPasswordItem };
}

export async function revokeAppPassword(id: number): Promise<void> {
  const res = await wgwFetch(`/settings/app-passwords/${id}`, { method: "DELETE" });
  await readMfaPayload(res);
}

export async function revokeAllAppPasswords(reauth: {
  password?: string;
  code?: string;
}): Promise<void> {
  const res = await wgwFetch("/settings/app-passwords/revocations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reauth),
  });
  await readMfaPayload(res);
}

export async function disableTotp(reauth: { password?: string; code?: string }): Promise<void> {
  const res = await wgwFetch("/settings/totp", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reauth),
  });
  await readMfaPayload(res);
}

export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
  const res = await wgwFetch("/settings/totp/recovery-codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return recoveryCodesFrom(await readMfaPayload(res));
}

export async function updateMfaEnforcement(required: boolean, code: string): Promise<void> {
  const res = await wgwFetch("/admin/mfa-enforcement", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ required, code }),
  });
  await readMfaPayload(res);
}

export async function resetUserMfa(
  username: string,
  code: string,
  confirmUsername: string,
): Promise<void> {
  const res = await wgwFetch(`/admin/users/${encodeURIComponent(username)}/mfa-resets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, confirm_username: confirmUsername }),
  });
  await readMfaPayload(res);
}

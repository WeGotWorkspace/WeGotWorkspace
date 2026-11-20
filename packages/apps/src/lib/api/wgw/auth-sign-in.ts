import {
  parseApiErrorJson,
  wgwApiBaseUrl,
  wgwApplyMemberTokens,
  wgwEstablishMockSession,
  wgwLiveApiEnabled,
  wgwOAuthSessionUrl,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/**
 * Sign-in with an optional second step (#2270, #2274). `auth/token` and `oauth/session` answer
 * a correct password with tokens (or the assistant's web session), or, for a user with
 * two-factor on, with a challenge. A code redeems the challenge; a recovery code answers
 * `mfa_replace_required` with a new challenge and a new secret, and the user confirms a code
 * from that secret before tokens follow. The recovery code is spent either way.
 *
 * The web app and assistant connect run the same steps on different routes; an `oauth`
 * challenge is only accepted on `oauth/session` and a `spa` one only on the API routes.
 */
/** A new authenticator for a replacement, drawn as a QR code in the browser. */
export type AuthenticatorSecret = { secret: string; otpauthUri: string };

export type SignInStep =
  | { status: "ok"; redirect: string | null }
  | { status: "mfa_required"; challenge: string }
  | { status: "mfa_replace_required"; challenge: string; secret: AuthenticatorSecret };

/** What proves the second step: a code from the app, or one recovery code. */
export type SignInProof = { code: string } | { recoveryCode: string };

export type ReplacementConfirmed = { step: SignInStep; recoveryCodes: string[] };

export type SignInOperations = {
  signIn: (username: string, password: string) => Promise<SignInStep>;
  verify: (challenge: string, proof: SignInProof) => Promise<SignInStep>;
  confirmReplacement: (challenge: string, code: string) => Promise<ReplacementConfirmed>;
};

/** Why a step failed, from the HTTP status and the server's code, never the message. */
export type SignInFailure = "credentials" | "invalid_code" | "expired" | "throttled" | "failed";

export class SignInError extends WgwRequestError {
  readonly reason: SignInFailure;
  /** Set for `throttled` when the server sent `Retry-After`. */
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code: string | undefined,
    reason: SignInFailure,
    retryAfterSeconds: number | null,
  ) {
    super(message, status, code);
    this.name = "SignInError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The credentials step: 401 is a wrong username or password. The code step: 401/422 is a wrong
 * code unless the server says the account itself is refused (`unauthorized`, a user disabled
 * in between). A used or expired challenge is 404/410. Anything else, 403 included, is "failed".
 */
export function signInFailureReason(
  status: number,
  code: string | undefined,
  step: "credentials" | "code",
): SignInFailure {
  if (status === 429) return "throttled";
  if (status === 404 || status === 410) return "expired";
  if (code === "mfa_code_invalid") return "invalid_code";
  if (status === 401 || status === 422) {
    if (step === "credentials" || code === "unauthorized" || code === "invalid")
      return "credentials";
    return "invalid_code";
  }
  // 403 is a refused request (an assistant connect from the wrong origin), not a wrong password.
  return "failed";
}

/** Digits only: a code pasted as `123 456` or `123-456` is `123456`. */
export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]+/g, "");
}

/** Recovery codes compare without spaces or dashes and in lowercase. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toLowerCase();
}

/** A pasted or typed code is complete at six digits. */
export function isCompleteTotpCode(input: string): boolean {
  return /^\d{6}$/.test(normalizeTotpCode(input));
}

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function safeRedirect(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}

function noSecret(): SignInError {
  return new SignInError("Replacement returned no secret.", 500, undefined, "failed", null);
}

/** The step a 200 body describes. Tokens in an `ok` web-app body are applied here. */
export function signInStepFromBody(body: unknown, client: "spa" | "oauth"): SignInStep {
  const o = record(body);
  const challenge = typeof o.challenge === "string" ? o.challenge : "";
  if (o.status === "mfa_required" && challenge) return { status: o.status, challenge };
  if (o.status === "mfa_replace_required" && challenge) {
    if (typeof o.secret !== "string" || typeof o.otpauth_uri !== "string") throw noSecret();
    return { status: o.status, challenge, secret: { secret: o.secret, otpauthUri: o.otpauth_uri } };
  }
  if (client === "spa") wgwApplyMemberTokens(o);
  return { status: "ok", redirect: client === "oauth" ? safeRedirect(o.redirect) : null };
}

function recoveryCodesFrom(body: unknown): string[] {
  const codes = record(body).recovery_codes;
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string") : [];
}

const DEFAULT_THROTTLE_SECONDS: number | null = null;

async function post(
  url: string,
  body: unknown,
  step: "credentials" | "code",
): Promise<{ body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    const code = parseApiErrorJson(text.trim())?.code;
    const codeString = typeof code === "string" ? code : undefined;
    const message = typeof record(parsed).error === "string" ? String(record(parsed).error) : "";
    const retry = Number(res.headers.get("Retry-After"));
    throw new SignInError(
      message || `Sign-in failed (${res.status})`,
      res.status,
      codeString,
      signInFailureReason(res.status, codeString, step),
      Number.isFinite(retry) && retry > 0 ? retry : DEFAULT_THROTTLE_SECONDS,
    );
  }
  return { body: parsed };
}

function apiUrl(path: string): string {
  return `${wgwApiBaseUrl()}${path}`;
}

function challengePath(challenge: string, action: string): string {
  return apiUrl(`/auth/mfa-challenges/${encodeURIComponent(challenge)}/${action}`);
}

function proofBody(proof: SignInProof): Record<string, string> {
  return "code" in proof
    ? { code: normalizeTotpCode(proof.code) }
    : { recovery_code: normalizeRecoveryCode(proof.recoveryCode) };
}

/** The web app: `auth/token`, then the challenge routes. */
export function createWgwSignInOperations(): SignInOperations {
  return {
    signIn: async (username, password) => {
      const { body } = await post(apiUrl("/auth/token"), { username, password }, "credentials");
      return signInStepFromBody(body, "spa");
    },
    verify: async (challenge, proof) => {
      const { body } = await post(
        challengePath(challenge, "verification"),
        proofBody(proof),
        "code",
      );
      return signInStepFromBody(body, "spa");
    },
    confirmReplacement: async (challenge, code) => {
      const { body } = await post(
        challengePath(challenge, "replacement"),
        { code: normalizeTotpCode(code) },
        "code",
      );
      return { step: signInStepFromBody(body, "spa"), recoveryCodes: recoveryCodesFrom(body) };
    },
  };
}

/**
 * Assistant connect: `oauth/session` starts the Laravel web session Passport's authorize page
 * needs. Without a second step the web app is signed in too, as before; with one, only the
 * assistant's session is made (its challenge cannot be redeemed for web-app tokens).
 */
export function createWgwAssistantSignInOperations(intent?: string | null): SignInOperations {
  const withIntent = (body: Record<string, string>) => {
    const token = intent?.trim();
    return token ? { ...body, intent: token } : body;
  };
  const session = (body: Record<string, string>, step: "credentials" | "code") =>
    post(wgwOAuthSessionUrl(), withIntent(body), step);
  return {
    signIn: async (username, password) => {
      const { body } = await session({ username, password }, "credentials");
      const step = signInStepFromBody(body, "oauth");
      if (step.status === "ok") {
        try {
          const spa = await post(apiUrl("/auth/token"), { username, password }, "credentials");
          signInStepFromBody(spa.body, "spa");
        } catch {
          // Passport authorize needs the web session; the web-app tokens are optional.
        }
      }
      return step;
    },
    verify: async (challenge, proof) => {
      const { body } = await session({ challenge, ...proofBody(proof) }, "code");
      return signInStepFromBody(body, "oauth");
    },
    confirmReplacement: async (challenge, code) => {
      const { body } = await session({ challenge, code: normalizeTotpCode(code) }, "code");
      return { step: signInStepFromBody(body, "oauth"), recoveryCodes: recoveryCodesFrom(body) };
    },
  };
}

/** Without an API (Storybook, offline demo): any password signs in, no second step. */
export function createLocalSignInOperations(): SignInOperations {
  const ok: SignInStep = { status: "ok", redirect: null };
  return {
    signIn: async () => {
      wgwEstablishMockSession();
      return ok;
    },
    verify: async () => ok,
    confirmReplacement: async () => ({ step: ok, recoveryCodes: [] }),
  };
}

/** The operations the login screen uses for the web app or for assistant connect. */
export function defaultSignInOperations(
  target: { kind: "spa" } | { kind: "oauth"; intent?: string | null },
): SignInOperations {
  if (!wgwLiveApiEnabled()) return createLocalSignInOperations();
  return target.kind === "oauth"
    ? createWgwAssistantSignInOperations(target.intent)
    : createWgwSignInOperations();
}

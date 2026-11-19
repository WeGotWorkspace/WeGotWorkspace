import { settingsRequestFailure } from "@/lib/api/wgw/app-passwords";
import type { AuthenticatorSecret } from "@/lib/api/wgw/auth-sign-in";
import { normalizeTotpCode } from "@/lib/api/wgw/auth-sign-in";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/**
 * Two-factor sign-in in Settings → Security (#2273, #2275): start with the account password
 * (a secret and its `otpauth://` URI), confirm with the account password and a code (recovery
 * codes), turn off with a code, replace the recovery codes with a code. A wrong account
 * password is 403, a wrong code 401/422 `mfa_code_invalid`, a limit 429 with `Retry-After`,
 * confirm while it is already on 409.
 */
const PATH = "/settings/totp";

export type TwoFactorState = {
  enabled: boolean;
  /** Unused recovery codes; null when the server does not say. */
  recoveryCodesRemaining: number | null;
};

export type TwoFactorSetup = AuthenticatorSecret & {
  /** When a calendar, contacts or meeting app last signed in with the account password. */
  davPasswordUsedAt: string | null;
};

export type TwoFactorOperations = {
  state: () => Promise<TwoFactorState>;
  start: (currentPassword: string) => Promise<TwoFactorSetup>;
  confirm: (currentPassword: string, code: string) => Promise<string[]>;
  disable: (code: string) => Promise<void>;
  replaceRecoveryCodes: (code: string) => Promise<string[]>;
};

/** How many recovery codes a set has. */
export const RECOVERY_CODE_COUNT = 10;

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** `mfa` from `GET /me`: `{ enabled, recoveryCodesRemaining }`. */
export function twoFactorStateFromMe(body: unknown): TwoFactorState {
  const mfa = record(record(body).mfa);
  const remaining = mfa.recoveryCodesRemaining;
  return {
    enabled: mfa.enabled === true,
    recoveryCodesRemaining: typeof remaining === "number" ? remaining : null,
  };
}

function recoveryCodes(body: unknown): string[] {
  const codes = record(body).recovery_codes;
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string") : [];
}

async function send(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await wgwFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await settingsRequestFailure(res, method, path);
  return res.status === 204 ? {} : wgwReadJson(res);
}

export function createWgwTwoFactorOperations(): TwoFactorOperations {
  return {
    state: async () => twoFactorStateFromMe(await send("GET", "/me")),
    start: async (currentPassword) => {
      const o = record(await send("POST", PATH, { currentPassword }));
      if (typeof o.secret !== "string" || typeof o.otpauth_uri !== "string") {
        throw new WgwRequestError("Two-factor setup returned no secret.", 500);
      }
      return {
        secret: o.secret,
        otpauthUri: o.otpauth_uri,
        davPasswordUsedAt: typeof o.davPasswordUsedAt === "string" ? o.davPasswordUsedAt : null,
      };
    },
    confirm: async (currentPassword, code) =>
      recoveryCodes(
        await send("POST", `${PATH}/confirmation`, {
          currentPassword,
          code: normalizeTotpCode(code),
        }),
      ),
    disable: async (code) => {
      await send("DELETE", PATH, { code: normalizeTotpCode(code) });
    },
    replaceRecoveryCodes: async (code) =>
      recoveryCodes(
        await send("POST", `${PATH}/recovery-codes`, { code: normalizeTotpCode(code) }),
      ),
  };
}

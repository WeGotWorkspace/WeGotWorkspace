import {
  parseApiErrorJson,
  wgwErrorMessageFromBody,
  wgwFetch,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  SettingsAppPassword,
  SettingsAppPasswordCreated,
  SettingsAppPasswordCreateRequest,
  SettingsAppPasswordList,
} from "@wgw/openapi-types/settings-types";

/**
 * Named app passwords for calendar and contacts apps (#2271, #2272). The plaintext
 * comes back once, from create; the list never carries it. Creating one asks for the account
 * password: a wrong one is 403 `current_password_invalid`, too many tries are 429 `throttled`
 * (no `Retry-After`), more than 50 active ones are 422 `app_password_limit`. A bad name is 400.
 * Delete and revoke-all answer 200 `{ ok: true }`.
 */
const PATH = "/settings/app-passwords";

export type AppPassword = SettingsAppPassword;

export type AppPasswordCreated = SettingsAppPasswordCreated;

/**
 * With two-factor on, a current code instead of the account password (#2275); a wrong code is
 * 403 `mfa_code_invalid`, like replacing recovery codes.
 */
export type AppPasswordCreateInput =
  SettingsAppPasswordCreateRequest | { name: string; code: string };

export type AppPasswordOperations = {
  list: () => Promise<AppPassword[]>;
  create: (input: AppPasswordCreateInput) => Promise<AppPasswordCreated>;
  revoke: (id: number) => Promise<void>;
  revokeAll: () => Promise<void>;
};

/** Longest name the server stores. */
export const APP_PASSWORD_NAME_MAX = 60;

/**
 * A 429. `retryAfterSeconds` is the `Retry-After` header when the server sent one; the
 * create limit (the profile current-password check) sends none, so it is null there.
 */
export class AppPasswordThrottledError extends WgwRequestError {
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null, code?: string) {
    super(message, 429, code);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** At most this many active app passwords per user: 422 `app_password_limit`. */
export const APP_PASSWORD_LIMIT = 50;

/** The error for a failed settings request: 429 carries `Retry-After`, the rest status + code. */
export async function settingsRequestFailure(
  res: Response,
  method: string,
  path: string,
): Promise<WgwRequestError> {
  const body = await res.text();
  const detail = wgwErrorMessageFromBody(body, res.status, res.statusText);
  const parsed = parseApiErrorJson(body.trim())?.code;
  const code = typeof parsed === "string" ? parsed : undefined;
  const message = `${method} ${path} failed (${res.status}): ${detail}`;
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After"));
    return new AppPasswordThrottledError(
      message,
      Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      code,
    );
  }
  return new WgwRequestError(message, res.status, code);
}

export function createWgwAppPasswordOperations(): AppPasswordOperations {
  return {
    list: async () => {
      const res = await wgwFetch(PATH);
      if (!res.ok) throw await settingsRequestFailure(res, "GET", PATH);
      const body = (await wgwReadJson(res)) as Partial<SettingsAppPasswordList>;
      return Array.isArray(body.appPasswords) ? body.appPasswords : [];
    },
    create: async (input) => {
      const res = await wgwFetch(PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await settingsRequestFailure(res, "POST", PATH);
      return (await wgwReadJson(res)) as AppPasswordCreated;
    },
    revoke: async (id) => {
      const path = `${PATH}/${encodeURIComponent(String(id))}`;
      const res = await wgwFetch(path, { method: "DELETE" });
      // Already gone (another tab, another device) is what the user asked for.
      if (!res.ok && res.status !== 404) throw await settingsRequestFailure(res, "DELETE", path);
    },
    revokeAll: async () => {
      const path = `${PATH}/revocations`;
      const res = await wgwFetch(path, { method: "POST" });
      if (!res.ok) throw await settingsRequestFailure(res, "POST", path);
    },
  };
}

/** `abcdefghijklmnop` → `abcd efgh ijkl mnop`; the server strips the spaces again. */
export function formatAppPassword(password: string): string {
  return (
    password
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}

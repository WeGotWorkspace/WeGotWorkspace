import {
  parseApiErrorJson,
  wgwErrorMessageFromBody,
  wgwFetch,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/**
 * Named app passwords for calendar, contacts and meeting apps (#2271, #2272). The plaintext
 * comes back once, from create; the list never carries it. Creating one asks for the account
 * password: a wrong one is 403 `current_password_invalid`, too many tries are 429 `throttled`
 * with `Retry-After` (the sign-in limit).
 */
const PATH = "/settings/app-passwords";

export type AppPassword = {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** The client that last signed in with it, from its User-Agent ("DAVx5/4.4", "macOS/15 …"). */
  lastUsedClient: string | null;
};

export type AppPasswordCreated = {
  /** Sixteen lowercase letters, shown once. */
  password: string;
  appPassword: AppPassword;
};

export type AppPasswordOperations = {
  list: () => Promise<AppPassword[]>;
  create: (input: { name: string; currentPassword: string }) => Promise<AppPasswordCreated>;
  revoke: (id: number) => Promise<void>;
  revokeAll: () => Promise<void>;
};

/** Longest name the server stores. */
export const APP_PASSWORD_NAME_MAX = 60;

/** A 429: the sign-in limit says when the next try may run (`Retry-After`, seconds). */
export class AppPasswordThrottledError extends WgwRequestError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, code?: string) {
    super(message, 429, code);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

async function failure(res: Response, method: string, path: string): Promise<WgwRequestError> {
  const body = await res.text();
  const detail = wgwErrorMessageFromBody(body, res.status, res.statusText);
  const parsed = parseApiErrorJson(body.trim())?.code;
  const code = typeof parsed === "string" ? parsed : undefined;
  const message = `${method} ${path} failed (${res.status}): ${detail}`;
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After"));
    return new AppPasswordThrottledError(
      message,
      Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS,
      code,
    );
  }
  return new WgwRequestError(message, res.status, code);
}

export function createWgwAppPasswordOperations(): AppPasswordOperations {
  return {
    list: async () => {
      const res = await wgwFetch(PATH);
      if (!res.ok) throw await failure(res, "GET", PATH);
      const body = (await wgwReadJson(res)) as { appPasswords?: AppPassword[] };
      return Array.isArray(body.appPasswords) ? body.appPasswords : [];
    },
    create: async (input) => {
      const res = await wgwFetch(PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await failure(res, "POST", PATH);
      return (await wgwReadJson(res)) as AppPasswordCreated;
    },
    revoke: async (id) => {
      const path = `${PATH}/${encodeURIComponent(String(id))}`;
      const res = await wgwFetch(path, { method: "DELETE" });
      // Already gone (another tab, another device) is what the user asked for.
      if (!res.ok && res.status !== 404) throw await failure(res, "DELETE", path);
    },
    revokeAll: async () => {
      const path = `${PATH}/revocations`;
      const res = await wgwFetch(path, { method: "POST" });
      if (!res.ok) throw await failure(res, "POST", path);
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

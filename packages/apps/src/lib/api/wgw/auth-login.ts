export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

export type MfaClient = "spa" | "oauth";

export type AuthLoginChallengeResult =
  | {
      status: "mfa_required";
      challenge: string;
      methods: Array<"totp" | "recovery">;
      client: MfaClient;
    }
  | { status: "mfa_setup_required"; challenge: string; client: MfaClient }
  | { status: "mfa_replace_required"; challenge: string; client: MfaClient };

export type AuthLoginResult = { status: "ok"; tokens: TokenPair } | AuthLoginChallengeResult;

export class AuthLoginChallenge extends Error {
  readonly login: AuthLoginChallengeResult;

  constructor(login: AuthLoginChallengeResult) {
    super(login.status);
    this.name = "AuthLoginChallenge";
    this.login = login;
  }
}

export function parseAuthLoginBody(body: unknown): AuthLoginResult {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const status = record.status;
  const challenge = typeof record.challenge === "string" ? record.challenge : "";
  const client: MfaClient = record.client === "oauth" ? "oauth" : "spa";
  if (status === "mfa_required" && challenge) {
    const methods = Array.isArray(record.methods)
      ? record.methods.filter(
          (method): method is "totp" | "recovery" => method === "totp" || method === "recovery",
        )
      : (["totp", "recovery"] as Array<"totp" | "recovery">);
    return {
      status,
      challenge,
      methods: methods.length > 0 ? methods : ["totp", "recovery"],
      client,
    };
  }
  if ((status === "mfa_setup_required" || status === "mfa_replace_required") && challenge) {
    return { status, challenge, client };
  }

  const accessToken = record.access_token;
  const refreshToken = record.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new Error("Auth response missing access_token or refresh_token");
  }
  const expiresIn = Number(record.expires_in);
  const refreshExpiresIn = Number(record.refresh_expires_in);
  return {
    status: "ok",
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number.isFinite(expiresIn) ? expiresIn : undefined,
      refresh_expires_in: Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : undefined,
    },
  };
}

const TOKEN_STORAGE_KEYS = new Set([
  "wgw.api.access_token",
  "wgw.api.refresh_token",
  "wgw.api.access_expires_at",
  "wgw.api.refresh_expires_at",
]);

/** Other tabs hear `storage` when this tab writes or clears token keys. */
export function shouldLeaveForLoginAfterStorage(input: {
  key: string | null;
  hadSession: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  pathname: string;
}): boolean {
  if (input.key !== null && !TOKEN_STORAGE_KEYS.has(input.key)) return false;
  if (input.pathname === "/login" || input.pathname.endsWith("/login")) return false;
  if (input.accessToken || input.refreshToken) return false;
  return input.hadSession;
}

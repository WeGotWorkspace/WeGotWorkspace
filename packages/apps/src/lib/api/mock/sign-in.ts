import {
  normalizeRecoveryCode,
  normalizeTotpCode,
  SignInError,
  type SignInOperations,
  type SignInStep,
} from "@/lib/api/wgw/auth-sign-in";

/** What the mock accepts; everything else is refused like the server refuses it. */
export const MOCK_SIGN_IN = {
  password: "storybook-dev",
  /** Signs in with a second step; any other username signs in with the password alone. */
  twoFactorUser: "alice",
  code: "123456",
  /** Answers the 429 of the per-user pause. */
  throttledCode: "999999",
  /** Answers 404: the challenge expired. */
  expiredCode: "111111",
  recoveryCode: "abcde-fghij",
  secret: "JBSWY3DPEHPK3PXP",
  recoveryCodes: [
    "kq7rm-2xv9p",
    "a8d3f-wn6ty",
    "p4hzc-9mbe2",
    "t6yuv-3ks8q",
    "x2nfg-7jr4w",
    "c9bwe-5qd6m",
    "h3tpk-8vy2n",
    "m5rxa-4cz7f",
    "e7jqs-6gw3b",
    "w8ufd-2nk5h",
  ],
} as const;

function refused(status: number, code: string, reason: SignInError["reason"]): SignInError {
  return new SignInError(`mock ${code}`, status, code, reason, status === 429 ? 3600 : null);
}

/**
 * The login screen's steps without a server (#2274 stories and tests): the password, then for
 * `alice` a code or a recovery code, then after a recovery code a new authenticator. `redirect`
 * is the assistant connect target the `ok` step carries.
 */
export function createMockSignInOperations(
  options: { redirect?: string | null; latencyMs?: number } = {},
): SignInOperations {
  const ok: SignInStep = { status: "ok", redirect: options.redirect ?? null };
  const wait = () =>
    options.latencyMs ? new Promise((resolve) => setTimeout(resolve, options.latencyMs)) : null;
  let serial = 0;
  const challenge = () => `mock-challenge-${++serial}`;
  return {
    signIn: async (username, password) => {
      await wait();
      if (password !== MOCK_SIGN_IN.password) throw refused(401, "unauthorized", "credentials");
      if (password === MOCK_SIGN_IN.password && username === "throttled") {
        throw refused(429, "throttled", "throttled");
      }
      return username.trim() === MOCK_SIGN_IN.twoFactorUser
        ? { status: "mfa_required", challenge: challenge() }
        : ok;
    },
    verify: async (_challenge, proof) => {
      await wait();
      if ("recoveryCode" in proof) {
        if (
          normalizeRecoveryCode(proof.recoveryCode) !== MOCK_SIGN_IN.recoveryCode.replace("-", "")
        ) {
          throw refused(401, "mfa_code_invalid", "invalid_code");
        }
        return { status: "mfa_replace_required", challenge: challenge() };
      }
      const code = normalizeTotpCode(proof.code);
      if (code === MOCK_SIGN_IN.throttledCode) throw refused(429, "throttled", "throttled");
      if (code === MOCK_SIGN_IN.expiredCode) throw refused(404, "not_found", "expired");
      if (code !== MOCK_SIGN_IN.code) throw refused(401, "mfa_code_invalid", "invalid_code");
      return ok;
    },
    startReplacement: async () => {
      await wait();
      return {
        secret: MOCK_SIGN_IN.secret,
        otpauthUri: `otpauth://totp/WeGotWorkspace:alice?secret=${MOCK_SIGN_IN.secret}&issuer=WeGotWorkspace`,
      };
    },
    confirmReplacement: async (_challenge, code) => {
      await wait();
      if (normalizeTotpCode(code) !== MOCK_SIGN_IN.code) {
        throw refused(401, "mfa_code_invalid", "invalid_code");
      }
      return { step: ok, recoveryCodes: [...MOCK_SIGN_IN.recoveryCodes] };
    },
  };
}

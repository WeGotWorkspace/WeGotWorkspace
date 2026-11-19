import {
  normalizeRecoveryCode,
  normalizeTotpCode,
  SignInError,
  type AuthenticatorSecret,
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
  /** Recovery codes are 16 lowercase hex characters in groups of four. */
  recoveryCode: "3f9a-c27e-81d4-0b6e",
  secret: "JBSWY3DPEHPK3PXP",
  recoveryCodes: [
    "a41c-9e07-d3b2-5f68",
    "07be-42d9-c1a5-e836",
    "d95f-3a1c-60e4-b27d",
    "6c28-f0b9-17ad-4e53",
    "b3e7-58c2-a90f-1d64",
    "2f01-dc96-7b3e-85a4",
    "e8a4-1b75-3c0d-f926",
    "91d6-e2f3-4a87-0cb5",
    "5a3b-07c8-ef12-96d4",
    "c7f2-6d49-b85e-3a01",
  ],
} as const;

function mockSecret(): AuthenticatorSecret {
  return {
    secret: MOCK_SIGN_IN.secret,
    otpauthUri: `otpauth://totp/WeGotWorkspace:alice?secret=${MOCK_SIGN_IN.secret}&issuer=WeGotWorkspace`,
  };
}

function refused(status: number, code: string, reason: SignInError["reason"]): SignInError {
  return new SignInError(`mock ${code}`, status, code, reason, status === 429 ? 3600 : null);
}

/**
 * The login screen's steps without a server (#2274 stories and tests): the password, then for
 * `alice` a code or a recovery code, then after a recovery code a new authenticator (its secret comes with the step). `redirect`
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
          normalizeRecoveryCode(proof.recoveryCode) !==
          normalizeRecoveryCode(MOCK_SIGN_IN.recoveryCode)
        ) {
          throw refused(401, "mfa_code_invalid", "invalid_code");
        }
        return { status: "mfa_replace_required", challenge: challenge(), secret: mockSecret() };
      }
      const code = normalizeTotpCode(proof.code);
      if (code === MOCK_SIGN_IN.throttledCode) throw refused(429, "throttled", "throttled");
      if (code === MOCK_SIGN_IN.expiredCode) throw refused(404, "not_found", "expired");
      if (code !== MOCK_SIGN_IN.code) throw refused(401, "mfa_code_invalid", "invalid_code");
      return ok;
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

import { MOCK_ACCOUNT_PASSWORD } from "@/lib/api/mock/app-passwords";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { AppPasswordThrottledError } from "@/lib/api/wgw/app-passwords";
import { normalizeTotpCode } from "@/lib/api/wgw/auth-sign-in";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { TwoFactorOperations, TwoFactorState } from "@/lib/api/wgw/two-factor-settings";

/**
 * In-memory stand-in for `/api/v1/settings/totp` with the server's rules: the account password
 * is `storybook-dev` (`throttled` trips the limit), the code is `123456` (`999999` trips the
 * one-hour per-user pause). `davPasswordUsedAt` is what start reports about calendar and contacts apps.
 */
export function createMockTwoFactorOperations(
  initial: TwoFactorState = { enabled: false, recoveryCodesRemaining: null },
  options: { davPasswordUsedAt?: string | null; failState?: boolean; latencyMs?: number } = {},
): TwoFactorOperations {
  let state = { ...initial };
  let started = false;
  const wait = () =>
    options.latencyMs ? new Promise((resolve) => setTimeout(resolve, options.latencyMs)) : null;
  const checkPassword = (password: string) => {
    if (password === "throttled") throw new AppPasswordThrottledError("mock 429", 900, "throttled");
    if (password !== MOCK_ACCOUNT_PASSWORD) {
      throw new WgwRequestError("mock 403", 403, "current_password_invalid");
    }
  };
  const checkCode = (code: string) => {
    const digits = normalizeTotpCode(code);
    if (digits === MOCK_SIGN_IN.throttledCode) {
      throw new AppPasswordThrottledError("mock 429", 3600, "throttled");
    }
    if (digits !== MOCK_SIGN_IN.code)
      throw new WgwRequestError("mock 403", 403, "mfa_code_invalid");
  };
  const newCodes = () => {
    state = { enabled: true, recoveryCodesRemaining: MOCK_SIGN_IN.recoveryCodes.length };
    return [...MOCK_SIGN_IN.recoveryCodes];
  };
  return {
    state: async () => {
      await wait();
      if (options.failState) throw new WgwRequestError("GET /me failed (500)", 500);
      return { ...state };
    },
    start: async (currentPassword) => {
      await wait();
      checkPassword(currentPassword);
      started = true;
      return {
        secret: MOCK_SIGN_IN.secret,
        otpauthUri: `otpauth://totp/WeGotWorkspace:alice?secret=${MOCK_SIGN_IN.secret}&issuer=WeGotWorkspace`,
        davPasswordUsedAt: options.davPasswordUsedAt ?? null,
      };
    },
    confirm: async (currentPassword, code) => {
      await wait();
      checkPassword(currentPassword);
      if (state.enabled) throw new WgwRequestError("mock 409", 409, "mfa_already_enabled");
      if (!started) throw new WgwRequestError("mock 400", 400, "mfa_setup_missing");
      checkCode(code);
      return newCodes();
    },
    disable: async (code) => {
      await wait();
      if (!state.enabled) throw new WgwRequestError("mock 409", 409, "mfa_not_enabled");
      checkCode(code);
      state = { enabled: false, recoveryCodesRemaining: null };
    },
    replaceRecoveryCodes: async (code) => {
      await wait();
      if (!state.enabled) throw new WgwRequestError("mock 409", 409, "mfa_not_enabled");
      checkCode(code);
      return newCodes();
    },
  };
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWgwAssistantSignInOperations,
  createWgwSignInOperations,
  isCompleteTotpCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  SignInError,
  signInFailureReason,
  signInStepFromBody,
} from "@/lib/api/wgw/auth-sign-in";
import { resetWgwSessionStateForTests, wgwCurrentAccessToken } from "@/lib/api/wgw/http";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const tokenBody = { status: "ok", access_token: "header.e30.sig", expires_in: 900 };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_WGW_API_BASE_URL", "/api/v1");
  window.localStorage.clear();
  resetWgwSessionStateForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sentBody(call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("code formatting", () => {
  it("strips spaces and dashes from a pasted code", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode(" 123-456 ")).toBe("123456");
    expect(isCompleteTotpCode("123 456")).toBe(true);
    expect(isCompleteTotpCode("12345")).toBe(false);
    expect(isCompleteTotpCode("12345a")).toBe(false);
  });

  it("compares recovery codes without separators and case", () => {
    expect(normalizeRecoveryCode(" ABCDE-fghij ")).toBe("abcdefghij");
    expect(normalizeRecoveryCode("abcde fghij")).toBe("abcdefghij");
  });
});

describe("signInFailureReason", () => {
  it("reads the password step", () => {
    expect(signInFailureReason(401, "unauthorized", "password")).toBe("credentials");
    expect(signInFailureReason(429, "throttled", "password")).toBe("throttled");
    expect(signInFailureReason(500, undefined, "password")).toBe("failed");
  });

  it("reads the code step", () => {
    expect(signInFailureReason(401, "mfa_code_invalid", "code")).toBe("invalid_code");
    expect(signInFailureReason(422, undefined, "code")).toBe("invalid_code");
    expect(signInFailureReason(401, "unauthorized", "code")).toBe("credentials");
    expect(signInFailureReason(404, "not_found", "code")).toBe("expired");
    expect(signInFailureReason(410, undefined, "code")).toBe("expired");
    expect(signInFailureReason(429, "mfa_locked", "code")).toBe("throttled");
  });
});

describe("signInStepFromBody", () => {
  it("returns a challenge without touching the session", () => {
    expect(
      signInStepFromBody({ status: "mfa_required", challenge: "c1", client: "spa" }, "spa"),
    ).toEqual({ status: "mfa_required", challenge: "c1" });
    expect(wgwCurrentAccessToken()).toBeNull();
  });

  it("signs the web app in from an ok body", () => {
    expect(signInStepFromBody(tokenBody, "spa")).toEqual({ status: "ok", redirect: null });
    expect(wgwCurrentAccessToken()).toBe("header.e30.sig");
  });

  it("keeps only a same-origin path as the assistant redirect", () => {
    expect(signInStepFromBody({ status: "ok", redirect: "/oauth/authorize?x=1" }, "oauth")).toEqual(
      { status: "ok", redirect: "/oauth/authorize?x=1" },
    );
    expect(signInStepFromBody({ status: "ok", redirect: "//evil.example/x" }, "oauth")).toEqual({
      status: "ok",
      redirect: null,
    });
  });
});

describe("web app sign-in", () => {
  it("answers a challenge for a user with two-factor on", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ status: "mfa_required", challenge: "c1", client: "spa" }),
    );
    const step = await createWgwSignInOperations().signIn("alice", "pw");
    expect(step).toEqual({ status: "mfa_required", challenge: "c1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/token");
  });

  it("posts the code without its space and signs in", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody));
    const step = await createWgwSignInOperations().verify("c 1", { code: "123 456" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/mfa-challenges/c%201/verification");
    expect(sentBody()).toEqual({ code: "123456" });
    expect(step.status).toBe("ok");
    expect(wgwCurrentAccessToken()).toBe("header.e30.sig");
  });

  it("posts a recovery code and returns the replacement step", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "mfa_replace_required", challenge: "c2" }));
    const step = await createWgwSignInOperations().verify("c1", { recoveryCode: "ABCDE-FGHIJ" });
    expect(sentBody()).toEqual({ recovery_code: "abcdefghij" });
    expect(step).toEqual({ status: "mfa_replace_required", challenge: "c2" });
  });

  it("reads the new authenticator and the recovery codes of a replacement", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ secret: "ABC", otpauth_uri: "otpauth://totp/x?secret=ABC" }))
      .mockResolvedValueOnce(json({ ...tokenBody, recovery_codes: ["a", "b"] }));
    const operations = createWgwSignInOperations();
    expect(await operations.startReplacement("c2")).toEqual({
      secret: "ABC",
      otpauthUri: "otpauth://totp/x?secret=ABC",
    });
    const confirmed = await operations.confirmReplacement("c2", "123456");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/mfa-challenges/c2/confirmation");
    expect(confirmed.recoveryCodes).toEqual(["a", "b"]);
  });

  it("throws a typed error with Retry-After on a 429", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "Too many", code: "throttled" }, 429, { "Retry-After": "120" }),
    );
    const failure = await createWgwSignInOperations()
      .verify("c1", { code: "123456" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SignInError);
    expect(failure).toMatchObject({ reason: "throttled", retryAfterSeconds: 120, status: 429 });
  });
});

describe("assistant connect", () => {
  it("posts credentials and the intent, then also signs the web app in", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, redirect: "/oauth/authorize?client_id=a" }))
      .mockResolvedValueOnce(json(tokenBody));
    const step = await createWgwAssistantSignInOperations("intent-token").signIn("bob", "pw");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/oauth/session");
    expect(sentBody()).toEqual({ username: "bob", password: "pw", intent: "intent-token" });
    expect(step).toEqual({ status: "ok", redirect: "/oauth/authorize?client_id=a" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/token");
  });

  it("stops at the challenge and redeems it on oauth/session, not on the API", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: "mfa_required", challenge: "o1", client: "oauth" }))
      .mockResolvedValueOnce(json({ status: "ok", redirect: "/oauth/authorize?s=1" }));
    const operations = createWgwAssistantSignInOperations("i");
    expect(await operations.signIn("bob", "pw")).toEqual({
      status: "mfa_required",
      challenge: "o1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const step = await operations.verify("o1", { code: "123456" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/oauth/session");
    expect(sentBody(1)).toEqual({ challenge: "o1", code: "123456", intent: "i" });
    expect(step).toEqual({ status: "ok", redirect: "/oauth/authorize?s=1" });
    expect(wgwCurrentAccessToken()).toBeNull();
  });

  it("maps refused credentials", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope", code: "invalid" }, 401));
    await expect(createWgwAssistantSignInOperations().signIn("bob", "x")).rejects.toMatchObject({
      reason: "credentials",
    });
  });
});

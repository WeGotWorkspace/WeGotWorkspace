import { describe, expect, it } from "vitest";
import { parseAuthLoginBody, shouldLeaveForLoginAfterStorage } from "@/lib/api/wgw/auth-login";

describe("parseAuthLoginBody", () => {
  it("accepts a token pair with or without status ok", () => {
    expect(
      parseAuthLoginBody({
        access_token: "a",
        refresh_token: "r",
        expires_in: 60,
      }).status,
    ).toBe("ok");
    expect(parseAuthLoginBody({ status: "ok", access_token: "a", refresh_token: "r" }).status).toBe(
      "ok",
    );
  });

  it("accepts the three challenge statuses", () => {
    expect(
      parseAuthLoginBody({
        status: "mfa_required",
        challenge: "abc",
        methods: ["totp", "recovery"],
      }),
    ).toEqual({
      status: "mfa_required",
      challenge: "abc",
      methods: ["totp", "recovery"],
    });
    expect(parseAuthLoginBody({ status: "mfa_setup_required", challenge: "abc" }).status).toBe(
      "mfa_setup_required",
    );
    expect(parseAuthLoginBody({ status: "mfa_replace_required", challenge: "abc" }).status).toBe(
      "mfa_replace_required",
    );
  });
});

describe("shouldLeaveForLoginAfterStorage", () => {
  it("sends another tab to login when the token keys are gone", () => {
    expect(
      shouldLeaveForLoginAfterStorage({
        key: "wgw.api.access_token",
        hadSession: true,
        accessToken: null,
        refreshToken: null,
        pathname: "/notes",
      }),
    ).toBe(true);
  });

  it("stays put when tokens were replaced or this tab is already on login", () => {
    expect(
      shouldLeaveForLoginAfterStorage({
        key: "wgw.api.access_token",
        hadSession: true,
        accessToken: "next",
        refreshToken: "next",
        pathname: "/notes",
      }),
    ).toBe(false);
    expect(
      shouldLeaveForLoginAfterStorage({
        key: "wgw.api.refresh_token",
        hadSession: true,
        accessToken: null,
        refreshToken: null,
        pathname: "/login",
      }),
    ).toBe(false);
  });
});

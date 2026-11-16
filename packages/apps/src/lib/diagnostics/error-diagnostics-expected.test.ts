import { describe, expect, it } from "vitest";
import { ApiError, UnexpectedApiResponseError } from "@/lib/api/api-error";
import { WgwGuestSessionMissingError } from "@/lib/api/wgw/guest-session-missing-error";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";
import { WgwSignInRequiredError } from "@/lib/api/wgw/sign-in-required-error";
import { JmapRequestError } from "@/lib/jmap-client/core/errors";
import { OfflineNotCachedError } from "@/lib/offline/core/offline-not-cached-error";
import { isExpectedFailure } from "@/lib/diagnostics/error-diagnostics-expected";

describe("isExpectedFailure", () => {
  it.each([
    ["a typed API error the UI shows", new WgwRequestError("Not found", 404)],
    ["an auth failure (401)", new ApiError("Unauthorized", 401)],
    ["a forbidden answer (403)", new ApiError("Forbidden", 403)],
    ["a server error with a status", new ApiError("Bad gateway", 502)],
    ["a session that has to be renewed", new WgwSessionRenewalError()],
    ["a sign-in that is required", new WgwSignInRequiredError()],
    ["a guest link without a session", new WgwGuestSessionMissingError("Open the link again.")],
    ["a JMAP transport failure", new JmapRequestError("HTTP 503", { status: 503 })],
    ["a fetch that never reached the server", new TypeError("Failed to fetch")],
    ["an app opened offline before its first visit", new OfflineNotCachedError("files")],
    ["a request the code cancelled", new DOMException("The user aborted a request.", "AbortError")],
  ])("skips %s", (_label, error) => {
    expect(isExpectedFailure(error)).toBe(true);
  });

  it.each([
    ["a programming error", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["a plain Error", new Error("Something broke")],
    ["an answer the client cannot use", new UnexpectedApiResponseError("Response was not JSON")],
    ["a rejected string", "boom"],
    ["a rejected object", { status: 500 }],
  ])("records %s", (_label, error) => {
    expect(isExpectedFailure(error)).toBe(false);
  });
});

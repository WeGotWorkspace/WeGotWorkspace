import { describe, expect, it } from "vitest";
import {
  isDisplayCaptureSupported,
  isDisplayCaptureUnsupportedError,
  isDisplayCaptureUserCancel,
  isIosWebKitClient,
} from "@/meet-core/src/meet-display-capture";

const getDisplayMedia = (): never => {
  throw new Error("getDisplayMedia stub");
};

describe("isIosWebKitClient", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(
      isIosWebKitClient({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosWebKitClient({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        platform: "iPad",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("detects iPadOS desktop-mode spoofing as Macintosh with touch", () => {
    expect(
      isIosWebKitClient({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("does not treat a desktop Mac as iOS", () => {
    expect(
      isIosWebKitClient({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});

describe("isDisplayCaptureSupported", () => {
  it("is true when getDisplayMedia exists on a non-iOS client", () => {
    expect(
      isDisplayCaptureSupported({
        mediaDevices: { getDisplayMedia },
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
        platform: "Linux x86_64",
        maxTouchPoints: 0,
      }),
    ).toBe(true);
  });

  it("is false when getDisplayMedia is missing", () => {
    expect(
      isDisplayCaptureSupported({
        mediaDevices: {},
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
        platform: "Linux x86_64",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(
      isDisplayCaptureSupported({
        mediaDevices: null,
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
        platform: "Linux x86_64",
      }),
    ).toBe(false);
  });

  it("is false on iOS even if getDisplayMedia is present as a stub", () => {
    expect(
      isDisplayCaptureSupported({
        mediaDevices: { getDisplayMedia },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });
});

describe("display capture error classification", () => {
  it("treats picker dismissals as user cancel", () => {
    expect(
      isDisplayCaptureUserCancel(new DOMException("Permission denied", "NotAllowedError")),
    ).toBe(true);
    expect(isDisplayCaptureUserCancel(new DOMException("The user aborted", "AbortError"))).toBe(
      true,
    );
    expect(isDisplayCaptureUserCancel(new Error("boom"))).toBe(false);
  });

  it("treats missing or unimplemented capture as unsupported", () => {
    expect(
      isDisplayCaptureUnsupportedError(new TypeError("getDisplayMedia is not a function")),
    ).toBe(true);
    expect(
      isDisplayCaptureUnsupportedError(new DOMException("Not supported", "NotSupportedError")),
    ).toBe(true);
    expect(isDisplayCaptureUnsupportedError(new DOMException("No surface", "NotFoundError"))).toBe(
      true,
    );
    expect(isDisplayCaptureUnsupportedError(new Error("boom"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isDisplayCaptureSupported,
  isDisplayCaptureUnsupportedError,
  isDisplayCaptureUserCancel,
} from "@/meet-core/src/meet-display-capture";

const getDisplayMedia = (): never => {
  throw new Error("getDisplayMedia stub");
};

describe("isDisplayCaptureSupported", () => {
  it("is true when getDisplayMedia is a function", () => {
    expect(isDisplayCaptureSupported({ getDisplayMedia })).toBe(true);
  });

  it("is false when getDisplayMedia is missing", () => {
    expect(isDisplayCaptureSupported({})).toBe(false);
    expect(isDisplayCaptureSupported(null)).toBe(false);
    expect(isDisplayCaptureSupported(undefined)).toBe(false);
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

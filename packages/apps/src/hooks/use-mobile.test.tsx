import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MOBILE_BREAKPOINT_PX, MOBILE_MEDIA_QUERY, useIsMobile } from "./use-mobile";

describe("mobile breakpoint constants", () => {
  it("MOBILE_BREAKPOINT_PX is exactly 768px", () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
  });

  it("MOBILE_MEDIA_QUERY matches expected format", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 767px)");
  });
});

describe("useIsMobile hook", () => {
  it("returns true when matchMedia indicates mobile viewport", () => {
    const mockMatchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: mockMatchMedia,
    });

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when matchMedia indicates desktop viewport", () => {
    const mockMatchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: mockMatchMedia,
    });

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});

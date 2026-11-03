// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readThemePreference,
  resolveTheme,
  syncDocumentTheme,
  writeThemePreference,
} from "@/lib/theme-preference";

function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});

describe("theme preference", () => {
  it("defaults to system and ignores unknown stored values", () => {
    expect(readThemePreference()).toBe("system");
    localStorage.setItem("wgw.theme", "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("stores light / dark and clears the key for system", () => {
    writeThemePreference("dark");
    expect(localStorage.getItem("wgw.theme")).toBe("dark");
    writeThemePreference("system");
    expect(localStorage.getItem("wgw.theme")).toBeNull();
  });

  it("resolves system from prefers-color-scheme", () => {
    stubSystemDark(true);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    stubSystemDark(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("keeps data-theme on <html> in step with writes", () => {
    stubSystemDark(false);
    const dispose = syncDocumentTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    writeThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    dispose();
    writeThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("paints the theme-color meta with the resolved scheme surface", () => {
    stubSystemDark(false);
    const dispose = syncDocumentTheme();
    const meta = () => document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta()?.content).toBe("#fff5e9");
    writeThemePreference("dark");
    expect(meta()?.content).toBe("#1c1c1c");
    dispose();
  });
});

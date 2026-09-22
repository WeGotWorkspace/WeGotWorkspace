import { describe, expect, it } from "vitest";
import {
  buildBrandingWorkspaceOverrideCss,
  resolveBrandingCsspropValues,
  resolveBrandingIconMarkup,
  syncBrandingCsspropsToRoot,
} from "@/branding-playground/branding-workspace-decorator";
import { WORKSPACE_APP_ICON_INLINE } from "@/lib/workspace-app-icon-svgs";
import { waiBrandingCssprops } from "@/branding-playground/branding-cssprops";

describe("resolveBrandingIconMarkup", () => {
  it("returns undefined for current (no override)", () => {
    expect(resolveBrandingIconMarkup({ iconPreset: "current" }, "mail")).toBeUndefined();
  });

  it("returns another app’s inline SVG for a preset id", () => {
    expect(resolveBrandingIconMarkup({ iconPreset: "notes" }, "mail")).toBe(
      WORKSPACE_APP_ICON_INLINE.notes,
    );
  });

  it("returns trimmed custom markup when preset is custom", () => {
    expect(
      resolveBrandingIconMarkup({ iconPreset: "custom", svgMarkup: "  <svg />  " }, "mail"),
    ).toBe("<svg />");
  });

  it("ignores empty custom markup", () => {
    expect(
      resolveBrandingIconMarkup({ iconPreset: "custom", svgMarkup: "   " }, "mail"),
    ).toBeUndefined();
  });
});

describe("wai cssprop shapes match production switch-trigger", () => {
  it("calendar: bg + fg only (no invented cutout←bg)", () => {
    const map = waiBrandingCssprops({ bg: "#ffbdc2", fg: "#962fa8" });
    expect(map).not.toHaveProperty("wai-cutout");
    expect(map).not.toHaveProperty("wai-detail");
  });

  it("mail/contacts/settings: bg + fg only", () => {
    expect(Object.keys(waiBrandingCssprops({ bg: "#de4b0e", fg: "#ffbdc2" })).sort()).toEqual([
      "wai-bg",
      "wai-fg",
    ]);
  });

  it("meet: bg + fg only", () => {
    const map = waiBrandingCssprops({ bg: "#ffc800", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual(["wai-bg", "wai-fg"]);
    expect(map["wai-fg"]?.value).toBe("#962fa8");
  });
});

function styleBag(): { el: { style: CSSStyleDeclaration }; style: CSSStyleDeclaration } {
  const map = new Map<string, string>();
  const style = {
    getPropertyValue: (prop: string) => map.get(prop) ?? "",
    setProperty: (prop: string, value: string) => {
      map.set(prop, value);
    },
    removeProperty: (prop: string) => {
      map.delete(prop);
    },
  } as unknown as CSSStyleDeclaration;
  return { el: { style }, style };
}

describe("resolveBrandingCsspropValues", () => {
  const entries = [
    { key: "workspace-accent", value: "#962fa8" },
    { key: "wai-bg", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no style (Docs / Canvas wipe)", () => {
    const body = styleBag();
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#962fa8",
      "--wai-bg": "#ffbdc2",
    });
  });

  it("prefers live body values from the cssprops addon", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#ff0000",
      "--wai-bg": "#ffbdc2",
    });
  });
});

describe("buildBrandingWorkspaceOverrideCss", () => {
  it("emits concrete token values, never inherit", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--wai-bg": "#ffbdc2",
      "--wai-fg": "#962fa8",
    });
    expect(css).toContain("--workspace-accent: #962fa8;");
    expect(css).toContain("--wai-bg: #ffbdc2;");
    expect(css).not.toMatch(/:\s*inherit\s*;/);
  });

  it("retargets wai layers onto the switch-trigger SVG", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--wai-bg": "#ffbdc2",
    });
    expect(css).toMatch(/\.workspace-app-icon--switch-trigger svg \{\s*--wai-bg: #ffbdc2;/);
  });
});

describe("syncBrandingCsspropsToRoot", () => {
  const entries = [
    { key: "workspace-accent", value: "#962fa8" },
    { key: "wai-bg", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no values", () => {
    const root = styleBag();
    const body = styleBag();
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("#962fa8");
    expect(root.style.getPropertyValue("--wai-bg")).toBe("#ffbdc2");
  });

  it("prefers body values when the cssprops addon has injected them", () => {
    const root = styleBag();
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("#ff0000");
    expect(root.style.getPropertyValue("--wai-bg")).toBe("#ffbdc2");
  });

  it("restores defaults after body style is cleared (Canvas panel cleanup)", () => {
    const root = styleBag();
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    body.style.removeProperty("--workspace-accent");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("#962fa8");
  });
});

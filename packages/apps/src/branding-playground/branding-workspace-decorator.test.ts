import { describe, expect, it } from "vitest";
import {
  brandingCsspropEquals,
  buildBrandingWorkspaceOverrideCss,
  csspropValuesForPaint,
  reconcileUntouchedCsspropDefaults,
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
      "workspace-brand",
      "workspace-brand-foreground",
    ]);
  });

  it("meet: bg + fg only", () => {
    const map = waiBrandingCssprops({ bg: "#ffc800", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual(["workspace-brand", "workspace-brand-foreground"]);
    expect(map["workspace-brand-foreground"]?.value).toBe("#962fa8");
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
    { key: "workspace-brand", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no style (Docs / Canvas wipe)", () => {
    const body = styleBag();
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#962fa8",
      "--workspace-brand": "#ffbdc2",
    });
  });

  it("prefers live body values from the cssprops addon", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#ff0000",
      "--workspace-brand": "#ffbdc2",
    });
  });
});

describe("buildBrandingWorkspaceOverrideCss", () => {
  it("emits concrete token values, never inherit", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--workspace-brand": "#ffbdc2",
      "--workspace-brand-foreground": "#962fa8",
    });
    expect(css).toContain("--workspace-accent: oklch(from #962fa8 l c h);");
    expect(css).toContain("--workspace-brand: oklch(from #ffbdc2 l c h);");
    expect(css).not.toMatch(/:\s*inherit\s*;/);
  });

  it("retargets wai layers onto the switch-trigger SVG", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--workspace-brand": "#ffbdc2",
    });
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger svg \{\s*--workspace-brand: oklch\(from #ffbdc2 l c h\);/,
    );
  });

  it("keeps the Docs sidebar icon a blue tile with white marks", () => {
    const css = buildBrandingWorkspaceOverrideCss("docs-workspace", {
      "--workspace-accent": "#ba9689",
      "--workspace-brand": "#0045ff",
      "--workspace-brand-foreground": "#ffffff",
    });
    expect(css).toMatch(
      /\.branding-playground-root \.docs-workspace \{\s*--workspace-accent: oklch\(from #ba9689 l c h\);\s*--workspace-brand: oklch\(from #0045ff l c h\);\s*--workspace-brand-foreground: oklch\(from #ffffff l c h\);/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger svg \{\s*--workspace-brand: oklch\(from #0045ff l c h\);\s*--workspace-brand-foreground: oklch\(from #ffffff l c h\);/,
    );
  });

  it("emits no workspace rule when nothing was edited", () => {
    expect(buildBrandingWorkspaceOverrideCss("tasks-workspace", {})).toBe("");
  });
});

describe("csspropValuesForPaint", () => {
  const entries = [{ key: "button-primary-bg", value: "var(--workspace-accent)" }];

  it("omits parameter defaults so workspace CSS stays the source of truth", () => {
    const body = styleBag();
    expect(csspropValuesForPaint(entries, body.style, null, null)).toEqual({});
  });

  it("omits a body value that matches the parameter default", () => {
    const body = styleBag();
    body.style.setProperty("--button-primary-bg", "var(--workspace-accent)");
    expect(csspropValuesForPaint(entries, body.style, null, "themes-tasks--default")).toEqual({});
  });

  it("keeps a real panel edit", () => {
    const body = styleBag();
    body.style.setProperty("--button-primary-bg", "#ff0000");
    expect(csspropValuesForPaint(entries, body.style, null, "themes-tasks--default")).toEqual({
      "--button-primary-bg": "#ff0000",
    });
  });

  it("ignores an untouched stored default that no longer matches the parameter", () => {
    const body = styleBag();
    body.style.setProperty("--button-primary-bg", "var(--workspace-brand)");
    const store = {
      customProperties: {
        "themes-tasks--default": { "button-primary-bg": "var(--workspace-brand)" },
      },
      initialCustomProperties: {
        "themes-tasks--default": { "button-primary-bg": "var(--workspace-brand)" },
      },
    };
    expect(csspropValuesForPaint(entries, body.style, store, "themes-tasks--default")).toEqual({});
  });
});

describe("reconcileUntouchedCsspropDefaults", () => {
  const entries = [{ key: "button-primary-bg", value: "var(--workspace-accent)" }];

  it("moves an untouched stored default onto the current parameter", () => {
    const store = {
      customProperties: {
        "themes-tasks--default": { "button-primary-bg": "var(--workspace-brand)" },
      },
      initialCustomProperties: {
        "themes-tasks--default": { "button-primary-bg": "var(--workspace-brand)" },
      },
    };
    const next = reconcileUntouchedCsspropDefaults(store, "themes-tasks--default", entries);
    expect(next.changed).toBe(true);
    expect(next.store.customProperties?.["themes-tasks--default"]?.["button-primary-bg"]).toBe(
      "var(--workspace-accent)",
    );
    expect(
      next.store.initialCustomProperties?.["themes-tasks--default"]?.["button-primary-bg"],
    ).toBe("var(--workspace-accent)");
  });

  it("leaves a row the user changed", () => {
    const store = {
      customProperties: { "themes-tasks--default": { "button-primary-bg": "#ff0000" } },
      initialCustomProperties: {
        "themes-tasks--default": { "button-primary-bg": "var(--workspace-accent)" },
      },
    };
    const next = reconcileUntouchedCsspropDefaults(store, "themes-tasks--default", entries);
    expect(next.changed).toBe(false);
    expect(next.store).toBe(store);
  });

  it("treats oklch(from) as the same value as the hex seed", () => {
    expect(brandingCsspropEquals("#ffffff", "oklch(from #ffffff l c h)")).toBe(true);
  });
});

describe("syncBrandingCsspropsToRoot", () => {
  const entries = [
    { key: "workspace-accent", value: "#962fa8" },
    { key: "workspace-brand", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no values", () => {
    const root = styleBag();
    const body = styleBag();
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("oklch(from #962fa8 l c h)");
    expect(root.style.getPropertyValue("--workspace-brand")).toBe("oklch(from #ffbdc2 l c h)");
  });

  it("prefers body values when the cssprops addon has injected them", () => {
    const root = styleBag();
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("oklch(from #ff0000 l c h)");
    expect(root.style.getPropertyValue("--workspace-brand")).toBe("oklch(from #ffbdc2 l c h)");
  });

  it("restores defaults after body style is cleared (Canvas panel cleanup)", () => {
    const root = styleBag();
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    body.style.removeProperty("--workspace-accent");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("oklch(from #962fa8 l c h)");
  });
});

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
import { iconBrandingCssprops } from "@/branding-playground/branding-cssprops";

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

describe("icon cssprop shapes match production switch-trigger", () => {
  it("calendar: bg + fg only (no invented cutout←bg)", () => {
    const map = iconBrandingCssprops({ bg: "#ffbdc2", fg: "#962fa8" });
    expect(map).not.toHaveProperty("wai-cutout");
    expect(map).not.toHaveProperty("wai-detail");
  });

  it("mail/contacts/settings: bg + fg only", () => {
    expect(Object.keys(iconBrandingCssprops({ bg: "#de4b0e", fg: "#ffbdc2" })).sort()).toEqual([
      "workspace-icon-foreground",
      "workspace-icon-surface",
    ]);
  });

  it("meet: bg + fg only", () => {
    const map = iconBrandingCssprops({ bg: "#ffc800", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual([
      "workspace-icon-foreground",
      "workspace-icon-surface",
    ]);
    expect(map["workspace-icon-foreground"]?.value).toBe("#962fa8");
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
    { key: "workspace-icon-surface", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no style (Docs / Canvas wipe)", () => {
    const body = styleBag();
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#962fa8",
      "--workspace-icon-surface": "#ffbdc2",
    });
  });

  it("prefers live body values from the cssprops addon", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    expect(resolveBrandingCsspropValues(entries, body.style)).toEqual({
      "--workspace-accent": "#ff0000",
      "--workspace-icon-surface": "#ffbdc2",
    });
  });
});

describe("buildBrandingWorkspaceOverrideCss", () => {
  it("emits concrete token values, never inherit", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--workspace-icon-surface": "#ffbdc2",
      "--workspace-icon-foreground": "#962fa8",
    });
    expect(css).toContain("--workspace-accent: oklch(from #962fa8 l c h);");
    expect(css).toContain("--workspace-icon-surface: oklch(from #ffbdc2 l c h);");
    expect(css).not.toMatch(/:\s*inherit\s*;/);
  });

  it("retargets icon layers onto the switch-trigger SVG", () => {
    const css = buildBrandingWorkspaceOverrideCss("calendar-workspace", {
      "--workspace-accent": "#962fa8",
      "--workspace-icon-surface": "#ffbdc2",
    });
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger svg \{\s*--workspace-icon-surface: oklch\(from #ffbdc2 l c h\);/,
    );
  });

  it("keeps the Docs sidebar icon a blue tile with white marks", () => {
    const css = buildBrandingWorkspaceOverrideCss("docs-workspace", {
      "--workspace-accent": "#ba9689",
      "--workspace-icon-surface": "#0045ff",
      "--workspace-icon-foreground": "#ffffff",
    });
    expect(css).toMatch(
      /\.branding-playground-root \.docs-workspace \{\s*--workspace-accent: oklch\(from #ba9689 l c h\);\s*--workspace-icon-surface: oklch\(from #0045ff l c h\);\s*--workspace-icon-foreground: oklch\(from #ffffff l c h\);/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger svg \{\s*--workspace-icon-surface: oklch\(from #0045ff l c h\);\s*--workspace-icon-foreground: oklch\(from #ffffff l c h\);/,
    );
  });

  it("emits no workspace rule when nothing was edited", () => {
    expect(buildBrandingWorkspaceOverrideCss("tasks-workspace", {})).toBe("");
  });
});

describe("csspropValuesForPaint", () => {
  const entries = [{ key: "workspace-accent", value: "var(--color-we-got-dark)" }];

  it("omits parameter defaults so workspace CSS stays the source of truth", () => {
    const body = styleBag();
    expect(csspropValuesForPaint(entries, body.style, null, null)).toEqual({});
  });

  it("omits a body value that matches the parameter default", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "var(--color-we-got-dark)");
    expect(csspropValuesForPaint(entries, body.style, null, "themes-tasks--default")).toEqual({});
  });

  it("keeps a real panel edit", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    expect(csspropValuesForPaint(entries, body.style, null, "themes-tasks--default")).toEqual({
      "--workspace-accent": "#ff0000",
    });
  });

  it("ignores an untouched stored default that no longer matches the parameter", () => {
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "var(--workspace-icon-surface)");
    const store = {
      customProperties: {
        "themes-tasks--default": { "workspace-accent": "var(--workspace-icon-surface)" },
      },
      initialCustomProperties: {
        "themes-tasks--default": { "workspace-accent": "var(--workspace-icon-surface)" },
      },
    };
    expect(csspropValuesForPaint(entries, body.style, store, "themes-tasks--default")).toEqual({});
  });
});

describe("reconcileUntouchedCsspropDefaults", () => {
  const entries = [{ key: "workspace-accent", value: "var(--color-we-got-dark)" }];

  it("moves an untouched stored default onto the current parameter", () => {
    const store = {
      customProperties: {
        "themes-tasks--default": { "workspace-accent": "var(--workspace-icon-surface)" },
      },
      initialCustomProperties: {
        "themes-tasks--default": { "workspace-accent": "var(--workspace-icon-surface)" },
      },
    };
    const next = reconcileUntouchedCsspropDefaults(store, "themes-tasks--default", entries);
    expect(next.changed).toBe(true);
    expect(next.store.customProperties?.["themes-tasks--default"]?.["workspace-accent"]).toBe(
      "var(--color-we-got-dark)",
    );
    expect(
      next.store.initialCustomProperties?.["themes-tasks--default"]?.["workspace-accent"],
    ).toBe("var(--color-we-got-dark)");
  });

  it("leaves a row the user changed", () => {
    const store = {
      customProperties: { "themes-tasks--default": { "workspace-accent": "#ff0000" } },
      initialCustomProperties: {
        "themes-tasks--default": { "workspace-accent": "var(--color-we-got-dark)" },
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
    { key: "workspace-icon-surface", value: "#ffbdc2" },
  ];

  it("applies parameter defaults when body has no values", () => {
    const root = styleBag();
    const body = styleBag();
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("oklch(from #962fa8 l c h)");
    expect(root.style.getPropertyValue("--workspace-icon-surface")).toBe(
      "oklch(from #ffbdc2 l c h)",
    );
  });

  it("prefers body values when the cssprops addon has injected them", () => {
    const root = styleBag();
    const body = styleBag();
    body.style.setProperty("--workspace-accent", "#ff0000");
    syncBrandingCsspropsToRoot(root.el as HTMLElement, entries, body.style);
    expect(root.style.getPropertyValue("--workspace-accent")).toBe("oklch(from #ff0000 l c h)");
    expect(root.style.getPropertyValue("--workspace-icon-surface")).toBe(
      "oklch(from #ffbdc2 l c h)",
    );
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

import { describe, expect, it } from "vitest";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";
import {
  BRANDING_APP_ACCENT_DEFAULTS,
  BRANDING_APP_SIDEBAR_DEFAULTS,
  BRANDING_APP_WAI_DEFAULTS,
  brandingAppButtonPrimary,
  brandingAppSidebarBg,
  brandingAppSidebarColorDefault,
  createAppBrandingCssprops,
  defaultAppBrandingCssprops,
  defaultAuthBrandingCssprops,
  defaultHomeBrandingCssprops,
  waiBrandingCssprops,
} from "@/branding-playground/branding-cssprops";
import {
  brandingIconArgs,
  brandingDocsSidebarArgs,
} from "@/branding-playground/branding-arg-types";
import {
  brandingRouterPath,
  createBrandingStoryMeta,
} from "@/branding-playground/create-branding-story-meta";

describe("BRANDING_APP_ACCENT_DEFAULTS", () => {
  it("uses Dark for every app accent", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(BRANDING_APP_ACCENT_DEFAULTS[appId]).toBe("var(--color-we-got-dark)");
    }
  });
});

describe("waiBrandingCssprops", () => {
  it("emits only bg/fg when optional layers are omitted (calendar production shape)", () => {
    const map = waiBrandingCssprops({ bg: "#ffbdc2", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual(["workspace-brand", "workspace-brand-foreground"]);
    expect(map["workspace-brand"]?.value).toBe("#ffbdc2");
    expect(map["workspace-brand-foreground"]?.value).toBe("#962fa8");
  });

  it("emits only bg and fg", () => {
    const map = waiBrandingCssprops({ bg: "#ffbdc2", fg: "#de4b0e" });
    expect(Object.keys(map).sort()).toEqual(["workspace-brand", "workspace-brand-foreground"]);
  });
});

describe("createAppBrandingCssprops", () => {
  it("omits sidebar and app-sidebar-color unless callers opt in", () => {
    const map = createAppBrandingCssprops("mail", { wai: BRANDING_APP_WAI_DEFAULTS.mail });
    expect(map["app-sidebar-bg"]).toBeUndefined();
    expect(map["app-sidebar-color"]).toBeUndefined();
  });

  it("emits chrome overrides when provided", () => {
    const map = createAppBrandingCssprops("mail", {
      sidebarValue: BRANDING_APP_SIDEBAR_DEFAULTS.mail,
      appSidebarColor: brandingAppSidebarColorDefault("mail"),
    });
    expect(map["app-sidebar-bg"]?.value).toBe(BRANDING_APP_SIDEBAR_DEFAULTS.mail);
    expect(map["app-sidebar-color"]?.value).toBe("#003311");
  });
});

describe("brandingAppButtonPrimary", () => {
  it("darkens mail primary so white labels clear AA", () => {
    expect(brandingAppButtonPrimary("mail")).toEqual({
      bg: "color-mix(in oklch, var(--workspace-brand) 45%, var(--color-we-got-dark))",
      fg: "var(--workspace-brand-foreground)",
    });
  });
});

describe("defaultAppBrandingCssprops", () => {
  it.each(WORKSPACE_APP_IDS)(
    "documents cream, ink, accent, and production wai only for %s (no sidebar chrome)",
    (appId) => {
      const map = defaultAppBrandingCssprops(appId);
      const wai = BRANDING_APP_WAI_DEFAULTS[appId];
      expect(map["color-we-got-soft"]?.value).toBe("#fff5e9");
      expect(map["color-we-got-dark"]?.value).toBe("#003311");
      expect(map["workspace-accent"]?.value).toBe(BRANDING_APP_ACCENT_DEFAULTS[appId]);
      expect(map["workspace-surface"]?.value).toBe("var(--workspace-surface)");
      expect(map["workspace-surface-foreground"]?.value).toBe("var(--color-we-got-dark)");
      expect(map["button-primary-bg"]?.value).toBe(brandingAppButtonPrimary(appId).bg);
      expect(map["button-primary-fg"]?.value).toBe(brandingAppButtonPrimary(appId).fg);
      expect(map["workspace-sidebar-surface"]?.value).toBe(brandingAppSidebarBg(appId));
      expect(map["workspace-sidebar-surface-foreground"]?.value).toBe("var(--color-we-got-dark)");
      expect(map["app-sidebar-bg"]).toBeUndefined();
      expect(map["app-sidebar-color"]).toBeUndefined();
      expect(map["workspace-brand"]?.value).toBe(wai.bg);
      expect(map["workspace-brand-foreground"]?.value).toBe(wai.fg);
      expect(map["wai-detail"]).toBeUndefined();
      expect(map["wai-detail-muted"]).toBeUndefined();
      expect(map["wai-cutout"]).toBeUndefined();
    },
  );

  it("documents one production sidebar formula for every app", () => {
    expect(brandingAppSidebarColorDefault("docs")).toBe("#003311");
    expect(brandingAppSidebarColorDefault("mail")).toBe("#003311");
    const values = new Set(Object.values(BRANDING_APP_SIDEBAR_DEFAULTS));
    expect(values.size).toBe(1);
    const formula = BRANDING_APP_SIDEBAR_DEFAULTS.mail;
    expect(formula).toBe("var(--workspace-sidebar-surface)");
    for (const appId of WORKSPACE_APP_IDS) {
      expect(BRANDING_APP_SIDEBAR_DEFAULTS[appId]).toBe(formula);
    }
  });
});

describe("defaultHomeBrandingCssprops", () => {
  it("documents cream, ink, and workspace-home-bg", () => {
    const map = defaultHomeBrandingCssprops();
    expect(map["color-we-got-soft"]?.value).toBe("#fff5e9");
    expect(map["color-we-got-dark"]?.value).toBe("#003311");
    expect(map["workspace-home-bg"]?.value).toBe("#1b1d3a");
  });
});

describe("defaultAuthBrandingCssprops", () => {
  it("documents cream and ink only (no home navy)", () => {
    const map = defaultAuthBrandingCssprops();
    expect(map["color-we-got-soft"]?.value).toBe("#fff5e9");
    expect(map["color-we-got-dark"]?.value).toBe("#003311");
    expect(map["workspace-home-bg"]).toBeUndefined();
  });
});

describe("createBrandingStoryMeta defaults", () => {
  it("defaults iconPreset to current", () => {
    expect(brandingIconArgs.iconPreset).toBe("current");
    const meta = createBrandingStoryMeta({
      appId: "mail",
      workspaceClass: "mail-workspace",
    });
    expect(meta.args.iconPreset).toBe("current");
  });

  it.each(WORKSPACE_APP_IDS)("sets routerPath from appId for %s", (appId) => {
    expect(brandingRouterPath(appId)).toBe(`/${appId}`);
    const meta = createBrandingStoryMeta({
      appId,
      workspaceClass: `${appId}-workspace`,
    });
    expect(meta.parameters?.routerPath).toBe(`/${appId}`);
  });

  it("sets routerPath / for home", () => {
    expect(brandingRouterPath("home")).toBe("/");
    const meta = createBrandingStoryMeta({
      appId: "home",
      workspaceClass: "",
    });
    expect(meta.parameters?.routerPath).toBe("/");
  });

  it("auth defaults to cream/ink cssprops and /login routerPath", () => {
    expect(brandingRouterPath("auth")).toBe("/login");
    const meta = createBrandingStoryMeta({
      appId: "auth",
      workspaceClass: "login-screen",
      parameters: { routerPath: "/install" },
    });
    expect(meta.parameters?.routerPath).toBe("/install");
    const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
    expect(cssprops["color-we-got-soft"].value).toBe("#fff5e9");
    expect(cssprops["color-we-got-dark"].value).toBe("#003311");
    expect(cssprops["workspace-home-bg"]).toBeUndefined();
    expect(cssprops["workspace-accent"]).toBeUndefined();
  });

  it("allows parameters.routerPath override", () => {
    const meta = createBrandingStoryMeta({
      appId: "mail",
      workspaceClass: "mail-workspace",
      parameters: { routerPath: "/mail/inbox" },
    });
    expect(meta.parameters?.routerPath).toBe("/mail/inbox");
  });

  it("defaults Docs fullAccentSidebar off and omits fighting chrome cssprops", () => {
    expect(brandingDocsSidebarArgs.fullAccentSidebar).toBe(false);
    const meta = createBrandingStoryMeta({
      appId: "docs",
      workspaceClass: "docs-workspace",
      fullAccentSidebar: true,
    });
    expect(meta.args.fullAccentSidebar).toBe(false);
    const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
    expect(cssprops).not.toHaveProperty("app-sidebar-bg");
    expect(cssprops["workspace-accent"].value).toBe("var(--color-we-got-dark)");
    expect(cssprops["button-primary-bg"].value).toBe("var(--workspace-brand)");
    expect(cssprops["button-primary-fg"].value).toBe("var(--workspace-brand-foreground)");
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["workspace-brand"].value).toBe("#0045ff");
    expect(cssprops["workspace-brand-foreground"].value).toBe("#ffffff");
    expect(cssprops["wai-detail"]).toBeUndefined();
    expect(cssprops["wai-cutout"]).toBeUndefined();
  });

  it("uses production calendar accent and omits fighting chrome cssprops", () => {
    const meta = createBrandingStoryMeta({
      appId: "calendar",
      workspaceClass: "calendar-workspace",
    });
    const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
    expect(cssprops["workspace-accent"].value).toBe("var(--color-we-got-dark)");
    expect(cssprops["button-primary-bg"].value).toBe("var(--workspace-brand)");
    expect(cssprops["button-primary-fg"].value).toBe("var(--workspace-brand-foreground)");
    expect(cssprops["app-sidebar-bg"]).toBeUndefined();
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["workspace-brand"].value).toBe("#962fa8");
    expect(cssprops["workspace-brand-foreground"].value).toBe("#ffffff");
    expect(cssprops["wai-cutout"]).toBeUndefined();
  });

  it.each(["tasks", "meet", "docs"] as const)(
    "Themes/%s meta matches Apps production accents without inventing sidebar chrome",
    (appId) => {
      const meta = createBrandingStoryMeta({
        appId,
        workspaceClass: `${appId}-workspace`,
        ...(appId === "docs" ? { fullAccentSidebar: true as const } : {}),
      });
      const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
      expect(cssprops["workspace-accent"].value).toBe(BRANDING_APP_ACCENT_DEFAULTS[appId]);
      expect(cssprops["app-sidebar-bg"]).toBeUndefined();
      expect(cssprops["app-sidebar-color"]).toBeUndefined();
      expect(cssprops["workspace-brand"].value).toBe(BRANDING_APP_WAI_DEFAULTS[appId].bg);
      expect(cssprops["workspace-brand-foreground"].value).toBe(
        BRANDING_APP_WAI_DEFAULTS[appId].fg,
      );
    },
  );
});

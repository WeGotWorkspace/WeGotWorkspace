import { describe, expect, it } from "vitest";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";
import {
  BRANDING_APP_ACCENT_DEFAULTS,
  BRANDING_APP_ICON_DEFAULTS,
  BRANDING_APP_SIDEBAR_DEFAULT,
  BRANDING_WORKSPACE_SIDEBAR_SURFACE_DEFAULT,
  BRANDING_WORKSPACE_SURFACE_DEFAULT,
  brandingAppSidebarColorDefault,
  createAppBrandingCssprops,
  defaultAppBrandingCssprops,
  defaultAuthBrandingCssprops,
  defaultHomeBrandingCssprops,
  iconBrandingCssprops,
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

describe("iconBrandingCssprops", () => {
  it("emits only bg/fg when optional layers are omitted (calendar production shape)", () => {
    const map = iconBrandingCssprops({ bg: "#ffbdc2", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual([
      "workspace-icon-foreground",
      "workspace-icon-surface",
    ]);
    expect(map["workspace-icon-surface"]?.value).toBe("#ffbdc2");
    expect(map["workspace-icon-foreground"]?.value).toBe("#962fa8");
  });

  it("emits only bg and fg", () => {
    const map = iconBrandingCssprops({ bg: "#ffbdc2", fg: "#de4b0e" });
    expect(Object.keys(map).sort()).toEqual([
      "workspace-icon-foreground",
      "workspace-icon-surface",
    ]);
  });
});

describe("createAppBrandingCssprops", () => {
  it("omits sidebar and app-sidebar-color unless callers opt in", () => {
    const map = createAppBrandingCssprops("mail", { icon: BRANDING_APP_ICON_DEFAULTS.mail });
    expect(map["app-sidebar-bg"]).toBeUndefined();
    expect(map["app-sidebar-color"]).toBeUndefined();
  });

  it("emits chrome overrides when provided", () => {
    const map = createAppBrandingCssprops("mail", {
      sidebarValue: BRANDING_APP_SIDEBAR_DEFAULT,
      appSidebarColor: brandingAppSidebarColorDefault("mail"),
    });
    expect(map["app-sidebar-bg"]?.value).toBe(BRANDING_APP_SIDEBAR_DEFAULT);
    expect(map["app-sidebar-color"]?.value).toBe("#222222");
  });
});

describe("defaultAppBrandingCssprops", () => {
  it.each(WORKSPACE_APP_IDS)(
    "documents cream, ink, accent, and production icon pair only for %s (no sidebar chrome)",
    (appId) => {
      const map = defaultAppBrandingCssprops(appId);
      const icon = BRANDING_APP_ICON_DEFAULTS[appId];
      expect(map["color-we-got-soft"]?.value).toBe("#eeeeee");
      expect(map["color-we-got-dark"]?.value).toBe("#222222");
      expect(map["workspace-accent"]?.value).toBe(BRANDING_APP_ACCENT_DEFAULTS[appId]);
      expect(map["workspace-surface"]?.value).toBe(BRANDING_WORKSPACE_SURFACE_DEFAULT);
      expect(map["workspace-surface"]?.value).not.toBe("var(--workspace-surface)");
      expect(map["workspace-foreground"]?.value).toBe("var(--color-we-got-dark)");
      expect(map["workspace-sidebar-surface"]?.value).toBe(
        BRANDING_WORKSPACE_SIDEBAR_SURFACE_DEFAULT,
      );
      expect(map["workspace-sidebar-surface"]?.value).not.toContain("workspace-icon-surface");
      expect(map["workspace-sidebar-foreground"]?.value).toBe("var(--color-we-got-dark)");
      expect(map["app-sidebar-bg"]).toBeUndefined();
      expect(map["app-sidebar-color"]).toBeUndefined();
      expect(map["workspace-icon-surface"]?.value).toBe(icon.bg);
      expect(map["workspace-icon-foreground"]?.value).toBe(icon.fg);
      expect(map["wai-detail"]).toBeUndefined();
      expect(map["wai-detail-muted"]).toBeUndefined();
      expect(map["wai-cutout"]).toBeUndefined();
    },
  );

  it("never documents a token as a self-referential var()", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      for (const [key, entry] of Object.entries(defaultAppBrandingCssprops(appId))) {
        expect(entry.value.trim()).not.toBe(`var(--${key})`);
      }
    }
  });

  it("documents one production sidebar formula for every app", () => {
    expect(brandingAppSidebarColorDefault("docs")).toBe("#222222");
    expect(brandingAppSidebarColorDefault("mail")).toBe("#222222");
    expect(BRANDING_APP_SIDEBAR_DEFAULT).toBe("var(--workspace-sidebar-surface)");
  });
});

describe("defaultHomeBrandingCssprops", () => {
  it("documents cream, ink, and workspace-home-bg", () => {
    const map = defaultHomeBrandingCssprops();
    expect(map["color-we-got-soft"]?.value).toBe("#eeeeee");
    expect(map["color-we-got-dark"]?.value).toBe("#222222");
    expect(map["workspace-home-bg"]?.value).toBe("#1b1d3a");
  });
});

describe("defaultAuthBrandingCssprops", () => {
  it("documents cream and ink only (no home navy)", () => {
    const map = defaultAuthBrandingCssprops();
    expect(map["color-we-got-soft"]?.value).toBe("#eeeeee");
    expect(map["color-we-got-dark"]?.value).toBe("#222222");
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
    expect(cssprops["color-we-got-soft"].value).toBe("#eeeeee");
    expect(cssprops["color-we-got-dark"].value).toBe("#222222");
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
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["workspace-icon-surface"].value).toBe("#0045ff");
    expect(cssprops["workspace-icon-foreground"].value).toBe("#ffffff");
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
    expect(cssprops["app-sidebar-bg"]).toBeUndefined();
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["workspace-icon-surface"].value).toBe("#962fa8");
    expect(cssprops["workspace-icon-foreground"].value).toBe("#ffffff");
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
      expect(cssprops["workspace-icon-surface"].value).toBe(BRANDING_APP_ICON_DEFAULTS[appId].bg);
      expect(cssprops["workspace-icon-foreground"].value).toBe(
        BRANDING_APP_ICON_DEFAULTS[appId].fg,
      );
    },
  );
});

import { describe, expect, it } from "vitest";
import { WORKSPACE_APP_ACCENT, WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";
import {
  BRANDING_APP_ACCENT_DEFAULTS,
  BRANDING_APP_SIDEBAR_DEFAULTS,
  BRANDING_APP_WAI_DEFAULTS,
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
  it("matches production UI accents (not PWA tile) for calendar, tasks, meet", () => {
    expect(BRANDING_APP_ACCENT_DEFAULTS.calendar).toBe("#962fa8");
    expect(BRANDING_APP_ACCENT_DEFAULTS.tasks).toBe("#de4b0e");
    expect(BRANDING_APP_ACCENT_DEFAULTS.meet).toBe("#962fa8");
    expect(BRANDING_APP_ACCENT_DEFAULTS.calendar).not.toBe(WORKSPACE_APP_ACCENT.calendar);
    expect(BRANDING_APP_ACCENT_DEFAULTS.tasks).not.toBe(WORKSPACE_APP_ACCENT.tasks);
    expect(BRANDING_APP_ACCENT_DEFAULTS.meet).not.toBe(WORKSPACE_APP_ACCENT.meet);
  });

  it("matches WORKSPACE_APP_ACCENT when tile and UI accent are the same", () => {
    for (const appId of [
      "mail",
      "notes",
      "contacts",
      "docs",
      "drive",
      "admin",
      "settings",
    ] as const) {
      expect(BRANDING_APP_ACCENT_DEFAULTS[appId].toLowerCase()).toBe(
        WORKSPACE_APP_ACCENT[appId].toLowerCase(),
      );
    }
  });
});

describe("waiBrandingCssprops", () => {
  it("emits only bg/fg when optional layers are omitted (calendar production shape)", () => {
    const map = waiBrandingCssprops({ bg: "#ffbdc2", fg: "#962fa8" });
    expect(Object.keys(map).sort()).toEqual(["wai-bg", "wai-fg"]);
    expect(map["wai-bg"]?.value).toBe("#ffbdc2");
    expect(map["wai-fg"]?.value).toBe("#962fa8");
  });

  it("emits explicit optional layers when provided", () => {
    const map = waiBrandingCssprops({
      bg: "#ffbdc2",
      fg: "#de4b0e",
      detail: "#de4b0e",
      cutout: "#ffbdc2",
    });
    expect(map["wai-detail"]?.value).toBe("#de4b0e");
    expect(map["wai-cutout"]?.value).toBe("#ffbdc2");
    expect(map["wai-detail-muted"]).toBeUndefined();
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

describe("defaultAppBrandingCssprops", () => {
  it.each(WORKSPACE_APP_IDS)(
    "documents cream, ink, accent, and production wai only for %s (no sidebar chrome)",
    (appId) => {
      const map = defaultAppBrandingCssprops(appId);
      const wai = BRANDING_APP_WAI_DEFAULTS[appId];
      expect(map["color-cream"]?.value).toBe("#fff5e9");
      expect(map["color-ink"]?.value).toBe("#003311");
      expect(map["workspace-accent"]?.value).toBe(BRANDING_APP_ACCENT_DEFAULTS[appId]);
      expect(map["app-sidebar-bg"]).toBeUndefined();
      expect(map["app-sidebar-color"]).toBeUndefined();
      expect(map["wai-bg"]?.value).toBe(wai.bg);
      expect(map["wai-fg"]?.value).toBe(wai.fg);
      if (wai.detail !== undefined) {
        expect(map["wai-detail"]?.value).toBe(wai.detail);
      } else {
        expect(map["wai-detail"]).toBeUndefined();
      }
      if (wai.detailMuted !== undefined) {
        expect(map["wai-detail-muted"]?.value).toBe(wai.detailMuted);
      } else {
        expect(map["wai-detail-muted"]).toBeUndefined();
      }
      if (wai.cutout !== undefined) {
        expect(map["wai-cutout"]?.value).toBe(wai.cutout);
      } else {
        expect(map["wai-cutout"]).toBeUndefined();
      }
    },
  );

  it("documents production sidebar mix percentages (reference; not default cssprops)", () => {
    expect(brandingAppSidebarColorDefault("docs")).toBe("#ffffff");
    expect(brandingAppSidebarColorDefault("mail")).toBe("#003311");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.docs).toBe("var(--workspace-accent)");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.calendar).toContain("10%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.contacts).toContain("10%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.admin).toContain("16%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.settings).toContain("16%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.drive).toContain("32%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.meet).toContain("20%");
    expect(BRANDING_APP_SIDEBAR_DEFAULTS.mail).toContain("12%");
  });
});

describe("defaultHomeBrandingCssprops", () => {
  it("documents cream, ink, and workspace-home-bg", () => {
    const map = defaultHomeBrandingCssprops();
    expect(map["color-cream"]?.value).toBe("#fff5e9");
    expect(map["color-ink"]?.value).toBe("#003311");
    expect(map["workspace-home-bg"]?.value).toBe("#1b1d3a");
  });
});

describe("defaultAuthBrandingCssprops", () => {
  it("documents cream and ink only (no home navy)", () => {
    const map = defaultAuthBrandingCssprops();
    expect(map["color-cream"]?.value).toBe("#fff5e9");
    expect(map["color-ink"]?.value).toBe("#003311");
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
    expect(cssprops["color-cream"].value).toBe("#fff5e9");
    expect(cssprops["color-ink"].value).toBe("#003311");
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

  it("defaults Docs fullAccentSidebar true and omits fighting chrome cssprops", () => {
    expect(brandingDocsSidebarArgs.fullAccentSidebar).toBe(true);
    const meta = createBrandingStoryMeta({
      appId: "docs",
      workspaceClass: "docs-workspace",
      fullAccentSidebar: true,
    });
    expect(meta.args.fullAccentSidebar).toBe(true);
    const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
    expect(cssprops).not.toHaveProperty("app-sidebar-bg");
    expect(cssprops["workspace-accent"].value).toBe("#0045ff");
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["wai-bg"].value).toBe("#ffffff");
    expect(cssprops["wai-fg"].value).toBe("#0045ff");
    expect(cssprops["wai-detail"].value).toBe("#0045ff");
    expect(cssprops["wai-detail-muted"].value).toBe("#0045ff");
    expect(cssprops["wai-cutout"].value).toBe("#ffffff");
  });

  it("uses production calendar accent and omits fighting chrome cssprops", () => {
    const meta = createBrandingStoryMeta({
      appId: "calendar",
      workspaceClass: "calendar-workspace",
    });
    const cssprops = meta.parameters?.cssprops as Record<string, { value: string }>;
    expect(cssprops["workspace-accent"].value).toBe("#962fa8");
    expect(cssprops["app-sidebar-bg"]).toBeUndefined();
    expect(cssprops["app-sidebar-color"]).toBeUndefined();
    expect(cssprops["wai-bg"].value).toBe("#ffbdc2");
    expect(cssprops["wai-fg"].value).toBe("#962fa8");
    expect(cssprops["wai-cutout"]).toBeUndefined();
  });

  it.each(["tasks", "meet", "docs"] as const)(
    "Branding/%s meta matches Apps production accents without inventing sidebar chrome",
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
      expect(cssprops["wai-bg"].value).toBe(BRANDING_APP_WAI_DEFAULTS[appId].bg);
      expect(cssprops["wai-fg"].value).toBe(BRANDING_APP_WAI_DEFAULTS[appId].fg);
    },
  );
});

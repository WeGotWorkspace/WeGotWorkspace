import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";

/** cssprops addon entry — keys omit the `--` prefix (addon adds it). */
export type BrandingCsspropEntry = {
  value: string;
  description?: string;
  control?: "color" | "text";
  category?: string;
  subcategory?: string;
};

export type BrandingCsspropsMap = Record<string, BrandingCsspropEntry>;

/** Brand primitives every Themes/* story exposes. */
export function sharedBrandingCssprops(): BrandingCsspropsMap {
  return {
    "color-we-got-soft": {
      value: "#fff5e9",
      description: "We Got Soft",
      category: "Primitives",
    },
    "color-we-got-dark": {
      value: "#003311",
      description: "We Got Dark",
      category: "Primitives",
    },
  };
}

/** Switch-trigger `--wai-*` layers (document real workspace defaults per app). */
export function waiBrandingCssprops(defaults: {
  bg: string;
  fg: string;
  detail?: string;
  detailMuted?: string;
  cutout?: string;
}): BrandingCsspropsMap {
  // Only emit layers the workspace CSS actually sets. Inventing cutout/detail
  // (e.g. cutout←bg) fights production switch-trigger cascade once the
  // branding decorator forces SVG `inherit`.
  const map: BrandingCsspropsMap = {
    "wai-bg": {
      value: defaults.bg,
      description: 'Icon background layer (fill="var(--wai-bg, …)")',
      category: "Icon layers",
    },
    "wai-fg": {
      value: defaults.fg,
      description: "Icon foreground / marks",
      category: "Icon layers",
    },
  };
  if (defaults.detail !== undefined) {
    map["wai-detail"] = {
      value: defaults.detail,
      description: "Secondary detail strokes/fills",
      category: "Icon layers",
    };
  }
  if (defaults.detailMuted !== undefined) {
    map["wai-detail-muted"] = {
      value: defaults.detailMuted,
      description: "Muted detail layer",
      category: "Icon layers",
    };
  }
  if (defaults.cutout !== undefined) {
    map["wai-cutout"] = {
      value: defaults.cutout,
      description: "Cutout / knockout (reveals sidebar color)",
      category: "Icon layers",
    };
  }
  return map;
}

export type AppBrandingCsspropsOptions = {
  /** Token without `--`. Defaults to `workspace-accent`. */
  accentToken?: string;
  accentValue?: string;
  /** Optional direct sidebar override; omit to leave CSS color-mix as source of truth until set. */
  sidebarToken?: string;
  sidebarValue?: string;
  /** Optional nav on-color; omit so `*-workspace.css` `--app-sidebar-color` wins. */
  appSidebarColor?: string;
  wai?: {
    bg: string;
    fg: string;
    detail?: string;
    detailMuted?: string;
    cutout?: string;
  };
};

/**
 * Production UI accents from `*-workspace.css` `--workspace-accent` (brand hex).
 * May differ from `WORKSPACE_APP_ACCENT` (PWA / home-tile theme color) for
 * calendar, tasks, and meet.
 */
export const BRANDING_APP_ACCENT_DEFAULTS: Record<WorkspaceAppId, string> = {
  notes: "#ffc800",
  mail: "#de4b0e",
  calendar: "#962fa8",
  contacts: "#962fa8",
  tasks: "#de4b0e",
  drive: "#8ace00",
  docs: "#0045ff",
  settings: "#003311",
  meet: "#962fa8",
  admin: "#003311",
};

/**
 * Production `--app-sidebar-bg` formulas from `workspace-color.css` + mix overrides.
 * Docs uses full accent; Meet uses the split-chrome 20% wash.
 */
export const BRANDING_APP_SIDEBAR_DEFAULTS: Record<WorkspaceAppId, string> = {
  mail: "color-mix(in oklch, var(--workspace-accent) 12%, var(--color-we-got-soft))",
  notes: "color-mix(in oklch, var(--workspace-accent) 12%, var(--color-we-got-soft))",
  tasks: "color-mix(in oklch, var(--workspace-accent) 12%, var(--color-we-got-soft))",
  calendar: "color-mix(in oklch, var(--workspace-accent) 10%, var(--color-we-got-soft))",
  contacts: "color-mix(in oklch, var(--workspace-accent) 10%, var(--color-we-got-soft))",
  drive: "color-mix(in oklch, var(--workspace-accent) 32%, var(--color-we-got-soft))",
  docs: "var(--workspace-accent)",
  admin: "color-mix(in oklch, var(--workspace-accent) 16%, var(--color-we-got-soft))",
  settings: "color-mix(in oklch, var(--workspace-accent) 16%, var(--color-we-got-soft))",
  meet: "color-mix(in oklch, var(--workspace-accent) 20%, var(--color-we-got-soft))",
};

/** Production `--app-sidebar-color` (ink on cream rails; white on Docs full-accent rail). */
export function brandingAppSidebarColorDefault(appId: WorkspaceAppId): string {
  return appId === "docs" ? "#ffffff" : "#003311";
}

/**
 * Default cssprops map for one branded app workspace.
 * Callers may spread extra tokens via `createBrandingStoryMeta({ defaultCssprops })`.
 */
export function createAppBrandingCssprops(
  appId: WorkspaceAppId,
  options: AppBrandingCsspropsOptions = {},
): BrandingCsspropsMap {
  const accentToken = options.accentToken ?? "workspace-accent";
  const accentValue = options.accentValue ?? BRANDING_APP_ACCENT_DEFAULTS[appId];
  const sidebarToken = options.sidebarToken ?? "app-sidebar-bg";
  const map: BrandingCsspropsMap = {
    ...sharedBrandingCssprops(),
    [accentToken]: {
      value: accentValue,
      description: `Primary / CTA / badge fill (--${accentToken})`,
      category: "App chrome",
    },
  };

  // Only emit chrome overrides when callers opt in — otherwise `*-workspace.css`
  // owns sidebar tint + on-color (decorator `inherit` would wipe them).
  if (options.appSidebarColor !== undefined) {
    map["app-sidebar-color"] = {
      value: options.appSidebarColor,
      description: "Nav / switch lockup on-color",
      category: "App chrome",
    };
  }

  if (options.sidebarValue !== undefined) {
    map[sidebarToken] = {
      value: options.sidebarValue,
      description: `Direct sidebar surface (--${sidebarToken}); overrides CSS color-mix when set`,
      category: "App chrome",
      control: "text",
    };
  }

  if (options.wai) {
    Object.assign(map, waiBrandingCssprops(options.wai));
  }

  return map;
}

/** Per-app wai defaults sampled from `*-workspace.css` switch-trigger rules. */
export const BRANDING_APP_WAI_DEFAULTS: Record<
  WorkspaceAppId,
  { bg: string; fg: string; detail?: string; detailMuted?: string; cutout?: string }
> = {
  mail: { bg: "#de4b0e", fg: "#ffbdc2" },
  notes: { bg: "#ffc800", fg: "#de4b0e", detail: "#de4b0e", cutout: "#de4b0e" },
  docs: {
    bg: "#ffffff",
    fg: "#0045ff",
    detail: "#0045ff",
    detailMuted: "#0045ff",
    cutout: "#ffffff",
  },
  drive: { bg: "#8ace00", fg: "#1d6635", detail: "#1d6635", cutout: "#8ace00" },
  tasks: { bg: "#ffbdc2", fg: "#de4b0e", detail: "#de4b0e", cutout: "#ffbdc2" },
  calendar: { bg: "#ffbdc2", fg: "#962fa8" },
  contacts: { bg: "#962fa8", fg: "#ffbdc2" },
  meet: { bg: "#ffc800", fg: "#ffc800", detail: "#962fa8" },
  admin: { bg: "#003311", fg: "#ffffff", detail: "#8ace00" },
  settings: { bg: "#003311", fg: "#8ace00" },
};

/**
 * Convenience: shared cream/ink + accent + production `--wai-*` for a workspace app.
 *
 * Omits `--app-sidebar-bg` and `--app-sidebar-color` so the decorator’s `inherit`
 * bridge cannot wipe `*-workspace.css` (cream-mix / Docs full-accent rail +
 * on-color). Accent stays editable; sidebar tint still tracks accent via the
 * production color-mix. Docs Themes uses Controls `fullAccentSidebar` for the
 * rail comparison instead of a `--app-sidebar-bg` cssprop default.
 */
export function defaultAppBrandingCssprops(appId: WorkspaceAppId): BrandingCsspropsMap {
  return createAppBrandingCssprops(appId, {
    wai: BRANDING_APP_WAI_DEFAULTS[appId],
  });
}

/** Home branding surface — cream/ink + suite mark layers (no per-app accent). */
export function defaultHomeBrandingCssprops(): BrandingCsspropsMap {
  return {
    ...sharedBrandingCssprops(),
    "workspace-home-bg": {
      value: "#1b1d3a",
      description: "Suite / home dark shell background",
      category: "Home",
    },
  };
}

/**
 * Auth / installer cream shell — suite cream/ink only (no home navy, no app accent).
 * Used by `Themes/Login` and `Themes/Installer` (`.login-screen`).
 */
export function defaultAuthBrandingCssprops(): BrandingCsspropsMap {
  return sharedBrandingCssprops();
}

export const BRANDING_ICON_PRESET_OPTIONS = ["current", "custom", ...WORKSPACE_APP_IDS] as const;

export type BrandingIconPreset = (typeof BRANDING_ICON_PRESET_OPTIONS)[number];

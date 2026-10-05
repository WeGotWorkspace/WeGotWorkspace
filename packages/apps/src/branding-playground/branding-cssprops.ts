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

/** Switch-trigger `--workspace-icon-surface*` layers (document real workspace defaults per app). */
export function waiBrandingCssprops(defaults: { bg: string; fg: string }): BrandingCsspropsMap {
  return {
    "workspace-icon-surface": {
      value: defaults.bg,
      description: 'Icon background layer (fill="var(--workspace-icon-surface, …)")',
      category: "Icon layers",
      control: defaults.bg.startsWith("#") ? "color" : "text",
    },
    "workspace-icon-foreground": {
      value: defaults.fg,
      description: "Icon foreground / marks",
      category: "Icon layers",
      control: defaults.fg.startsWith("#") ? "color" : "text",
    },
  };
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
  };
};

/**
 * Production UI accents from `*-workspace.css` `--workspace-accent`.
 * Every app uses `--color-we-got-dark`. Home-tile `WORKSPACE_APP_ACCENT` stays per app.
 * The sidebar rail is Soft and does not follow this accent.
 */
export const BRANDING_APP_ACCENT_DEFAULT = "var(--color-we-got-dark)";

export const BRANDING_APP_ACCENT_DEFAULTS: Record<WorkspaceAppId, string> = {
  notes: BRANDING_APP_ACCENT_DEFAULT,
  mail: BRANDING_APP_ACCENT_DEFAULT,
  calendar: BRANDING_APP_ACCENT_DEFAULT,
  contacts: BRANDING_APP_ACCENT_DEFAULT,
  tasks: BRANDING_APP_ACCENT_DEFAULT,
  drive: BRANDING_APP_ACCENT_DEFAULT,
  docs: BRANDING_APP_ACCENT_DEFAULT,
  settings: BRANDING_APP_ACCENT_DEFAULT,
  meet: BRANDING_APP_ACCENT_DEFAULT,
  admin: BRANDING_APP_ACCENT_DEFAULT,
};

/**
 * App paper from `workspace-color.css`. Very light tint of Soft — lighter than
 * the sidebar, which is the Soft primitive. The recipe lives on `:root` as
 * `--workspace-surface` so portaled dialogs resolve the same paper.
 */
export const BRANDING_WORKSPACE_SURFACE_DEFAULT = "var(--workspace-surface)";

/**
 * Production `--app-sidebar-bg` from `workspace-color.css`.
 * The rail is a 5% brand wash into white unless a product overrides the mix.
 */
export const BRANDING_APP_SIDEBAR_DEFAULT = "var(--workspace-sidebar-surface)";

export const BRANDING_APP_SIDEBAR_DEFAULTS: Record<WorkspaceAppId, string> = {
  mail: BRANDING_APP_SIDEBAR_DEFAULT,
  notes: BRANDING_APP_SIDEBAR_DEFAULT,
  tasks: BRANDING_APP_SIDEBAR_DEFAULT,
  calendar: BRANDING_APP_SIDEBAR_DEFAULT,
  contacts: BRANDING_APP_SIDEBAR_DEFAULT,
  drive: BRANDING_APP_SIDEBAR_DEFAULT,
  docs: BRANDING_APP_SIDEBAR_DEFAULT,
  admin: BRANDING_APP_SIDEBAR_DEFAULT,
  settings: BRANDING_APP_SIDEBAR_DEFAULT,
  meet: BRANDING_APP_SIDEBAR_DEFAULT,
};

/** Production `--app-sidebar-color` (ink on every cream rail). */
export function brandingAppSidebarColorDefault(_appId: WorkspaceAppId): string {
  return "#003311";
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
      description: `Solid accent (--${accentToken}). Production follows We Got Dark. Primary buttons use this pair.`,
      category: "App chrome",
      control: "text",
    },
    "workspace-surface": {
      value: BRANDING_WORKSPACE_SURFACE_DEFAULT,
      description: "App paper — very light tint of We Got Soft. The sidebar stays Soft.",
      category: "App chrome",
      control: "text",
    },
    "workspace-foreground": {
      value: "var(--color-we-got-dark)",
      description: "Ink on app paper.",
      category: "App chrome",
      control: "text",
    },
    "workspace-accent-foreground": {
      value: "#ffffff",
      description: "Ink on the solid accent.",
      category: "App chrome",
      control: "text",
    },
    "workspace-sidebar-surface": {
      value: brandingAppSidebarBg(appId),
      description: "Sidebar fill — icon hue mixed into paper. Tasks 20%, Notes 15%, others 5%.",
      category: "App chrome",
      control: "text",
    },
    "workspace-sidebar-foreground": {
      value: "var(--color-we-got-dark)",
      description: "Ink on the sidebar rail.",
      category: "App chrome",
      control: "text",
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
export const BRANDING_APP_WAI_DEFAULTS: Record<WorkspaceAppId, { bg: string; fg: string }> = {
  mail: { bg: "#de4b0e", fg: "#ffffff" },
  notes: { bg: "#ffc800", fg: "#ffffff" },
  docs: { bg: "#0045ff", fg: "#ffffff" },
  drive: { bg: "var(--color-we-got-dark)", fg: "var(--color-we-got-brat)" },
  tasks: { bg: "#ffbdc2", fg: "var(--color-we-got-dark)" },
  calendar: { bg: "#962fa8", fg: "#ffffff" },
  contacts: { bg: "#a3c4e8", fg: "var(--color-we-got-dark)" },
  meet: { bg: "var(--color-we-got-soft)", fg: "#ba9689" },
  admin: { bg: "var(--color-we-got-dark)", fg: "var(--color-we-got-soft)" },
  settings: { bg: "var(--color-we-got-dark)", fg: "var(--color-we-got-soft)" },
};

/**
 * Production `--sidebar-bg`. Most apps mix 5% of the icon into white.
 * Tasks and Notes use a stronger wash so pink and yellow still read.
 */
export function brandingAppSidebarBg(appId: WorkspaceAppId): string {
  if (appId === "tasks") {
    return "color-mix(in oklch, var(--workspace-icon-surface) 20%, var(--workspace-surface))";
  }
  if (appId === "notes") {
    return "color-mix(in oklch, var(--workspace-icon-surface) 15%, var(--workspace-surface))";
  }
  return "color-mix(in oklch, var(--workspace-icon-surface) 5%, var(--workspace-surface))";
}

/**
 * Convenience: shared cream/ink + accent + production `--workspace-icon-*` for a workspace app.
 *
 * Omits `--app-sidebar-bg` and `--app-sidebar-color` so the decorator cannot
 * wipe the Soft rail. `--sidebar-bg` and `--sidebar-on` are included because
 * they match `workspace-color.css`; the decorator paints them only after a
 * control changes. Accent follows Dark and does not retint the rail.
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

import type { Meta } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { workspaceAppLabel } from "@/lib/workspace-app-icons";
import {
  brandingDocsSidebarArgs,
  brandingDocsSidebarArgTypes,
  brandingIconArgs,
  brandingIconArgTypes,
} from "./branding-arg-types";
import {
  defaultAppBrandingCssprops,
  defaultAuthBrandingCssprops,
  defaultHomeBrandingCssprops,
  type BrandingCsspropsMap,
} from "./branding-cssprops";
import {
  BrandingWorkspaceDecorator,
  type BrandingPlaygroundAppId,
  type BrandingPlaygroundParameters,
  type BrandingStoryArgs,
} from "./branding-workspace-decorator";

export type CreateBrandingStoryMetaOptions<TComponent = ComponentType> = {
  /**
   * Suite app id, `home` for the dashboard grid, or `auth` for cream
   * Login / Installer shells (`.login-screen`).
   */
  appId: BrandingPlaygroundAppId;
  /**
   * Root BEM class the decorator retargets (e.g. `mail-workspace`).
   * Use `""` for Home; `login-screen` for Login / Installer.
   */
  workspaceClass: string;
  /** Accent token without `--` (e.g. `mail-accent`). Ignored for `home` / `auth`. */
  accentToken?: string;
  /**
   * cssprops map (keys without `--`). Merged over
   * {@link defaultAppBrandingCssprops} / {@link defaultHomeBrandingCssprops} /
   * {@link defaultAuthBrandingCssprops}.
   */
  defaultCssprops?: BrandingCsspropsMap;
  /**
   * When true, expose Controls `fullAccentSidebar` (default `true`) for Docs
   * full-accent rail vs cream-mix wash comparison.
   */
  fullAccentSidebar?: boolean;
  /** Storybook title override; defaults to `Branding/{Label}`. */
  title?: string;
  component?: TComponent;
  parameters?: Meta["parameters"];
};

function brandingTitle(appId: BrandingPlaygroundAppId): string {
  if (appId === "home") return "Branding/Home";
  if (appId === "auth") return "Branding/Auth";
  return `Branding/${workspaceAppLabel(appId)}`;
}

/**
 * Storybook memory-router path so AppSwitch / BrandLockup infer this app’s
 * label + switch-trigger icon (preview defaults to `/notes` otherwise).
 * Auth callers should pass `parameters.routerPath` (`/login` or `/install`).
 */
export function brandingRouterPath(appId: BrandingPlaygroundAppId): string {
  if (appId === "home") return "/";
  if (appId === "auth") return "/login";
  return `/${appId}`;
}

function baseCssprops(
  appId: BrandingPlaygroundAppId,
  accentToken: string | undefined,
): BrandingCsspropsMap {
  if (appId === "home") return defaultHomeBrandingCssprops();
  if (appId === "auth") return defaultAuthBrandingCssprops();
  const defaults = defaultAppBrandingCssprops(appId);
  if (!accentToken || accentToken === `${appId}-accent`) return defaults;
  // Remap default accent key when caller uses a non-standard token name.
  const { [`${appId}-accent`]: accentEntry, ...rest } = defaults;
  if (!accentEntry) return defaults;
  return { ...rest, [accentToken]: accentEntry };
}

/**
 * CSF3 meta factory for designer `Branding/*` stories.
 *
 * Storybook’s CSF indexer requires a **literal** `title` on an object export.
 * Spread the factory result, then restate `title`:
 *
 * @example
 * ```tsx
 * const brandingMeta = createBrandingStoryMeta({
 *   appId: "mail",
 *   workspaceClass: "mail-workspace",
 *   accentToken: "mail-accent",
 *   component: MailWorkspace,
 * });
 * const meta = {
 *   ...brandingMeta,
 *   title: "Branding/Mail",
 *   tags: ["vitest-ci"],
 * } satisfies Meta<typeof MailWorkspace>;
 * export default meta;
 * ```
 */
export function createBrandingStoryMeta<TComponent extends ComponentType>(
  options: CreateBrandingStoryMetaOptions<TComponent>,
): Meta<TComponent> & { args: BrandingStoryArgs } {
  const {
    appId,
    workspaceClass,
    accentToken = appId === "home" || appId === "auth" ? undefined : `${appId}-accent`,
    defaultCssprops = {},
    fullAccentSidebar = false,
    title = brandingTitle(appId),
    component,
    parameters,
  } = options;

  const brandingPlayground: BrandingPlaygroundParameters = {
    appId,
    workspaceClass,
    accentToken,
  };

  const cssprops: BrandingCsspropsMap = {
    ...baseCssprops(appId, accentToken),
    ...defaultCssprops,
  };

  // Docs full-accent mode owns `--docs-sidebar`; drop cssprop so inherit doesn't fight the boolean.
  if (fullAccentSidebar && "docs-sidebar" in cssprops) {
    delete cssprops["docs-sidebar"];
  }

  const meta = {
    title,
    component,
    // Include Branding/* in CI Storybook Vitest smoke (`STORYBOOK_VITEST_SMOKE=1`).
    tags: ["vitest-ci"],
    parameters: {
      layout: "fullscreen" as const,
      brandingPlayground,
      cssprops,
      // AppSwitch reads pathname for subtitle + icon; must match appId (not preview’s `/notes`).
      routerPath: brandingRouterPath(appId),
      ...parameters,
    },
    argTypes: {
      ...brandingIconArgTypes,
      ...(fullAccentSidebar ? brandingDocsSidebarArgTypes : {}),
    },
    args: {
      ...brandingIconArgs,
      ...(fullAccentSidebar ? brandingDocsSidebarArgs : {}),
    },
    decorators: [BrandingWorkspaceDecorator],
  };

  return meta as unknown as Meta<TComponent> & { args: BrandingStoryArgs };
}

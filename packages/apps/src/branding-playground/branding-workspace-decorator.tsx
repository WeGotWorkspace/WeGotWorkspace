import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { WorkspaceAppIconOverrideProvider } from "@/lib/workspace-app-icon";
import { WORKSPACE_APP_ICON_INLINE } from "@/lib/workspace-app-icon-svgs";
import { isWorkspaceAppId, type WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { BrandingCsspropsMap, BrandingIconPreset } from "./branding-cssprops";

export type BrandingPlaygroundAppId = WorkspaceAppId | "home" | "auth";

export type BrandingPlaygroundParameters = {
  /** Suite app, home grid, or cream auth shell (`login` / `install`). */
  appId: BrandingPlaygroundAppId;
  /**
   * Root BEM class the decorator retargets (e.g. `mail-workspace`).
   * Empty for Home grid; use `login-screen` for Login / Installer.
   */
  workspaceClass: string;
  accentToken?: string;
};

export type BrandingStoryArgs = {
  iconPreset?: BrandingIconPreset;
  svgMarkup?: string;
  /** Docs Branding story only — enabled via createBrandingStoryMeta({ fullAccentSidebar: true }). */
  fullAccentSidebar?: boolean;
};

type CsspropSeedEntry = { key: string; value: string };

const WAI_CSSPROP_KEYS = [
  "wai-bg",
  "wai-fg",
  "wai-detail",
  "wai-detail-muted",
  "wai-cutout",
] as const;

function csspropEntriesFromParameters(parameters: Record<string, unknown>): CsspropSeedEntry[] {
  const cssprops = parameters.cssprops as BrandingCsspropsMap | undefined;
  if (!cssprops || typeof cssprops !== "object") return [];
  return Object.entries(cssprops).flatMap(([key, entry]) => {
    if (key === "disable" || key === "presetColors") return [];
    if (!entry || typeof entry !== "object" || !("value" in entry)) return [];
    if (typeof entry.value !== "string") return [];
    return [{ key, value: entry.value }];
  });
}

/**
 * Resolve playground SVG markup from Controls.
 * `current` → no override (production artwork). `custom` → textarea. Else → that app’s inline SVG.
 */
export function resolveBrandingIconMarkup(
  args: BrandingStoryArgs,
  _appId: BrandingPlaygroundAppId,
): string | undefined {
  const preset = args.iconPreset ?? "current";
  if (preset === "current") return undefined;
  if (preset === "custom") {
    const markup = args.svgMarkup?.trim();
    return markup || undefined;
  }
  if (isWorkspaceAppId(preset)) {
    return WORKSPACE_APP_ICON_INLINE[preset];
  }
  return undefined;
}

function docsSidebarOverrideCss(
  workspaceClass: string,
  fullAccentSidebar: boolean | undefined,
): string {
  if (fullAccentSidebar === undefined) return "";
  const sidebarValue = fullAccentSidebar
    ? "#0045ff"
    : "color-mix(in oklch, var(--workspace-accent) 12%, var(--color-we-got-soft))";
  return `
.branding-playground-root .${workspaceClass} {
  --app-sidebar-bg: ${sidebarValue};
}
`;
}

/**
 * Resolve cssprop map for the playground: live `document.body` values from
 * `@ljcl/storybook-addon-cssprops` win; otherwise parameter defaults.
 *
 * Never returns empty — Canvas panel cleanup (`removeAttribute("style")`) and
 * Docs (`body` often only has `filter: none`) must still yield concrete tokens.
 */
export function resolveBrandingCsspropValues(
  entries: CsspropSeedEntry[],
  body: CSSStyleDeclaration = document.body.style,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { key, value } of entries) {
    const fromBody = body.getPropertyValue(`--${key}`).trim();
    values[`--${key}`] = fromBody || value;
  }
  return values;
}

/**
 * Push cssprop values onto the playground root (imperative companion to React
 * `style`). Body values still win when present so live panel edits keep working.
 */
export function syncBrandingCsspropsToRoot(
  root: HTMLElement,
  entries: CsspropSeedEntry[],
  body: CSSStyleDeclaration = document.body.style,
): void {
  const values = resolveBrandingCsspropValues(entries, body);
  for (const [prop, value] of Object.entries(values)) {
    root.style.setProperty(prop, value);
  }
}

/**
 * Build workspace override CSS with **concrete** token values (not `inherit`).
 *
 * `inherit` wiped production `*-workspace.css` defaults whenever the ancestor
 * chain had no value (Canvas cssprops panel cleanup / Docs body without seeds).
 * Concrete overrides keep CTAs branded even when `document.body` has no cssprops.
 */
export function buildBrandingWorkspaceOverrideCss(
  workspaceClass: string,
  values: Record<string, string>,
  fullAccentSidebar?: boolean,
): string {
  if (!workspaceClass) return "";

  const decls = Object.entries(values)
    .map(([prop, value]) => `  ${prop}: ${value};`)
    .join("\n");

  const waiDecls = Object.entries(values)
    .filter(([prop]) => (WAI_CSSPROP_KEYS as readonly string[]).includes(prop.slice(2)))
    .map(([prop, value]) => `  ${prop}: ${value};`)
    .join("\n");

  return `
.branding-playground-root .${workspaceClass} {
${decls}
}
${
  waiDecls
    ? `.branding-playground-root .${workspaceClass} .app-sidebar__header .app-switch-button__icon.workspace-app-icon--switch-trigger svg {
${waiDecls}
}
`
    : ""
}
${docsSidebarOverrideCss(workspaceClass, fullAccentSidebar)}
`;
}

/**
 * Keep playground-root cssprops in sync with body (addon) + parameter defaults.
 * Observes body `style` so Canvas panel setAttribute / removeAttribute still
 * drives live edits without leaving workspace tokens empty.
 */
function BrandingCsspropRootSync({
  entries,
  onValues,
}: {
  entries: CsspropSeedEntry[];
  onValues: (values: Record<string, string>) => void;
}): ReactNode {
  const signature = entries.map((e) => `${e.key}=${e.value}`).join("\n");
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const onValuesRef = useRef(onValues);
  onValuesRef.current = onValues;

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const sync = () => {
      onValuesRef.current(resolveBrandingCsspropValues(entriesRef.current));
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [signature]);
  return null;
}

function BrandingPlaygroundShell({
  workspaceClass,
  overrideMarkup,
  entries,
  fullAccentSidebar,
  children,
}: {
  workspaceClass: string;
  overrideMarkup: string | undefined;
  entries: CsspropSeedEntry[];
  fullAccentSidebar: boolean | undefined;
  children: ReactNode;
}): ReactNode {
  const [csspropValues, setCsspropValues] = useState(() => {
    if (typeof document === "undefined") {
      return Object.fromEntries(entries.map(({ key, value }) => [`--${key}`, value]));
    }
    return resolveBrandingCsspropValues(entries);
  });

  const rootStyle = {
    minHeight: "100%",
    ...csspropValues,
  } as CSSProperties;

  const styleText = buildBrandingWorkspaceOverrideCss(
    workspaceClass,
    csspropValues,
    fullAccentSidebar,
  );

  return (
    <div className="branding-playground-root" style={rootStyle}>
      <BrandingCsspropRootSync entries={entries} onValues={setCsspropValues} />
      {styleText ? <style>{styleText}</style> : null}
      <WorkspaceAppIconOverrideProvider svgMarkup={overrideMarkup}>
        {children}
      </WorkspaceAppIconOverrideProvider>
    </div>
  );
}

/**
 * Wraps a mock workspace so cssprops win over workspace CSS defaults (via
 * concrete overrides on `.branding-playground-root .${workspaceClass}` +
 * switch-trigger SVG), and wires icon overrides.
 */
export const BrandingWorkspaceDecorator: Decorator = (Story, context) => {
  const branding = context.parameters.brandingPlayground as
    | BrandingPlaygroundParameters
    | undefined;
  const workspaceClass = branding?.workspaceClass ?? "";
  const appId = branding?.appId ?? "mail";
  const args = context.args as BrandingStoryArgs;
  const overrideMarkup = resolveBrandingIconMarkup(args, appId);
  const entries = csspropEntriesFromParameters(context.parameters as Record<string, unknown>);

  return (
    <BrandingPlaygroundShell
      workspaceClass={workspaceClass}
      overrideMarkup={overrideMarkup}
      entries={entries}
      fullAccentSidebar={args.fullAccentSidebar}
    >
      <Story />
    </BrandingPlaygroundShell>
  );
};

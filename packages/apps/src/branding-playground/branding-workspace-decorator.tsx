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

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * styles.css declares each brand color twice: hex, then `oklch(from #hex l c h)`.
 * A raw hex on the workspace makes `color-mix(in oklch, …, #fff)` drop the hue
 * (Storybook rails go accent-tinted; the app stays warm). Keep the picker on hex
 * and apply the same oklch form the app inherits.
 */
export function brandColorForCascade(value: string): string {
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) return `oklch(from ${trimmed} l c h)`;
  return trimmed;
}

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

/** Switch-trigger SVG keeps the sheet pair. Docs is a blue tile with white marks. */
function sidebarSwitchTriggerWaiDecls(
  _workspaceClass: string,
  values: Record<string, string>,
): string {
  const bg = values["--workspace-brand"];
  const fg = values["--workspace-brand-foreground"];
  if (bg === undefined && fg === undefined) return "";
  const lines: string[] = [];
  if (bg !== undefined) lines.push(`  --workspace-brand: ${brandColorForCascade(bg)};`);
  if (fg !== undefined) lines.push(`  --workspace-brand-foreground: ${brandColorForCascade(fg)};`);
  return lines.join("\n");
}

function docsSidebarOverrideCss(
  workspaceClass: string,
  fullAccentSidebar: boolean | undefined,
): string {
  if (!fullAccentSidebar) return "";
  return `
.branding-playground-root .${workspaceClass} .app-sidebar {
  --app-sidebar-bg: #0045ff;
}
`;
}

/** Addon localStorage. Untouched rows equal `initialCustomProperties`. */
export const BRANDING_CSSPROPS_STORAGE_KEY = "addon-cssprops";

export type AddonCsspropsStore = {
  customProperties?: Record<string, Record<string, string>>;
  initialCustomProperties?: Record<string, Record<string, string>>;
};

/** Same cascade form, so `#fff` and `oklch(from #fff l c h)` count as one value. */
export function brandingCsspropEquals(a: string, b: string): boolean {
  return brandColorForCascade(a.trim()) === brandColorForCascade(b.trim());
}

/**
 * Tokens the canvas may paint over `*-workspace.css`.
 *
 * The workspace stylesheet is the source of truth. Parameter defaults are the
 * panel's starting point, not a second theme: they are omitted here. A body
 * value counts only when it differs from that default. A stored row that still
 * equals its saved initial value is an old default, not an edit, so it is
 * omitted too.
 */
export function csspropValuesForPaint(
  entries: CsspropSeedEntry[],
  body: CSSStyleDeclaration = typeof document === "undefined"
    ? ({} as CSSStyleDeclaration)
    : document.body.style,
  store: AddonCsspropsStore | null = null,
  storyId: string | null = null,
): Record<string, string> {
  const custom = storyId ? store?.customProperties?.[storyId] : undefined;
  const initial = storyId ? store?.initialCustomProperties?.[storyId] : undefined;
  const paint: Record<string, string> = {};
  for (const { key, value: seed } of entries) {
    const stored = custom?.[key];
    const initialValue = initial?.[key];
    const untouchedStaleDefault =
      stored !== undefined &&
      initialValue !== undefined &&
      brandingCsspropEquals(stored, initialValue) &&
      !brandingCsspropEquals(stored, seed);
    const fromBody = body.getPropertyValue?.(`--${key}`)?.trim() ?? "";
    const chosen = untouchedStaleDefault ? seed : fromBody || seed;
    if (brandingCsspropEquals(chosen, seed)) continue;
    paint[`--${key}`] = chosen;
  }
  return paint;
}

/**
 * Move untouched addon rows onto the current parameter defaults.
 * Rows the user changed (`custom` ≠ `initial`) stay put.
 */
export function reconcileUntouchedCsspropDefaults(
  store: AddonCsspropsStore,
  storyId: string,
  entries: CsspropSeedEntry[],
): { store: AddonCsspropsStore; changed: boolean } {
  const custom = store.customProperties?.[storyId];
  const initial = store.initialCustomProperties?.[storyId];
  if (!custom || !initial) return { store, changed: false };

  let changed = false;
  const nextCustom = { ...custom };
  const nextInitial = { ...initial };
  for (const { key, value } of entries) {
    const stored = custom[key];
    const initialValue = initial[key];
    if (stored === undefined || initialValue === undefined) continue;
    if (!brandingCsspropEquals(stored, initialValue)) continue;
    if (brandingCsspropEquals(stored, value)) continue;
    nextCustom[key] = value;
    nextInitial[key] = value;
    changed = true;
  }
  if (!changed) return { store, changed: false };
  return {
    changed: true,
    store: {
      ...store,
      customProperties: { ...store.customProperties, [storyId]: nextCustom },
      initialCustomProperties: { ...store.initialCustomProperties, [storyId]: nextInitial },
    },
  };
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
    root.style.setProperty(prop, brandColorForCascade(value));
  }
}

/**
 * Build workspace override CSS for tokens the designer changed.
 *
 * An empty `values` map emits no workspace rule, so `*-workspace.css` paints.
 * `inherit` is never used: it wiped production defaults when the ancestor
 * chain had no value.
 */
export function buildBrandingWorkspaceOverrideCss(
  workspaceClass: string,
  values: Record<string, string>,
  fullAccentSidebar?: boolean,
): string {
  if (!workspaceClass) return "";

  const decls = Object.entries(values)
    .map(([prop, value]) => `  ${prop}: ${brandColorForCascade(value)};`)
    .join("\n");

  const waiDecls = sidebarSwitchTriggerWaiDecls(workspaceClass, values);
  const workspaceRule = decls
    ? `.branding-playground-root .${workspaceClass} {\n${decls}\n}\n`
    : "";

  return `${workspaceRule}${
    waiDecls
      ? `.branding-playground-root .${workspaceClass} .app-sidebar__header .app-switch-button__icon.workspace-app-icon--switch-trigger svg {
${waiDecls}
}
`
      : ""
  }${docsSidebarOverrideCss(workspaceClass, fullAccentSidebar)}`;
}

function brandingStoryId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id");
}

function readAddonCsspropsStore(): AddonCsspropsStore | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(BRANDING_CSSPROPS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AddonCsspropsStore;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAddonCsspropsStore(store: AddonCsspropsStore): void {
  const serialized = JSON.stringify(store);
  localStorage.setItem(BRANDING_CSSPROPS_STORAGE_KEY, serialized);
  const parentWindow = window.parent;
  if (!parentWindow || parentWindow === window) return;
  parentWindow.dispatchEvent(
    new StorageEvent("storage", {
      key: BRANDING_CSSPROPS_STORAGE_KEY,
      newValue: serialized,
      storageArea: localStorage,
    }),
  );
}

/**
 * Keep playground-root cssprops in sync with body (addon) + parameter defaults.
 * Observes body `style` so Canvas panel cleanup still drives live edits.
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
      const storyId = brandingStoryId();
      const store = readAddonCsspropsStore();
      if (storyId && store) {
        const next = reconcileUntouchedCsspropDefaults(store, storyId, entriesRef.current);
        if (next.changed) writeAddonCsspropsStore(next.store);
      }
      const paint = csspropValuesForPaint(
        entriesRef.current,
        document.body.style,
        readAddonCsspropsStore(),
        storyId,
      );
      onValuesRef.current(paint);
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
    if (typeof document === "undefined") return {};
    return csspropValuesForPaint(
      entries,
      document.body.style,
      readAddonCsspropsStore(),
      brandingStoryId(),
    );
  });

  const onCsspropValues = (next: Record<string, string>) => {
    setCsspropValues((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
  };

  const rootStyle = {
    minHeight: "100%",
    ...Object.fromEntries(
      Object.entries(csspropValues).map(([prop, value]) => [prop, brandColorForCascade(value)]),
    ),
  } as CSSProperties;

  const styleText = buildBrandingWorkspaceOverrideCss(
    workspaceClass,
    csspropValues,
    fullAccentSidebar,
  );

  return (
    <div className="branding-playground-root" style={rootStyle}>
      <BrandingCsspropRootSync entries={entries} onValues={onCsspropValues} />
      {styleText ? <style>{styleText}</style> : null}
      <WorkspaceAppIconOverrideProvider svgMarkup={overrideMarkup}>
        {children}
      </WorkspaceAppIconOverrideProvider>
    </div>
  );
}

/**
 * Wraps a mock workspace. `*-workspace.css` paints the theme. The CSS props
 * panel overrides a token only after it changes; untouched defaults are not
 * written onto the workspace. Icon preset swaps stay on the decorator.
 */
export const BrandingWorkspaceDecorator: Decorator = (Story, context) => {
  const branding = context.parameters.brandingPlayground as
    BrandingPlaygroundParameters | undefined;
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

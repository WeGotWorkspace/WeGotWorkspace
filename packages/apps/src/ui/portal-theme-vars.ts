/**
 * Portaled Radix surfaces (Select, DropdownMenu) render under `document.body`,
 * so they do not inherit workspace `--menu-item-*` / `--button-outline-*` /
 * `--workspace-accent`. Copy cascaded custom properties from the open trigger
 * onto the portaled content so menu fg/accent match the trigger's workspace.
 * Item washes prefer quiet `--menu-item-*-background` (14/18/24) over loud
 * sidebar `--button-outline-*` chips (40/55/65).
 *
 * Workspace sheets often publish washes as `color-mix(… var(--*-accent) …)`.
 * Those accent deps are not reliably enumerable via `getComputedStyle().item()`,
 * so we (1) walk `var(--*)` references from the seed outline/accent tokens, then
 * (2) overwrite seeds with fully resolved colors from a probe under the trigger
 * whenever the engine can compute them (avoids invalid-at-computed-value washes
 * falling back to ink-gray on the portal).
 */

export const PORTAL_THEME_BACKGROUND_VARS = [
  "--menu-item-hover-background",
  "--menu-item-selected-background",
  "--menu-item-selected-hover-background",
  "--button-outline-hover-background",
  "--button-outline-active-background",
  "--button-outline-active-hover-background",
] as const;

export const PORTAL_THEME_COLOR_VARS = [
  "--button-active-color",
  "--button-outline-hover-color",
  "--button-outline-color",
  "--workspace-accent",
] as const;

const CUSTOM_PROPERTY_REF = /var\(\s*(--[\w-]+)/g;

const CONCRETE_COLOR = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

function escapeCssIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  // jsdom may lack CSS.escape; Radix content ids are alphanumeric + hyphen.
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function shouldBridgeCustomProperty(name: string): boolean {
  return (
    name.startsWith("--button-") ||
    name.startsWith("--menu-item-") ||
    name.startsWith("--workspace-") ||
    name.startsWith("--color-") ||
    name.includes("accent")
  );
}

/** Collect `var(--token)` names referenced by a cascaded custom-property value. */
export function collectCustomPropertyRefs(value: string): string[] {
  const refs: string[] = [];
  CUSTOM_PROPERTY_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CUSTOM_PROPERTY_REF.exec(value)) !== null) {
    refs.push(match[1]!);
  }
  return refs;
}

/** True when `getComputedStyle` returned a usable color (not empty / transparent keyword alone). */
export function isResolvedCssColor(value: string): boolean {
  const v = value.trim();
  if (!v || v === "transparent" || v === "rgba(0, 0, 0, 0)" || v === "rgb(0, 0, 0, 0)") {
    return false;
  }
  return CONCRETE_COLOR.test(v) || /^#([0-9a-f]{3,8})$/i.test(v);
}

/**
 * Resolve a custom property to a concrete color by painting it on a temporary
 * child of `host` (inherits that element's custom-property cascade).
 */
export function resolveCustomPropertyColor(host: Element, property: string): string {
  if (!(host instanceof HTMLElement)) return "";
  const probe = document.createElement("span");
  probe.setAttribute("data-portal-theme-probe", "");
  probe.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  probe.style.setProperty("background-color", `var(${property})`);
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor.trim();
  probe.remove();
  return resolved;
}

function copyVarChain(source: Element, target: HTMLElement): void {
  const style = getComputedStyle(source);
  const pending = new Set<string>([...PORTAL_THEME_BACKGROUND_VARS, ...PORTAL_THEME_COLOR_VARS]);

  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name && shouldBridgeCustomProperty(name)) pending.add(name);
  }

  const written = new Set<string>();
  while (pending.size > 0) {
    const name = pending.values().next().value as string;
    pending.delete(name);
    if (written.has(name)) continue;

    const value = style.getPropertyValue(name).trim();
    if (!value) continue;

    target.style.setProperty(name, value);
    written.add(name);

    for (const ref of collectCustomPropertyRefs(value)) {
      if (!written.has(ref)) pending.add(ref);
    }
  }
}

/** After the var chain is on `target`, collapse seeds to concrete colors when possible. */
function overwriteSeedsWithResolvedColors(target: HTMLElement): void {
  for (const name of [...PORTAL_THEME_BACKGROUND_VARS, ...PORTAL_THEME_COLOR_VARS]) {
    const resolved = resolveCustomPropertyColor(target, name);
    if (isResolvedCssColor(resolved)) {
      target.style.setProperty(name, resolved);
    }
  }
}

/** Copy cascaded outline/accent tokens from `source` onto `target`. */
export function bridgePortalThemeVars(source: Element, target: HTMLElement): void {
  copyVarChain(source, target);
  overwriteSeedsWithResolvedColors(target);
}

/** Open Select trigger (role=combobox) or DropdownMenu trigger. */
export function findOpenMenuTrigger(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      '.select-trigger[data-state="open"], [role="combobox"][data-state="open"], [aria-haspopup="menu"][data-state="open"]',
    ) ?? null
  );
}

/**
 * Prefer the trigger that owns this portaled surface (`aria-controls` → content id).
 * Falls back to the document-wide open-trigger heuristic.
 */
export function findTriggerForPortaledContent(content: HTMLElement): HTMLElement | null {
  const id = content.id?.trim();
  if (id) {
    const owned = document.querySelector<HTMLElement>(`[aria-controls="${escapeCssIdent(id)}"]`);
    if (owned) return owned;
  }
  return findOpenMenuTrigger();
}

/** Bridge theme vars from the trigger that owns `content` (no-op if none found). */
export function bridgePortalThemeFromOpenTrigger(content: HTMLElement): void {
  const trigger = findTriggerForPortaledContent(content);
  if (trigger) bridgePortalThemeVars(trigger, content);
}

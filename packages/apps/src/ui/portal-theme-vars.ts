/**
 * Portaled Radix surfaces (Select, DropdownMenu) render under `document.body`,
 * so they do not inherit workspace `--button-outline-*` / `--workspace-accent`.
 * Copy cascaded custom properties from the open trigger onto the portaled content
 * so `color-mix(… var(--*-accent) …)` tokens keep resolving.
 */

export const PORTAL_THEME_BACKGROUND_VARS = [
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

function shouldBridgeCustomProperty(name: string): boolean {
  return (
    name.startsWith("--button-") ||
    name.startsWith("--workspace-") ||
    name.startsWith("--color-") ||
    name.includes("accent")
  );
}

/** Copy cascaded outline/accent tokens from `source` onto `target`. */
export function bridgePortalThemeVars(source: Element, target: HTMLElement): void {
  const style = getComputedStyle(source);
  const names = new Set<string>([...PORTAL_THEME_BACKGROUND_VARS, ...PORTAL_THEME_COLOR_VARS]);

  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name && shouldBridgeCustomProperty(name)) names.add(name);
  }

  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) target.style.setProperty(name, value);
  }
}

/** Open Select trigger (role=combobox) or DropdownMenu trigger. */
export function findOpenMenuTrigger(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      '.select-trigger[data-state="open"], [role="combobox"][data-state="open"], [aria-haspopup="menu"][data-state="open"]',
    ) ?? null
  );
}

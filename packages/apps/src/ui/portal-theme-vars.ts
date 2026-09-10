/**
 * Portaled Radix surfaces (Select, DropdownMenu) render under `document.body`,
 * so they do not inherit workspace `--button-outline-*` / `--workspace-accent`.
 * Copy cascaded custom properties from the open trigger onto the portaled content
 * so `color-mix(… var(--*-accent) …)` tokens keep resolving.
 *
 * Workspace sheets publish washes that still reference app accents
 * (`var(--notes-detail-accent)`, `var(--calendar-accent)`, …). Those deps are
 * not reliably enumerable via `getComputedStyle().item()`, so we walk `var(--*)`
 * references from the seed outline/accent tokens.
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

const CUSTOM_PROPERTY_REF = /var\(\s*(--[\w-]+)/g;

function shouldBridgeCustomProperty(name: string): boolean {
  return (
    name.startsWith("--button-") ||
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

/** Copy cascaded outline/accent tokens from `source` onto `target`. */
export function bridgePortalThemeVars(source: Element, target: HTMLElement): void {
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
      // Follow every `var(--*)` so app accents / cream / ink keep resolving.
      if (!written.has(ref)) pending.add(ref);
    }
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

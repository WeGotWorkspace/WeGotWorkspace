/** Format a custom property for clipboard / display: `var(--token)`. */
export function formatCssVarRef(property: string): string {
  const name = property.startsWith("--") ? property : `--${property}`;
  return `var(${name})`;
}

/** Normalize to `--token` form. */
export function toCssVarName(property: string): string {
  return property.startsWith("--") ? property : `--${property}`;
}

/** Read a custom property from an element's cascaded style. */
export function readCssVar(host: Element, property: string): string {
  return getComputedStyle(host).getPropertyValue(toCssVarName(property)).trim();
}

/**
 * Resolve a custom property to a concrete color by painting it on a temporary
 * probe. Works for HTML and SVG hosts (switch-trigger `--wai-*` lives on SVG).
 */
export function resolveCssColor(host: Element, property: string): string {
  const name = toCssVarName(property);
  const cascaded = getComputedStyle(host).getPropertyValue(name).trim();
  const probe = document.createElement("span");
  probe.setAttribute("data-foundations-color-probe", "");
  probe.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  if (cascaded) {
    probe.style.setProperty(name, cascaded);
  }
  probe.style.setProperty("background-color", `var(${name})`);
  const mount = host instanceof HTMLElement ? host : (host.parentElement ?? document.body);
  mount.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor.trim();
  probe.remove();
  return resolved;
}

/**
 * Resolve a length expression (or `var(--token)`) to used pixels via a width probe.
 */
export function resolveLengthPx(host: HTMLElement, cssLength: string): string {
  const probe = document.createElement("div");
  probe.setAttribute("data-foundations-length-probe", "");
  probe.style.cssText =
    "position:absolute;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  probe.style.width = cssLength;
  host.appendChild(probe);
  const px = getComputedStyle(probe).width;
  probe.remove();
  return px;
}

/** Resolve `font-family` when set to `var(--font-…)`. */
export function resolveFontFamily(host: HTMLElement, property: string): string {
  const probe = document.createElement("span");
  probe.setAttribute("data-foundations-font-probe", "");
  probe.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  probe.style.fontFamily = `var(${toCssVarName(property)})`;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).fontFamily;
  probe.remove();
  return resolved;
}

/** Resolve `font-size` when set to `var(--text-…)`. */
export function resolveFontSize(host: HTMLElement, property: string): string {
  const probe = document.createElement("span");
  probe.setAttribute("data-foundations-fontsize-probe", "");
  probe.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  probe.style.fontSize = `var(${toCssVarName(property)})`;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).fontSize;
  probe.remove();
  return resolved;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

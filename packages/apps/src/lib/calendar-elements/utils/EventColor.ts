/**
 * Shared tinted palette for event cards.
 *
 * Values are emitted as CSS `light-dark()` / `color-mix()` expressions rather
 * than precomputed rgb values: the event color is mixed into the surface
 * color (`--_lc-surface-bg`) so cards read as soft tints in both schemes,
 * while the raw color is kept on the accent edge for identity.
 */
export function getEventColorStyles(color: string): Record<string, string> {
  if (!isHexColor(color)) return {};

  // Keep state progression monotonic: base -> hover -> focus gets stronger.
  const backgroundColor = surfaceTint(color, 11);
  const backgroundColorHover = surfaceTint(color, 17);
  const backgroundColorActive = surfaceTint(color, 23);
  const backgroundColorFocus = surfaceTint(color, 23);
  const borderColor = surfaceTint(color, 45);
  const textColor = `light-dark(color-mix(in srgb, ${color} 24%, rgb(15 23 42)), color-mix(in srgb, ${color} 18%, #fff))`;
  const focusRingLightColor = `color-mix(in srgb, ${color} 80%, light-dark(#000, #fff))`;
  const shadowColor = `color-mix(in srgb, ${color} 55%, transparent)`;

  return {
    "--_lc-event-bg": backgroundColor,
    "--_lc-event-border-color": borderColor,
    "--_lc-event-bg-hover": backgroundColorHover,
    "--_lc-event-bg-active": backgroundColorActive,
    "--_lc-event-bg-focus": backgroundColorFocus,
    "--_lc-event-text-color": textColor,
    "--_lc-event-focus-ring-light": focusRingLightColor,
    "--_lc-event-accent-color": color,
    "--_lc-event-shadow": `0 1px 3px 0 ${shadowColor}`,
  };
}

/**
 * Mixes `color` into the surface background. Dark scheme gets a slightly
 * stronger mix so the tint stays visible against a dark surface.
 */
export function surfaceTint(
  color: string,
  lightPercent: number,
  darkPercent = lightPercent + 8,
): string {
  const surface = "var(--_lc-surface-bg, light-dark(#fff, #222))";
  return `light-dark(color-mix(in srgb, ${color} ${lightPercent}%, ${surface}), color-mix(in srgb, ${color} ${darkPercent}%, ${surface}))`;
}

export function isHexColor(color: string | undefined): boolean {
  if (!color) return false;
  return /^#[0-9A-F]{6}$/i.test(color);
}

export function hexToRgb(hex: string | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

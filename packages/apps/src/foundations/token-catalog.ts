/**
 * Token *names* for Foundations sheets. Values are always read at runtime from
 * computed style — never hard-code hex / rem here.
 */

/** We Got brand primitives (`styles.css` `@theme`). */
export const COLOR_WE_GOT_PRIMITIVES = [
  "--color-we-got-soft",
  "--color-we-got-dark",
  "--color-we-got-blue",
  "--color-we-got-red",
  "--color-we-got-prince",
  "--color-we-got-brat",
  "--color-we-got-sky",
  "--color-we-got-pink",
  "--color-we-got-yellow",
  "--color-we-got-sand",
] as const;

/** Suite semantic roles. */
export const COLOR_SEMANTIC = [
  "--color-ink",
  "--color-cream",
  "--color-error",
  "--color-warning",
  "--color-success",
  "--color-info",
] as const;

/**
 * Shared workspace component contract (`workspace-color.css` + switch-trigger
 * `--wai-*`). Resolved under a demo host; per-app accents live in Themes.
 */
export const COLOR_COMPONENT_CONTRACT = [
  "--workspace-accent",
  "--workspace-accent-strong",
  "--workspace-sidebar-mix",
  "--app-sidebar-bg",
  "--app-sidebar-color",
  "--app-sidebar-border-color",
  "--app-sidebar-item-hover-bg",
  "--app-sidebar-item-selected-bg",
  "--app-sidebar-item-selected-hover-bg",
  "--app-sidebar-item-selected-color",
  "--button-primary-bg",
  "--button-primary-fg",
  "--wai-bg",
  "--wai-fg",
  "--wai-detail",
  "--wai-detail-muted",
  "--wai-cutout",
] as const;

/** Brand / system face primitives. */
export const FONT_PRIMITIVES = [
  "--font-we-got-serif",
  "--font-we-got-mono",
  "--font-we-got-mark",
  "--font-system-sans",
] as const;

/** Semantic font roles (utilities: font-sans / font-serif / font-mono / font-mark). */
export const FONT_SEMANTIC = ["--font-sans", "--font-serif", "--font-mono", "--font-mark"] as const;

/** Shared `@utility` type roles from `workspace-type.css`. */
export const TYPE_ROLE_UTILITIES = [
  { className: "text-title", label: "Title", sample: "Workspace title" },
  { className: "text-title-lg", label: "Title large", sample: "Editorial headline" },
  { className: "text-caption", label: "Caption", sample: "Section label" },
  { className: "text-lockup", label: "Lockup", sample: "We Got Workspace" },
] as const;

/**
 * Tailwind text size steps referenced by shared roles (`text-xs` … `text-4xl`).
 * Do not override `--text-xs--line-height`.
 */
export const TEXT_SIZE_STEPS = [
  "--text-xs",
  "--text-sm",
  "--text-base",
  "--text-lg",
  "--text-xl",
  "--text-2xl",
  "--text-3xl",
  "--text-4xl",
] as const;

/** Weight utilities that exist as product chrome tokens (not the full Tailwind ladder). */
export const FONT_WEIGHT_UTILITIES = [
  { className: "font-medium", label: "Medium", token: "--font-weight-medium" },
  { className: "font-semibold", label: "Semibold", token: "--font-weight-semibold" },
] as const;

/**
 * Tailwind spacing multipliers (`width: calc(var(--spacing) * n)`).
 * Unit token is `--spacing` (0.25rem by default).
 */
export const SPACING_SCALE_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44,
  48, 52, 56, 60, 64, 72, 80, 96,
] as const;

/** Control height + padding tokens from `styles.css` `:root`. */
export const CONTROL_SIZE_TOKENS = [
  "--control-height-xs",
  "--control-height-sm",
  "--control-height-md",
  "--control-height-lg",
  "--control-height-xl",
  "--input-height",
  "--input-padding-x",
] as const;

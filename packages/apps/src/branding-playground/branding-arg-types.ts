import type { InputType } from "storybook/internal/types";
import { BRANDING_ICON_PRESET_OPTIONS } from "./branding-cssprops";

/** Controls for SVG slot — shared by every Branding/* story. */
export const brandingIconArgTypes = {
  iconPreset: {
    control: "select",
    options: [...BRANDING_ICON_PRESET_OPTIONS],
    description:
      "Swap switch-trigger / tile artwork: keep current app, pick another app’s inline SVG, or paste custom markup",
    table: { category: "Icon" },
  },
  svgMarkup: {
    control: "text",
    description:
      'Used when iconPreset is "custom". Prefer fill="var(--wai-bg|fg|detail|detail-muted|cutout, fallback)" layers so invert still works.',
    table: { category: "Icon" },
  },
} satisfies Record<string, InputType>;

/** Docs-only: compare full-accent rail vs cream-mix wash. */
export const brandingDocsSidebarArgTypes = {
  fullAccentSidebar: {
    control: "boolean",
    description:
      "When true, Docs sidebar uses full --docs-accent; when false, cream-mix wash like other apps",
    table: { category: "Docs" },
  },
} satisfies Record<string, InputType>;

export const brandingIconArgs = {
  iconPreset: "current" as const,
  svgMarkup: "",
};

export const brandingDocsSidebarArgs = {
  fullAccentSidebar: true,
};

import type { CSSProperties, ReactNode } from "react";
import { notesDetailTintStyle } from "@/notes-core/src/notes-notebook-color";
import "@/notes-core/src/notes-workspace.css";

export type NotesStoryScopeVariant = "pane" | "list-column" | "detail";

/**
 * Storybook Vitest does not emit `@theme` tokens onto `:root` (apps Vite config
 * is disabled). Seed brand hexes and the paper pair on the notes root so
 * product CSS `var(--color-*)` / `var(--workspace-surface)` chains resolve
 * without enabling `@tailwindcss/vite` for the whole catalog.
 * `--workspace-surface` must be the concrete Soft→white mix (same as
 * `BRANDING_WORKSPACE_SURFACE_DEFAULT`): inheriting `:root`'s
 * `var(--color-we-got-soft)` mix stays invalid when `@theme` is missing,
 * which drops sheet and desk washes to transparent.
 */
const NOTES_STORY_BRAND_TOKENS = {
  "--color-we-got-soft": "#eeeeee",
  "--color-we-got-dark": "#222222",
  "--color-we-got-yellow": "#ffc800",
  // Sidebar wash still reads Sand. Storybook Vitest does not emit `@theme` onto `:root`.
  "--color-we-got-sand": "#ba9689",
  "--workspace-surface": "color-mix(in oklch, var(--color-we-got-soft) 40%, #fff)",
  "--workspace-foreground": "var(--color-we-got-dark)",
} as CSSProperties;

function notesStoryStyle(detailTint?: string): CSSProperties {
  return {
    ...NOTES_STORY_BRAND_TOKENS,
    ...(notesDetailTintStyle(detailTint) as CSSProperties | undefined),
  };
}

export function NotesStoryScope({
  children,
  variant = "pane",
  detailTint,
}: {
  children: ReactNode;
  variant?: NotesStoryScopeVariant;
  /** Runtime notebook color for `--notes-detail-tint` (light-washes the paper card). */
  detailTint?: string;
}) {
  if (variant === "list-column") {
    return (
      <div
        className="notes-workspace notes-story-scope notes-story-scope--list-column"
        style={NOTES_STORY_BRAND_TOKENS}
      >
        <div className="h-dvh w-full max-w-md shrink-0 md:w-96">{children}</div>
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div
        className="notes-workspace notes-story-scope notes-story-scope--detail"
        style={notesStoryStyle(detailTint)}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="notes-workspace notes-story-scope" style={NOTES_STORY_BRAND_TOKENS}>
      <div className="mx-auto max-w-2xl p-6 md:p-10">{children}</div>
    </div>
  );
}

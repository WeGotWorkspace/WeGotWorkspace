import { memo } from "react";
import { cn } from "@/lib/utils";
import wordmarkSvg from "@/brand-lockup/src/we-got-workspace-wordmark.svg?raw";
import "@/brand-lockup/src/we-got-workspace-wordmark.css";

/** Accessible name for the suite wordmark (screen readers / aria-label). Matches PWA / document titles. */
export const WE_GOT_WORKSPACE_WORDMARK_LABEL = "WeGotWorkspace";

/** Stable `{ __html }` so parent re-renders do not re-parse the SVG. */
const WORDMARK_HTML = { __html: wordmarkSvg };

export type WeGotWorkspaceWordmarkProps = {
  className?: string;
};

/**
 * Suite wordmark SVG (Bebas text stack retired).
 * Fills use `currentColor` — paint via parent `color` / `--app-switch-label-color`.
 */
export const WeGotWorkspaceWordmark = memo(function WeGotWorkspaceWordmark({
  className,
}: WeGotWorkspaceWordmarkProps) {
  return (
    <span
      aria-hidden
      className={cn("we-got-workspace-wordmark", className)}
      dangerouslySetInnerHTML={WORDMARK_HTML}
    />
  );
});

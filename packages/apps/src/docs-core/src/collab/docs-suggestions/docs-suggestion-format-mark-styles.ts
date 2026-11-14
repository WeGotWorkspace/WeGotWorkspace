import type { CSSProperties } from "react";

/** TipTap mark names from tiptap-track-changes `formatAdded` / `formatRemoved`. */
export const FORMAT_MARK_STYLE_MAP = {
  bold: { className: "docs-collab-highlight__format-mark--bold" },
  italic: { className: "docs-collab-highlight__format-mark--italic" },
  underline: { className: "docs-collab-highlight__format-mark--underline" },
  strike: { className: "docs-collab-highlight__format-mark--strike" },
  code: { className: "docs-collab-highlight__format-mark--code" },
  highlight: { className: "docs-collab-highlight__format-mark--highlight" },
} as const satisfies Record<string, { className: string } | { style: CSSProperties }>;

export type FormatMarkStyleResult = {
  className?: string;
  style?: CSSProperties;
};

/** Map a track-changes format mark name to collab-highlight preview styles. */
export function applyFormatMarkStyles(formatName: string | undefined): FormatMarkStyleResult {
  if (!formatName) return {};
  const mapped = FORMAT_MARK_STYLE_MAP[formatName as keyof typeof FORMAT_MARK_STYLE_MAP];
  return mapped ?? {};
}

export function formatMarkPreviewClassName(
  side: "before" | "after",
  formatName: string | undefined,
): string {
  const { className: markClassName } = applyFormatMarkStyles(formatName);
  return [
    side === "before"
      ? "docs-collab-highlight__format-before"
      : "docs-collab-highlight__format-after",
    markClassName,
  ]
    .filter(Boolean)
    .join(" ");
}

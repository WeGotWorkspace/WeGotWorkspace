export const TEXT_EDITOR_FORMAT_BAR_GROUPS = [
  "history",
  "heading",
  "marksBasic",
  "marksExtra",
  "blocksBasic",
  "blocksExtra",
  "link",
] as const;

export type TextEditorFormatBarGroup = (typeof TEXT_EDITOR_FORMAT_BAR_GROUPS)[number];

/** Control size for every button in the bar (Docs uses `lg`; compact hosts keep `md`). */
export type TextEditorFormatBarSize = "md" | "lg";

export type TextEditorFormatBarConfig = {
  /** Toolbar sections to show. Defaults to all groups. */
  groups?: readonly TextEditorFormatBarGroup[];
  /** Show a print action that calls `window.print()`. */
  showPrint?: boolean;
  size?: TextEditorFormatBarSize;
  className?: string;
};

/** Full toolbar. */
export const TEXT_EDITOR_FORMAT_BAR_FULL: TextEditorFormatBarGroup[] = [
  "history",
  "heading",
  "marksBasic",
  "marksExtra",
  "blocksBasic",
  "blocksExtra",
  "link",
];

export function resolveTextEditorFormatBarConfig(formatBar?: boolean | TextEditorFormatBarConfig): {
  groups: Set<TextEditorFormatBarGroup>;
  showPrint: boolean;
  size: TextEditorFormatBarSize;
  className?: string;
} | null {
  if (formatBar === false) return null;
  const config = typeof formatBar === "object" ? formatBar : {};
  return {
    groups: new Set(config.groups ?? TEXT_EDITOR_FORMAT_BAR_FULL),
    showPrint: config.showPrint ?? true,
    size: config.size ?? "md",
    className: config.className,
  };
}

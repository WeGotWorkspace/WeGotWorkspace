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

export type TextEditorFormatBarConfig = {
  /** Toolbar sections to show. Defaults to all groups. */
  groups?: readonly TextEditorFormatBarGroup[];
  /** Show a print action that calls `window.print()`. */
  showPrint?: boolean;
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

export function resolveTextEditorFormatBarConfig(
  formatBar?: boolean | TextEditorFormatBarConfig,
): { groups: Set<TextEditorFormatBarGroup>; showPrint: boolean; className?: string } | null {
  if (formatBar === false) return null;
  const config = typeof formatBar === "object" ? formatBar : {};
  return {
    groups: new Set(config.groups ?? TEXT_EDITOR_FORMAT_BAR_FULL),
    showPrint: config.showPrint ?? true,
    className: config.className,
  };
}

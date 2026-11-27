import type { Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, MoreVertical } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  DOCS_IMAGE_WIDTH_PRESETS,
  DOCS_IMAGE_ALIGNS,
  isDocsImageWidthPreset,
  normalizeDocsImageAlign,
  normalizeDocsImageWidth,
  type DocsImageAlign,
} from "@/text-editor-core/src/text-editor-image-attrs";
import {
  deleteDocsImageAt,
  setDocsImageLayoutAt,
} from "@/text-editor-core/src/text-editor-image-commands";
import { FormatBarSeparator } from "@/text-editor-core/src/text-editor-format-bar";
import { useActiveDocsImage } from "@/text-editor-core/src/use-active-docs-image";

const ALIGN_ICONS: Record<DocsImageAlign, typeof AlignLeft> = {
  start: AlignLeft,
  center: AlignCenter,
  end: AlignRight,
};
/** Full width first, then the presets down to a quarter (the shared preset list, reversed). */
const WIDTH_OPTIONS = [...DOCS_IMAGE_WIDTH_PRESETS].reverse().map((width) => ({
  width,
  label: width === 100 ? "Full width" : `${width}%`,
}));
/** About the bar's width in px: its end edge never sits closer to the sheet's start than this. */
const BAR_MIN_END = 260;
const ALIGN_LABELS: Record<DocsImageAlign, string> = {
  start: "Align start",
  center: "Align center",
  end: "Align end",
};

const DOCS_IMAGE_BAR_LABELS = {
  bar: "Image",
  align: "Image alignment",
  width: "Image width",
  more: "More image actions",
  replace: "Replace",
  remove: "Remove",
} as const;

export type TextEditorImageBarProps = {
  editor: Editor | null;
  /** Opens the picker to swap the picture at this position. Omitted: no Replace item. */
  onReplaceImage?: (pos: number) => void;
};

/**
 * The format bar, specialised: floats over the focused image with alignment, width presets
 * (a read-only chip shows a width set by dragging) and a ... menu for Replace and Delete.
 */
export function TextEditorImageBar({ editor, onReplaceImage }: TextEditorImageBarProps) {
  const active = useActiveDocsImage(editor);
  if (!editor || !active) return null;

  const { pos, node, rect, viewportTop, liveWidth, rtl } = active;
  const width = liveWidth ?? normalizeDocsImageWidth(node.attrs.width);
  const align = normalizeDocsImageAlign(node.attrs.align) ?? "start";
  const AlignIcon = ALIGN_ICONS[align];
  const custom = width != null && !isDocsImageWidthPreset(width);
  const refocus = () => editor.chain().setNodeSelection(pos).focus().run();
  const setLayout = (attrs: Parameters<typeof setDocsImageLayoutAt>[2]) => {
    setDocsImageLayoutAt(editor, pos, attrs);
    refocus();
  };

  return (
    <div
      role="toolbar"
      aria-label={DOCS_IMAGE_BAR_LABELS.bar}
      // Plain string, not `cn`: tailwind-merge would drop the base class next to the modifier.
      className="text-editor-format-bar text-editor-format-bar--floating floating-toolbar no-print"
      data-size="md"
      data-anchor={rtl ? "start" : "end"}
      data-placement={viewportTop < 110 ? "below" : "above"}
      style={{
        // On the picture's end edge (right in English), not centred over it. A narrow
        // picture near the page edge would push the bar out of the sheet: keep room for it.
        left: rtl ? rect.left : Math.max(rect.left + rect.width, BAR_MIN_END),
        top: viewportTop < 110 ? rect.top + rect.height : rect.top,
      }}
      // Keep the caret / selection where it is: the bar acts on the image, not on focus.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="text-editor-format-bar__controls">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              aria-label={DOCS_IMAGE_BAR_LABELS.align}
              size="md"
              variant="outline"
              className="text-editor-format-bar__heading-trigger"
            >
              <AlignIcon className="size-4 rtl:-scale-x-100" aria-hidden />
              <ChevronDown className="text-editor-format-bar__heading-trigger-chevron" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="text-editor-format-bar__heading-menu">
            {DOCS_IMAGE_ALIGNS.map((option) => {
              const Icon = ALIGN_ICONS[option];
              return (
                <DropdownMenuItem
                  key={option}
                  onClick={() => setLayout({ align: option === "start" ? null : option })}
                  className={cn(
                    "text-editor-format-bar__heading-option",
                    option === align && "text-editor-format-bar__heading-option--selected",
                  )}
                >
                  <Icon className="size-4 rtl:-scale-x-100" aria-hidden />
                  <span className="text-editor-format-bar__heading-option-label">
                    {ALIGN_LABELS[option]}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <FormatBarSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              aria-label={`${DOCS_IMAGE_BAR_LABELS.width}${width == null ? "" : `, ${width}%`}`}
              size="md"
              variant="outline"
              className="text-editor-format-bar__heading-trigger"
            >
              <span className="text-editor-format-bar__heading-trigger-label">
                {width == null ? "Size" : `${width}%`}
              </span>
              <ChevronDown className="text-editor-format-bar__heading-trigger-chevron" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="text-editor-format-bar__heading-menu">
            {WIDTH_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.width}
                onClick={() => setLayout({ width: option.width })}
                className={cn(
                  "text-editor-format-bar__heading-option",
                  option.width === width && "text-editor-format-bar__heading-option--selected",
                )}
              >
                <span className="text-editor-format-bar__heading-option-label">{option.label}</span>
              </DropdownMenuItem>
            ))}
            {custom ? (
              <DropdownMenuItem
                disabled
                className="text-editor-format-bar__heading-option text-editor-format-bar__heading-option--selected"
              >
                <span className="text-editor-format-bar__heading-option-label">
                  Custom ({width}%)
                </span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <FormatBarSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              size="md"
              variant="outline"
              label={DOCS_IMAGE_BAR_LABELS.more}
              icon={<MoreVertical />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onReplaceImage ? (
              <DropdownMenuItem onClick={() => onReplaceImage(pos)}>
                {DOCS_IMAGE_BAR_LABELS.replace}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="menu-item--severity-danger"
              onClick={() => deleteDocsImageAt(editor, pos)}
            >
              {DOCS_IMAGE_BAR_LABELS.remove}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

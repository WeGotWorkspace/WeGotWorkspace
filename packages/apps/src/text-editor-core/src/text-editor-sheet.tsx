import { EditorContent, type Editor } from "@tiptap/react";
import { clsx } from "clsx";
import type { MouseEvent, ReactNode } from "react";
import { focusTextEditorFromChromeEvent } from "@/text-editor-core/src/text-editor-chrome-focus";
import { TextEditorSlashMenu } from "@/text-editor-core/src/text-editor-slash-menu";
import { TextEditorTableControls } from "@/text-editor-core/src/text-editor-table-controls";

export type TextEditorSheetVariant = "sheet" | "inline";

export type TextEditorSheetProps = {
  editor: Editor | null;
  /** `sheet` = letter layout; `inline` = flush body without page chrome (e.g. notes). */
  variant?: TextEditorSheetVariant;
  /** Grow the sheet to fill a flex parent (e.g. mail compose). Shadow and radius stay on the surface. */
  fill?: boolean;
  /** Slash command menu (off for plain `.txt` mode). */
  slashMenu?: boolean;
  /** Absolutely positioned overlays (e.g. margin comment cards). */
  overlay?: ReactNode;
  className?: string;
};

/**
 * Letter-sized sheet with inline ProseMirror editing, slash menu, and table controls.
 */
export function TextEditorSheet({
  editor,
  variant = "sheet",
  fill = false,
  slashMenu = true,
  overlay,
  className,
}: TextEditorSheetProps) {
  // BEM block/modifiers must NOT pass through `cn` (tailwind-merge): it treats
  // the shared `text-` prefix as one utility group and keeps only the last
  // `text-editor-sheet*` class, silently dropping the base + co-modifiers (e.g.
  // `--fill` next to `--paginated`). `clsx` preserves every class as authored.
  const onChromeMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    focusTextEditorFromChromeEvent(event, editor);
  };

  return (
    <div
      className={clsx(
        "text-editor-sheet",
        variant === "inline" && "text-editor-sheet--inline",
        fill && variant === "sheet" && "text-editor-sheet--fill",
        className,
      )}
      onMouseDown={onChromeMouseDown}
    >
      <EditorContent
        editor={editor}
        className={variant === "sheet" ? "text-editor-sheet__surface" : undefined}
      />
      {overlay}
      {slashMenu ? <TextEditorSlashMenu editor={editor} /> : null}
      <TextEditorTableControls editor={editor} />
    </div>
  );
}

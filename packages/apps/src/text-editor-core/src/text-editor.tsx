import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";
import {
  TextEditorFormatBar,
  type TextEditorFormatBarConfig,
  resolveTextEditorFormatBarConfig,
} from "@/text-editor-core/src/text-editor-format-bar";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import type { TextEditorSheetVariant } from "@/text-editor-core/src/text-editor-sheet";
import { TextEditorSource } from "@/text-editor-core/src/text-editor-source";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { useTextEditorSourceSync } from "@/text-editor-core/src/use-text-editor-source-sync";

import "@/text-editor-core/src/text-editor.css";

export type TextEditorProps = {
  /** Document serialization: HTML (e.g. mail), Markdown (e.g. notes), or plain text (e.g. `.txt`). */
  format?: TextEditorContentFormat;
  /** Initial content in the configured `format`. */
  content?: string;
  editable?: boolean;
  placeholder?: string;
  /** `false` hides the bar; pass `groups` to show a subset. */
  formatBar?: boolean | TextEditorFormatBarConfig;
  /** @deprecated Use `formatBar={{ showPrint: false }}` instead. */
  showPrint?: boolean;
  sheetVariant?: TextEditorSheetVariant;
  /** Grow the letter sheet to fill a flex parent (e.g. mail compose). */
  sheetFill?: boolean;
  /**
   * When true, shows a source editor. Wide landscape viewports use a split
   * (rich text + source); narrow or portrait viewports show source only.
   * Toggle externally — no built-in control.
   */
  viewSource?: boolean;
  className?: string;
  /** Opens the Docs image picker from the format bar / slash menu. */
  onInsertImage?: () => void;
  onUpdate?: (payload: { editor: Editor; content: string }) => void;
  /** Called when the TipTap instance is created or destroyed (e.g. document outline). */
  onEditorReady?: (editor: Editor | null) => void;
};

/**
 * Rich text editor: formatting toolbar plus letter sheet with slash commands and table controls.
 */
export function TextEditor({
  format = "html",
  content,
  editable = true,
  placeholder,
  formatBar = true,
  showPrint,
  sheetVariant = "sheet",
  sheetFill = false,
  viewSource = false,
  className,
  onInsertImage,
  onUpdate,
  onEditorReady,
}: TextEditorProps) {
  const editor = useTextEditor({
    format,
    content: content ?? textEditorDemoContent(format),
    editable,
    placeholder,
    onUpdate,
  });

  const { sourceValue, onSourceChange, onSourceFocus, onSourceBlur } = useTextEditorSourceSync({
    editor,
    format,
    viewSource,
    onUpdate,
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  const formatBarConfig = (() => {
    if (formatBar === false) return null;
    if (format === "text" && formatBar === true) return null;
    const config: TextEditorFormatBarConfig = typeof formatBar === "object" ? { ...formatBar } : {};
    if (showPrint !== undefined) config.showPrint = showPrint;
    return resolveTextEditorFormatBarConfig(config);
  })();

  const formatLabel = format === "markdown" ? "Markdown" : format === "text" ? "Text" : "HTML";

  const formatBarElement = formatBarConfig ? (
    <TextEditorFormatBar
      editor={editor}
      groups={[...formatBarConfig.groups]}
      showPrint={formatBarConfig.showPrint}
      className={formatBarConfig.className}
      onInsertImage={onInsertImage}
    />
  ) : null;

  const sheetElement = (
    <TextEditorSheet
      editor={editor}
      variant={sheetVariant}
      fill={sheetFill}
      slashMenu={format !== "text"}
      onInsertImage={onInsertImage}
      className="min-h-0 flex-1"
    />
  );

  return (
    <div
      className={cn(
        "text-editor flex w-full flex-col",
        sheetFill ? "h-full min-h-0 flex-1" : "h-full w-full",
        viewSource && "text-editor--view-source",
        className,
      )}
    >
      {viewSource ? (
        <div className="text-editor__body min-h-0 flex-1">
          <TextEditorSource
            value={sourceValue}
            onChange={onSourceChange}
            onFocus={onSourceFocus}
            onBlur={onSourceBlur}
            editable={editable}
            formatLabel={formatLabel}
            className="text-editor__source min-h-0"
          />
          <div className="text-editor__formatted flex min-h-0 flex-1 flex-col">
            {formatBarElement}
            {sheetElement}
          </div>
        </div>
      ) : (
        <>
          {formatBarElement}
          {sheetElement}
        </>
      )}
    </div>
  );
}

export type { Editor };

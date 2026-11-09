import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";
import {
  TextEditorFormatBar,
  type TextEditorFormatBarConfig,
  resolveTextEditorFormatBarConfig,
} from "@/text-editor-core/src/text-editor-format-bar";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import type { TextEditorSheetVariant } from "@/text-editor-core/src/text-editor-sheet";
import { TextEditorFrame } from "@/text-editor-core/src/text-editor-frame";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { useTextEditorSourceSync } from "@/text-editor-core/src/use-text-editor-source-sync";
import type { TextEditorPageSetup } from "@/lib/page-format";
import {
  useTextEditorPageSetup,
  textEditorPaginated,
} from "@/text-editor-core/src/use-text-editor-page-setup";

import "@/text-editor-core/src/text-editor.css";

export type TextEditorProps = {
  /** Document serialization: HTML (e.g. mail), Markdown (e.g. notes), or plain text (e.g. `.txt`). */
  format?: TextEditorContentFormat;
  /** Initial content in the configured `format`. */
  content?: string;
  editable?: boolean;
  placeholder?: string;
  /** Accessible name of the editable textbox. Falls back to `placeholder`. */
  ariaLabel?: string;
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
  /** Docs only: the person's page setup. Turns on pages and the Page break slash item. */
  pageSetup?: TextEditorPageSetup;
};

/**
 * Rich text editor: formatting toolbar plus letter sheet with slash commands and table controls.
 */
export function TextEditor({
  format = "html",
  content,
  editable = true,
  placeholder,
  ariaLabel,
  formatBar = true,
  showPrint,
  sheetVariant = "sheet",
  sheetFill = false,
  viewSource = false,
  className,
  onInsertImage,
  onUpdate,
  onEditorReady,
  pageSetup,
}: TextEditorProps) {
  const paginated = textEditorPaginated(pageSetup, viewSource);
  const editor = useTextEditor({
    format,
    content: content ?? textEditorDemoContent(format),
    editable,
    placeholder,
    ariaLabel,
    onUpdate,
    pagination: pageSetup ? { setup: pageSetup, enabled: paginated } : undefined,
  });
  useTextEditorPageSetup(editor, pageSetup, paginated);

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

  const formatBarElement = formatBarConfig ? (
    <TextEditorFormatBar
      editor={editor}
      groups={[...formatBarConfig.groups]}
      showPrint={formatBarConfig.showPrint}
      size={formatBarConfig.size}
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
      pageBreak={pageSetup != null}
      paginated={paginated}
      className="min-h-0 flex-1"
    />
  );

  return (
    <TextEditorFrame
      format={format}
      pageSetup={pageSetup}
      sheetFill={sheetFill}
      viewSource={viewSource}
      source={{
        value: sourceValue,
        onChange: onSourceChange,
        onFocus: onSourceFocus,
        onBlur: onSourceBlur,
        editable,
      }}
      formatBar={formatBarElement}
      sheet={sheetElement}
      className={className}
    />
  );
}

export type { Editor };

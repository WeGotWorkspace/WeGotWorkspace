import { useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import {
  getTextEditorContent,
  initialTextEditorContent,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import {
  createTextEditorExtensions,
  type CreateTextEditorExtensionsOptions,
} from "@/text-editor-core/src/text-editor-extensions";
import { textEditorRootAttributes } from "@/text-editor-core/src/text-editor-root-attributes";

export type UseTextEditorOptions = {
  content?: string;
  format?: TextEditorContentFormat;
  editable?: boolean;
  placeholder?: string;
  /** Accessible name of the editable textbox. Falls back to `placeholder`. */
  ariaLabel?: string;
  fetchImageContent?: CreateTextEditorExtensionsOptions["fetchImageContent"];
  onUpdate?: (payload: { editor: Editor; content: string }) => void;
} & Pick<UseEditorOptions, "autofocus" | "editorProps">;

export function useTextEditor(options: UseTextEditorOptions = {}) {
  const {
    content = "",
    format = "html",
    editable = true,
    placeholder,
    ariaLabel,
    fetchImageContent,
    onUpdate,
    autofocus,
    editorProps,
  } = options;

  const extensionOptions: CreateTextEditorExtensionsOptions = {
    placeholder,
    format,
    fetchImageContent,
  };

  const editor = useEditor(
    {
      extensions: createTextEditorExtensions(extensionOptions),
      content: initialTextEditorContent(content, format),
      editable,
      autofocus,
      editorProps: {
        attributes: textEditorRootAttributes({ editable, ariaLabel: ariaLabel ?? placeholder }),
        ...editorProps,
      },
      immediatelyRender: false,
      onUpdate: onUpdate
        ? ({ editor }) =>
            onUpdate({
              editor,
              content: getTextEditorContent(editor, format),
            })
        : undefined,
    },
    [format, editable, placeholder, ariaLabel],
  );

  return editor;
}

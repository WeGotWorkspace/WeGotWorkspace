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
  /** Docs only: on-screen pages at mount (see `useTextEditorPageSetup` for changes). */
  pagination?: CreateTextEditorExtensionsOptions["pagination"];
  extraExtensions?: CreateTextEditorExtensionsOptions["extraExtensions"];
  /** Restrict the schema (comment and chat composers); see `TextEditorFeature`. */
  allow?: CreateTextEditorExtensionsOptions["allow"];
  links?: CreateTextEditorExtensionsOptions["links"];
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
    pagination,
    extraExtensions,
    allow,
    links,
    onUpdate,
    autofocus,
    editorProps,
  } = options;

  const extensionOptions: CreateTextEditorExtensionsOptions = {
    placeholder,
    format,
    fetchImageContent,
    pagination,
    extraExtensions,
    allow,
    links,
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
    [
      format,
      editable,
      placeholder,
      ariaLabel,
      pagination != null,
      allow?.join(","),
      links?.openOnClick,
      links?.linkify,
    ],
  );

  return editor;
}

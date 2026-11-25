import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import {
  useSelectionBarPosition,
  type TextEditorFloatingBarPosition,
} from "@/text-editor-core/src/use-selection-bar-position";

export type TextEditorSelectionBarProps = {
  editor: Editor | null;
  /** The bar to float; it is handed the position over the selection. */
  render: (floating: TextEditorFloatingBarPosition) => ReactNode;
};

/** Floats a format bar over the selected text; renders nothing while there is no selection. */
export function TextEditorSelectionBar({ editor, render }: TextEditorSelectionBarProps) {
  const position = useSelectionBarPosition(editor);
  return position ? render(position) : null;
}

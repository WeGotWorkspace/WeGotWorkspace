import { Editor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  getTextEditorContent,
  setTextEditorContent,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { DocsCollabEditor } from "./docs-collab-editor";
import { seedClientId } from "./docs-collab-seed";

const SEED_ORIGIN = "seed";

export type DocsCollabEditorSurfaceProps = {
  ydoc: Y.Doc;
  awareness: Awareness;
  user: { name: string; color: string };
  onMarkdownChange: (getMarkdown: () => string) => void;
};

/** @deprecated Use DocsCollabEditor — kept for thin embeds */
export function DocsCollabEditorSurface(props: DocsCollabEditorSurfaceProps) {
  return <DocsCollabEditor {...props} sheetFill formatBar={false} className="min-h-[70vh]" />;
}

/** Seed helper (yjs-demos#16) — used before mounting the collab editor surface */
export function applyContentSeedToYDoc(
  target: Y.Doc,
  content: string,
  format: TextEditorContentFormat = "markdown",
): void {
  const temp = new Y.Doc();
  // Identical content must yield identical items, or two clients that both
  // bootstrap an unsidecarred document keep each other's copy (#1089).
  temp.clientID = seedClientId(format, content);
  const tempEditor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false, underline: false }),
      Collaboration.configure({ document: temp }),
      ...createTextEditorExtensions({ format }).filter((ext) => ext.name !== "starterKit"),
    ],
    editorProps: {
      attributes: { class: "text-editor-prose focus:outline-none" },
    },
  });
  setTextEditorContent(tempEditor, content, format);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(temp), SEED_ORIGIN);
  tempEditor.destroy();
}

function createCollabContentEditor(ydoc: Y.Doc, format: TextEditorContentFormat): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false, underline: false }),
      Collaboration.configure({ document: ydoc }),
      ...createTextEditorExtensions({ format }).filter((ext) => ext.name !== "starterKit"),
    ],
    editorProps: {
      attributes: { class: "text-editor-prose focus:outline-none" },
    },
  });
}

/** Serialize a collab Y.Doc to markdown or plain text (inverse of applyContentSeedToYDoc). */
export function readContentFromYDoc(
  source: Y.Doc,
  format: TextEditorContentFormat = "markdown",
): string {
  const editor = createCollabContentEditor(source, format);
  const content = getTextEditorContent(editor, format);
  editor.destroy();
  return content;
}

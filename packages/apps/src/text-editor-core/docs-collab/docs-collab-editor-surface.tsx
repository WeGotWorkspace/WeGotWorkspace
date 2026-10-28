import { Editor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  setTextEditorContent,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { DocsTrackChangesExtension } from "@/text-editor-core/src/text-editor-track-changes-marks";
import { DocsCollabEditor } from "./docs-collab-editor";
import { seedClientId } from "./docs-collab-seed";

const SEED_ORIGIN = "seed";

export type DocsCollabEditorSurfaceProps = {
  ydoc: Y.Doc;
  awareness: Awareness;
  user: { name: string; color: string };
  trackChangesUserKey: string;
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
  seedBase?: string,
): void {
  const temp = new Y.Doc();
  // Identical content must yield identical items, or two clients that both
  // bootstrap an unsidecarred document keep each other's copy (#1089).
  temp.clientID = seedClientId(format, content, seedBase);
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

/**
 * A helper editor with the live editor's schema, suggestion marks included:
 * text y-prosemirror cannot rebuild in the schema is deleted from the bound doc.
 * Same suggestion marks as the live editor ({@link DocsTrackChangesExtension}),
 * so a save never writes author names or session colours (#1610).
 */
function createCollabContentEditor(ydoc: Y.Doc, format: TextEditorContentFormat): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false, underline: false }),
      Collaboration.configure({ document: ydoc }),
      ...createTextEditorExtensions({ format }).filter((ext) => ext.name !== "starterKit"),
      DocsTrackChangesExtension,
    ],
    editorProps: {
      attributes: { class: "text-editor-prose focus:outline-none" },
    },
  });
}

/**
 * Serialize a collab Y.Doc to markdown or plain text (inverse of applyContentSeedToYDoc).
 * Reads a copy: callers pass the live doc, and a read must never write to it (#1697).
 */
export function readContentFromYDoc(
  source: Y.Doc,
  format: TextEditorContentFormat = "markdown",
): string {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  const editor = createCollabContentEditor(copy, format);
  try {
    // Same as the live editor's save: pending suggestions stay out of the file.
    return getAcceptedTextEditorContent(editor, format);
  } finally {
    editor.destroy();
    copy.destroy();
  }
}

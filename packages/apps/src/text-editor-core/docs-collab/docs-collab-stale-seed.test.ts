/** @vitest-environment jsdom */
import Collaboration from "@tiptap/extension-collaboration";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { adoptServerSnapshot } from "./docs-collab-bootstrap";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";

const SERVER_MARKDOWN = "# Plan\n\nFirst paragraph.\n\n- one\n- two\n\nLast paragraph.\n";

function seeded(markdown: string): Y.Doc {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, markdown, "markdown");
  return ydoc;
}

function copyOf(source: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  return copy;
}

/** Edits `ydoc` through a bound editor, as typing in a tab does. */
function editInEditor(ydoc: Y.Doc, edit: (editor: Editor) => void): void {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false, underline: false }),
      Collaboration.configure({ document: ydoc }),
      ...createTextEditorExtensions({ format: "markdown" }).filter(
        (ext) => ext.name !== "starterKit",
      ),
    ],
  });
  edit(editor);
  editor.destroy();
}

function adoptOnJoin(local: Y.Doc, server: Y.Doc, loaded: Map<number, number>): boolean {
  return adoptServerSnapshot(local, Y.encodeStateAsUpdate(server), "server", loaded, {
    keepUnsavedEdits: true,
  });
}

function stateVector(ydoc: Y.Doc): Map<number, number> {
  return Y.decodeStateVector(Y.encodeStateVector(ydoc));
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("adoptServerSnapshot with real editor content", () => {
  it("keeps everything another tab typed in the editor before its save (#1722)", () => {
    const server = seeded(SERVER_MARKDOWN);
    const otherTab = copyOf(server);
    editInEditor(otherTab, (editor) => {
      const end = editor.state.doc.content.size - 1;
      editor.chain().insertContentAt(end, " Typed at the end.").run();
      editor.chain().insertContentAt(1, "Typed at the start ").run();
      editor.chain().focus("end").splitBlock().insertContent("A new paragraph.").run();
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, "<p><b>Bold</b> line</p>")
        .run();
    });
    const local = copyOf(otherTab);

    const dropped = adoptOnJoin(local, server, stateVector(local));

    const text = readContentFromYDoc(local);
    expect(text).toContain("Typed at the start Plan");
    expect(text).toContain("Last paragraph. Typed at the end.");
    expect(text).toContain("A new paragraph.");
    expect(text).toContain("**Bold** line");
    expect(text).toBe(readContentFromYDoc(otherTab));
    expect(dropped).toBe(false);
  });

  it("keeps a sentence the server holds only part of", () => {
    const base = seeded(SERVER_MARKDOWN);
    const otherTab = copyOf(base);
    editInEditor(otherTab, (editor) => {
      editor.chain().focus("end").insertContent(" Half a").run();
    });
    // The save that went out held only the first half of the sentence.
    const server = copyOf(otherTab);
    editInEditor(otherTab, (editor) => {
      editor.chain().focus("end").insertContent(" sentence.").run();
    });
    const local = copyOf(otherTab);

    adoptOnJoin(local, server, stateVector(local));

    expect(readContentFromYDoc(local)).toContain("Last paragraph. Half a sentence.");
  });

  it("drops a stale seed of older text and keeps the server's edits, once", () => {
    const local = seeded("# Plan\n\nOlder text.\n");
    const server = seeded(SERVER_MARKDOWN);
    editInEditor(server, (editor) => {
      editor.chain().focus("end").insertContent(" Edited on the server.").run();
    });

    const dropped = adoptOnJoin(local, server, stateVector(local));

    const text = readContentFromYDoc(local);
    expect(text).not.toContain("Older text.");
    expect(occurrences(text, "# Plan")).toBe(1);
    expect(text).toContain("Last paragraph. Edited on the server.");
    expect(dropped).toBe(true);
  });

  it("drops a stale seed that a later merge put next to the server state", () => {
    const local = seeded("# Plan\n\nOlder text.\n");
    const server = seeded(SERVER_MARKDOWN);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server));

    adoptOnJoin(local, server, stateVector(local));

    const text = readContentFromYDoc(local);
    expect(text).not.toContain("Older text.");
    expect(occurrences(text, "# Plan")).toBe(1);
    expect(text).toContain("First paragraph.");
  });
});

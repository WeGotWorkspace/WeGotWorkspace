/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { readContentFromYDoc } from "./docs-collab-editor-surface";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/**
 * A collab doc written by the live editor: "Hello old new world", where "old"
 * is a suggested deletion and "new" a suggested insertion, then a plain line.
 */
function docWithSuggestion(): Y.Doc {
  const doc = new Y.Doc();
  const editor = new Editor({
    extensions: createCollaborativeTextEditorExtensions({
      document: doc,
      awareness: new Awareness(doc),
      user: { name: "Ada", color: "#2563eb" },
    }),
  });
  editors.push(editor);
  editor.commands.insertContent("<p>Hello old new world</p><p>Second line</p>");
  const text = editor.state.doc.firstChild!.textContent;
  const at = (word: string) => 1 + text.indexOf(word);
  const change = { changeId: "ch_1", authorId: "tc_1", authorName: "Ada", authorColor: "#2563eb" };
  editor
    .chain()
    .setTextSelection({ from: at("old"), to: at("old") + 3 })
    .setMark("deletion", change)
    .setTextSelection({ from: at("new"), to: at("new") + 3 })
    .setMark("insertion", change)
    .run();
  return doc;
}

function firstParagraphText(doc: Y.Doc): string {
  const paragraph = doc.getXmlFragment("default").get(0) as Y.XmlElement;
  return paragraph
    .toArray()
    .flatMap((child) => (child instanceof Y.XmlText ? child.toDelta() : []))
    .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

describe("readContentFromYDoc", () => {
  it("leaves the source document unchanged when a paragraph holds a suggestion", async () => {
    const doc = docWithSuggestion();
    const before = Y.encodeStateAsUpdate(doc);
    let updates = 0;
    doc.on("update", () => updates++);

    readContentFromYDoc(doc, "markdown");
    // y-prosemirror can render after the call returns.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(firstParagraphText(doc)).toBe("Hello old new world");
  });

  it("serializes the accepted text, without suggestion markup", () => {
    const markdown = readContentFromYDoc(docWithSuggestion(), "markdown");

    expect(markdown).not.toContain("<ins");
    expect(markdown).not.toContain("<del");
    expect(markdown).toBe("Hello old  world\n\nSecond line");
  });

  it("leaves out a suggested insertion at the end of the last paragraph", () => {
    const doc = new Y.Doc();
    const editor = new Editor({
      extensions: createCollaborativeTextEditorExtensions({
        document: doc,
        awareness: new Awareness(doc),
        user: { name: "Ada", color: "#2563eb" },
      }),
    });
    editors.push(editor);
    editor.commands.insertContent("<p>Hello world. New sentence.</p>");
    const end = editor.state.doc.firstChild!.content.size + 1;
    const change = {
      changeId: "ch_2",
      authorId: "tc_1",
      authorName: "Ada",
      authorColor: "#2563eb",
    };
    editor
      .chain()
      .setTextSelection({ from: end - " New sentence.".length, to: end })
      .setMark("insertion", change)
      .run();

    const markdown = readContentFromYDoc(doc, "markdown");

    expect(markdown).toBe("Hello world.");
    expect(markdown).not.toContain("New sentence");
  });
});

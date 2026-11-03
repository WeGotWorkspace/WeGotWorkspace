/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { TrackChangesExtension } from "tiptap-track-changes";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import {
  createCollaborativeTextEditorExtensions,
  createTextEditorExtensions,
} from "@/text-editor-core/src/text-editor-extensions";
import {
  getAcceptedTextEditorContent,
  getTrackChangesPendingCount,
} from "@/text-editor-core/src/text-editor-track-changes";
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
      trackChangesUserKey: "ada:docs/plan.md",
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
        trackChangesUserKey: "ada:docs/plan.md",
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

const PERSON = "Jamie Example";
const SESSION_COLOUR = "#db2777";
const AUTHOR_LEAKS = [
  /data-author/,
  /author-color/,
  /style=/,
  /data-tracked/,
  /Jamie Example/,
  /#db2777/,
];

function expectNoAuthor(serialized: string) {
  for (const leak of AUTHOR_LEAKS) expect(serialized).not.toMatch(leak);
}

function suggestEnter(editor: Editor) {
  const view = editor.view;
  const event = new KeyboardEvent("keydown", { key: "Enter" });
  const handled = view.someProp("handleKeyDown", (handler) =>
    (handler as (v: typeof view, e: KeyboardEvent) => boolean)(view, event),
  );
  expect(handled).toBe(true);
}

function suggestType(editor: Editor, text: string) {
  const view = editor.view;
  const { from, to } = view.state.selection;
  const handled = view.someProp("handleTextInput", (handler) =>
    (handler as (v: typeof view, f: number, t: number, s: string) => boolean)(view, from, to, text),
  );
  expect(handled).toBe(true);
}

function suggestReplace(editor: Editor, from: number, to: number, text: string) {
  editor.commands.setSuggestMode();
  editor.commands.setTextSelection({ from, to });
  const view = editor.view;
  const handled = view.someProp("handleTextInput", (handler) =>
    (handler as (v: typeof view, f: number, t: number, s: string) => boolean)(view, from, to, text),
  );
  expect(handled).toBe(true);
}

describe("readContentFromYDoc with suggestions (#1610)", () => {
  /** The live editor as the Docs workspace builds it, typing in Suggest mode. */
  function liveDocWithSuggestions() {
    const doc = new Y.Doc();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createCollaborativeTextEditorExtensions({
        document: doc,
        awareness: new Awareness(doc),
        user: { name: PERSON, color: SESSION_COLOUR },
        trackChangesUserKey: "jamie:docs/plan.md",
        format: "markdown",
      }),
    });
    editors.push(editor);
    editor.commands.setContent("<p>Hello old world</p><p>Second line</p>");
    // Replace "old" with "new" (one change id on the <del>/<ins> pair).
    suggestReplace(editor, 7, 10, "new");
    // Suggest bold on "world", then a new paragraph after the first one.
    const firstEnd = editor.state.doc.firstChild!.nodeSize - 1;
    editor.commands.setTextSelection({ from: firstEnd - 5, to: firstEnd });
    editor.commands.toggleBold();
    editor.commands.setTextSelection(firstEnd);
    suggestEnter(editor);
    suggestType(editor, "Added line");
    return { doc, editor };
  }

  it("saves only the accepted text: no author, colour or suggestion markup", () => {
    const { doc, editor } = liveDocWithSuggestions();
    expect(getTrackChangesPendingCount(editor)).toBeGreaterThan(0);

    for (const format of ["markdown", "html"] as const) {
      const saved = readContentFromYDoc(doc, format);
      expectNoAuthor(saved);
      expect(saved).not.toMatch(/<ins|<del|data-change-id|data-format-change/);
      expect(saved).toBe(getAcceptedTextEditorContent(editor, format));
    }
    expect(readContentFromYDoc(doc, "markdown")).toBe("Hello old world\n\nSecond line");
  });

  it("keeps the suggestion and its paragraph in the live document (#1697)", async () => {
    const { doc, editor } = liveDocWithSuggestions();
    const before = Y.encodeStateAsUpdate(doc);
    let updates = 0;
    doc.on("update", () => updates++);

    readContentFromYDoc(doc, "markdown");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(editor.getText()).toContain("Hello oldnew world");
    expect(editor.getText()).toContain("Added line");
    // The live state itself carries only the change id, never the person.
    const fragment = doc.getXmlFragment("default");
    const state = JSON.stringify(fragment.toJSON());
    expect(state).toContain("changeId");
    expectNoAuthor(state);
    const tracked = fragment
      .toArray()
      .map((node) => (node instanceof Y.XmlElement ? node.getAttribute("dataTracked") : undefined))
      .find(Boolean) as unknown as Record<string, unknown> | undefined;
    expect(tracked?.originalType).toBe("paragraphInserted");
    expect(tracked?.authorName || "").toBe("");
    expect(tracked?.authorColor || "").toBe("");
  });

  it("drops the name from a document written by the library marks", () => {
    const doc = new Y.Doc();
    const legacy = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false, link: false, underline: false }),
        Collaboration.configure({ document: doc }),
        ...createTextEditorExtensions({ format: "markdown" }).filter(
          (ext) => ext.name !== "starterKit",
        ),
        TrackChangesExtension.configure({
          author: { id: "tc_96a42209", name: PERSON, color: SESSION_COLOUR },
        }),
      ],
    });
    editors.push(legacy);
    legacy.commands.setContent("<p>Hello old world</p>");
    suggestReplace(legacy, 7, 10, "new");
    expect(JSON.stringify(doc.getXmlFragment("default").toJSON())).toContain(PERSON);

    const saved = readContentFromYDoc(doc, "markdown");
    expectNoAuthor(saved);
    expect(saved).toBe("Hello old world");
  });
});

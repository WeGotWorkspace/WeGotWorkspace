/** @vitest-environment jsdom */
import Collaboration from "@tiptap/extension-collaboration";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { TrackChangesExtension, getTrackedChanges } from "tiptap-track-changes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { getTextEditorContent, setTextEditorContent } from "./text-editor-content";
import {
  createCollaborativeTextEditorExtensions,
  createTextEditorExtensions,
} from "./text-editor-extensions";
import { getSessionTrackChangeIds } from "./text-editor-track-changes";
import { withoutNodeTrackingAuthor } from "./text-editor-track-changes-marks";

const PERSON = "Alex Chrome";
const SESSION_COLOUR = "#db2777";
const AUTHOR_LEAKS = [
  /data-author-id/,
  /data-author-name/,
  /author-color/,
  /style=/,
  /Alex Chrome/,
];

const editors: Editor[] = [];

beforeEach(() => {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function track(editor: Editor): Editor {
  editors.push(editor);
  return editor;
}

function createDocsEditor(ydoc: Y.Doc, seed: string | null = "Hello old world") {
  if (seed != null) applyContentSeedToYDoc(ydoc, seed, "markdown");
  const element = document.createElement("div");
  document.body.appendChild(element);
  return track(
    new Editor({
      element,
      extensions: createCollaborativeTextEditorExtensions({
        document: ydoc,
        awareness: new Awareness(ydoc),
        trackChangesUserKey: crypto.randomUUID(),
        user: { name: PERSON, color: SESSION_COLOUR },
        format: "markdown",
      }),
    }),
  );
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

function suggestBold(editor: Editor, from: number, to: number) {
  editor.commands.setSuggestMode();
  editor.commands.setTextSelection({ from, to });
  editor.commands.toggleBold();
}

function expectNoAuthor(serialized: string) {
  for (const leak of AUTHOR_LEAKS) expect(serialized).not.toMatch(leak);
}

function changeIdsOf(editor: Editor, type: string): string[] {
  return getTrackedChanges(editor)
    .filter((change) => change.type === type)
    .map((change) => change.changeId);
}

/** "Hello old world" → replace "old" with "new", then suggest bold on "world". */
function makeInsertionDeletionAndFormatChange(editor: Editor) {
  suggestReplace(editor, 7, 10, "new");
  const size = editor.state.doc.content.size;
  suggestBold(editor, size - 6, size - 1);
}

describe("Docs suggestion marks", () => {
  it("saves an insertion, a deletion and a format change with only the change id", () => {
    const ydoc = new Y.Doc();
    const editor = createDocsEditor(ydoc);
    makeInsertionDeletionAndFormatChange(editor);

    const [replaceId] = changeIdsOf(editor, "insertion");
    expect(replaceId).toBeTruthy();
    expect(changeIdsOf(editor, "deletion")).toEqual([replaceId]);
    expect(changeIdsOf(editor, "formatChange")).toHaveLength(1);

    const markdown = getTextEditorContent(editor, "markdown");
    expectNoAuthor(markdown);
    expect(markdown).toContain(
      `<del data-change-id="${replaceId}">old</del><ins data-change-id="${replaceId}">new</ins>`,
    );
    expect(markdown).toMatch(/<span data-format-change="true" data-change-id="ch_[^"]+"/);

    expectNoAuthor(editor.getHTML());
    expectNoAuthor(editor.view.dom.innerHTML);
  });

  it("keeps the person and the session colour out of the collab state", () => {
    const ydoc = new Y.Doc();
    const editor = createDocsEditor(ydoc);
    makeInsertionDeletionAndFormatChange(editor);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.enter();

    const state = JSON.stringify(ydoc.getXmlFragment("default").toJSON());
    expect(state).toContain("changeId");
    expect(state).not.toContain(PERSON);
    expect(state).not.toContain(SESSION_COLOUR);
    expect(state).not.toContain("authorName");
    expect(state).not.toContain("authorColor");
    expectNoAuthor(new TextDecoder().decode(Y.encodeStateAsUpdate(ydoc)));
  });

  it("gives each editor session its own opaque author id", () => {
    const first = createDocsEditor(new Y.Doc(), "Hello old world");
    const second = createDocsEditor(new Y.Doc(), "Hello old world");
    const firstId = first.storage.trackChanges.author.id;
    expect(firstId).toMatch(/^tc_[0-9a-f]{16}$/);
    expect(firstId).not.toBe(second.storage.trackChanges.author.id);
    expect(first.storage.trackChanges.author.name).toBe("");

    suggestReplace(first, 7, 10, "new");
    expect(getSessionTrackChangeIds(first)).toEqual(changeIdsOf(first, "insertion"));
  });

  it("only reports this session's change ids, not a peer's", () => {
    const ydoc = new Y.Doc();
    const mine = createDocsEditor(ydoc);
    const peer = createDocsEditor(ydoc, null);

    suggestReplace(peer, 7, 10, "new");
    expect(getSessionTrackChangeIds(mine)).toEqual([]);
    expect(getSessionTrackChangeIds(peer)).toHaveLength(1);
  });
});

const OLD_BODY =
  'Hello <del data-change-id="ch_1792507065581_1_jjwaa9" data-author-id="tc_96a42209" ' +
  'data-author-name="Alex Chrome" style="--author-color: #db2777;">old</del>' +
  '<ins data-change-id="ch_1792507065581_1_jjwaa9" data-author-id="tc_96a42209" ' +
  'data-author-name="Alex Chrome" style="--author-color: #db2777;">new</ins> ' +
  '<span data-format-change="true" data-change-id="ch_1792507065999_2_abcdef" ' +
  'data-author-id="tc_96a42209" data-format-added="bold" title="Added: bold" ' +
  'style="border-bottom: 2px dotted #db2777;"><strong>world</strong></span>';

describe("reading a Doc that still has the old attributes", () => {
  function openOldBody() {
    const editor = createDocsEditor(new Y.Doc(), null);
    setTextEditorContent(editor, OLD_BODY, "markdown");
    return editor;
  }

  it("renders its suggestions and round-trips without adding the attributes back", () => {
    const editor = openOldBody();

    expect(changeIdsOf(editor, "deletion")).toEqual(["ch_1792507065581_1_jjwaa9"]);
    expect(changeIdsOf(editor, "insertion")).toEqual(["ch_1792507065581_1_jjwaa9"]);
    expect(changeIdsOf(editor, "formatChange")).toEqual(["ch_1792507065999_2_abcdef"]);
    expect(
      editor.view.dom.querySelector('del[data-change-id="ch_1792507065581_1_jjwaa9"]'),
    ).toBeTruthy();
    expect(
      editor.view.dom.querySelector('ins[data-change-id="ch_1792507065581_1_jjwaa9"]'),
    ).toBeTruthy();

    const markdown = getTextEditorContent(editor, "markdown");
    expectNoAuthor(markdown);
    expect(markdown).toContain(
      '<del data-change-id="ch_1792507065581_1_jjwaa9">old</del><ins data-change-id="ch_1792507065581_1_jjwaa9">new</ins>',
    );
    expect(markdown).toContain('data-format-added="bold"');

    const reopened = createDocsEditor(new Y.Doc(), null);
    setTextEditorContent(reopened, markdown, "markdown");
    expect(getTextEditorContent(reopened, "markdown")).toBe(markdown);
  });

  it("still accepts and rejects its suggestions", () => {
    const accepted = openOldBody();
    accepted.commands.acceptChange("ch_1792507065581_1_jjwaa9");
    expect(accepted.getText()).toContain("Hello new");
    expect(accepted.getText()).not.toContain("old");

    const rejected = openOldBody();
    rejected.commands.rejectChange("ch_1792507065581_1_jjwaa9");
    expect(rejected.getText()).toContain("Hello old");
    expect(rejected.getText()).not.toContain("new");
  });

  it("loads collab state written by the library marks and drops the name", () => {
    const legacyDoc = new Y.Doc();
    const legacy = track(
      new Editor({
        extensions: [
          StarterKit.configure({ undoRedo: false, link: false, underline: false }),
          Collaboration.configure({ document: legacyDoc }),
          ...createTextEditorExtensions({ format: "markdown" }).filter(
            (ext) => ext.name !== "starterKit",
          ),
          TrackChangesExtension.configure({
            author: { id: "tc_96a42209", name: PERSON, color: SESSION_COLOUR },
          }),
        ],
      }),
    );
    legacy.commands.setContent("<p>Hello old world</p>");
    suggestReplace(legacy, 7, 10, "new");
    expect(JSON.stringify(legacyDoc.getXmlFragment("default").toJSON())).toContain(PERSON);
    const [changeId] = changeIdsOf(legacy, "insertion");

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(legacyDoc));
    const editor = createDocsEditor(ydoc, null);

    expect(changeIdsOf(editor, "insertion")).toEqual([changeId]);
    expect(getTrackedChanges(editor).every((change) => !change.authorName)).toBe(true);
    expectNoAuthor(getTextEditorContent(editor, "markdown"));
    expectNoAuthor(editor.view.dom.innerHTML);

    editor.commands.rejectChange(changeId!);
    expect(editor.getText()).toContain("Hello old world");
  });
});

describe("withoutNodeTrackingAuthor", () => {
  it("strips who made a block change and keeps the rest", () => {
    expect(
      withoutNodeTrackingAuthor({
        changeId: "ch_1",
        authorId: "tc_1",
        authorName: PERSON,
        authorColor: SESSION_COLOUR,
        timestamp: "2026-10-19T10:00:00.000Z",
        originalType: "paragraphInserted",
      }),
    ).toEqual({
      changeId: "ch_1",
      timestamp: "2026-10-19T10:00:00.000Z",
      originalType: "paragraphInserted",
    });
    expect(withoutNodeTrackingAuthor(null)).toBeNull();
  });
});

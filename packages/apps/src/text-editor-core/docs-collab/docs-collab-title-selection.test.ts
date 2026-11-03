import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NOTE_TITLE_YTEXT_KEY, writeNoteTitle } from "./docs-collab-document-title";
import {
  NOTE_TITLE_SELECTION_FIELD,
  decodeTitleSelection,
  encodeTitleSelection,
  listRemoteTitleCarets,
} from "./docs-collab-title-selection";

function sync(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
}

function titledPair(title: string): [Y.Doc, Y.Doc] {
  const left = new Y.Doc();
  const right = new Y.Doc();
  writeNoteTitle(left, title);
  sync(left, right);
  return [left, right];
}

/** Awareness states travel as JSON, so every test round-trips through it. */
function overTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("title selection in awareness", () => {
  it("maps a selection to relative positions and back", () => {
    const [doc] = titledPair("Hello world");

    const state = encodeTitleSelection(doc, { anchor: 2, head: 6 });

    expect(decodeTitleSelection(doc, overTheWire(state))).toEqual({ anchor: 2, head: 6 });
  });

  it("keeps the caret on its letter after a concurrent insert before it", () => {
    const [mine, theirs] = titledPair("Hello world");
    const state = overTheWire(encodeTitleSelection(theirs, { anchor: 6, head: 6 }));

    writeNoteTitle(mine, "Big Hello world");
    writeNoteTitle(theirs, "Hello wide world");
    sync(mine, theirs);

    expect(mine.getText(NOTE_TITLE_YTEXT_KEY).toString()).toBe("Big Hello wide world");
    // Their caret sat before "w" of "world"; it is still there.
    expect(decodeTitleSelection(mine, state)).toEqual({ anchor: 10, head: 10 });
  });

  it("keeps a caret at the end of the title after text is added before it", () => {
    const [mine, theirs] = titledPair("Plan");
    const state = overTheWire(encodeTitleSelection(theirs, { anchor: 4, head: 4 }));

    writeNoteTitle(mine, "Team Plan");
    sync(mine, theirs);

    expect(decodeTitleSelection(mine, state)).toEqual({ anchor: 9, head: 9 });
  });

  it("collapses a caret to the deletion point when its text is removed", () => {
    const [mine, theirs] = titledPair("Hello world");
    const state = overTheWire(encodeTitleSelection(theirs, { anchor: 8, head: 8 }));

    writeNoteTitle(mine, "Hello");
    sync(mine, theirs);

    expect(decodeTitleSelection(mine, state)).toEqual({ anchor: 5, head: 5 });
  });

  it("clamps an index past the end of the title", () => {
    const [doc] = titledPair("Hi");

    const state = encodeTitleSelection(doc, { anchor: 9, head: -3 });

    expect(decodeTitleSelection(doc, overTheWire(state))).toEqual({ anchor: 2, head: 0 });
  });

  it("does not create the title type to anchor a caret", () => {
    const doc = new Y.Doc();

    expect(encodeTitleSelection(doc, { anchor: 0, head: 0 })).toBeNull();
    expect(doc.share.has(NOTE_TITLE_YTEXT_KEY)).toBe(false);
  });

  it("does not create the title type while decoding", () => {
    const [titled] = titledPair("Hi");
    const state = overTheWire(encodeTitleSelection(titled, { anchor: 1, head: 1 }));
    const untitled = new Y.Doc();

    expect(decodeTitleSelection(untitled, state)).toBeNull();
    expect(untitled.share.has(NOTE_TITLE_YTEXT_KEY)).toBe(false);
  });

  it("rejects a position that points into another shared type", () => {
    const [doc] = titledPair("Hi");
    const other = doc.getText("other");
    other.insert(0, "elsewhere");
    const position = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(other, 3));

    expect(decodeTitleSelection(doc, { anchor: position, head: position })).toBeNull();
  });

  it.each([null, undefined, "caret", 4, {}, { anchor: 1, head: 2 }, { anchor: {}, head: {} }])(
    "ignores a malformed awareness value (%j)",
    (value) => {
      const [doc] = titledPair("Hi");

      expect(decodeTitleSelection(doc, value)).toBeNull();
    },
  );
});

describe("remote title carets", () => {
  const LOCAL_CLIENT = 1;

  function stateFor(doc: Y.Doc, name: string, index: number, color = "#2563eb") {
    return {
      user: { name, color },
      [NOTE_TITLE_SELECTION_FIELD]: overTheWire(
        encodeTitleSelection(doc, { anchor: index, head: index }),
      ),
    } as Record<string, unknown>;
  }

  it("lists another participant's caret with their name and color", () => {
    const [doc] = titledPair("Hello world");
    const states = new Map([[2, stateFor(doc, "Grace", 5, "#dc2626")]]);

    expect(listRemoteTitleCarets(doc, states, { clientId: LOCAL_CLIENT, userName: "Ada" })).toEqual(
      [{ clientId: 2, name: "Grace", color: "#dc2626", anchor: 5, head: 5 }],
    );
  });

  it("skips this tab and the local account's other tabs", () => {
    const [doc] = titledPair("Hello world");
    const states = new Map([
      [LOCAL_CLIENT, stateFor(doc, "Ada", 1)],
      [3, stateFor(doc, " ada ", 2)],
      [4, stateFor(doc, "Grace", 3)],
    ]);

    const carets = listRemoteTitleCarets(doc, states, { clientId: LOCAL_CLIENT, userName: "Ada" });

    expect(carets.map((caret) => caret.clientId)).toEqual([4]);
  });

  it("skips a participant who is not in the title", () => {
    const [doc] = titledPair("Hello world");
    const left = stateFor(doc, "Grace", 3);
    left[NOTE_TITLE_SELECTION_FIELD] = null;
    const states = new Map<number, Record<string, unknown> | null>([
      [2, left],
      [3, { user: { name: "Linus", color: "#16a34a" } }],
      [4, null],
    ]);

    expect(listRemoteTitleCarets(doc, states, { clientId: LOCAL_CLIENT, userName: "Ada" })).toEqual(
      [],
    );
  });

  it("skips a caret without a usable name", () => {
    const [doc] = titledPair("Hello world");
    const nameless = stateFor(doc, "  ", 3);
    const states = new Map([[2, nameless]]);

    expect(listRemoteTitleCarets(doc, states, { clientId: LOCAL_CLIENT, userName: "Ada" })).toEqual(
      [],
    );
  });

  it("does not pass a color that is not a hex value through to the page", () => {
    const [doc] = titledPair("Hello world");
    const states = new Map([[2, stateFor(doc, "Grace", 3, "red; background: url(x)")]]);

    const [caret] = listRemoteTitleCarets(doc, states, { clientId: LOCAL_CLIENT, userName: "Ada" });

    expect(caret?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

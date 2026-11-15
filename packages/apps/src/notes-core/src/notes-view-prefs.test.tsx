import { afterEach, describe, expect, it } from "vitest";
import {
  NOTES_VIEW_PREFS_STORAGE_KEY,
  notesHiddenNotebooks,
  notesViewPrefs,
} from "@/notes-core/src/notes-view-prefs";

/** Written by the pre-#1636 `persistHiddenNotebookIds`. */
const OLD_FORMAT = '{"hiddenNotebookIds":["work"],"knownNotebookIds":["drafts","work"]}';

describe("notesViewPrefs binding", () => {
  afterEach(() => {
    window.localStorage.removeItem(NOTES_VIEW_PREFS_STORAGE_KEY);
  });

  it("reads hidden notebooks written by the old store", () => {
    window.localStorage.setItem("wgw.ui.notes.viewPrefs", OLD_FORMAT);
    expect(notesHiddenNotebooks.read()).toEqual({
      hiddenIds: ["work"],
      knownIds: ["drafts", "work"],
    });
  });

  it("writes the same JSON the old store wrote", () => {
    notesHiddenNotebooks.write(new Set(["work"]), ["drafts", "work"]);
    expect(window.localStorage.getItem("wgw.ui.notes.viewPrefs")).toBe(OLD_FORMAT);
    expect(notesViewPrefs.read()).toEqual(JSON.parse(OLD_FORMAT));
  });
});

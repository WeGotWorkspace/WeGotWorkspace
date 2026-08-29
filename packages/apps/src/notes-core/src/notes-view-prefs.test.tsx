import { afterEach, describe, expect, it } from "vitest";
import {
  NOTES_VIEW_PREFS_STORAGE_KEY,
  persistHiddenNotebookIds,
  readNotesViewPrefs,
  resolveHiddenNotebookIds,
} from "@/notes-core/src/notes-view-prefs";

function clearStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(NOTES_VIEW_PREFS_STORAGE_KEY);
  }
}

describe("resolveHiddenNotebookIds", () => {
  const notebooks = [{ id: "drafts" }, { id: "work" }, { id: "hidden", isVisible: false }];

  it("uses server visibility when nothing is persisted", () => {
    expect(resolveHiddenNotebookIds(notebooks, undefined)).toEqual(["hidden"]);
  });

  it("keeps a user hide after the device has seen the notebook", () => {
    expect(
      resolveHiddenNotebookIds(notebooks, {
        hiddenNotebookIds: ["work"],
        knownNotebookIds: ["drafts", "work", "hidden"],
      }),
    ).toEqual(["work"]);
  });
});

describe("persistHiddenNotebookIds", () => {
  afterEach(() => {
    clearStorage();
  });

  it("writes hidden and known notebook ids to localStorage", () => {
    persistHiddenNotebookIds(new Set(["work"]), ["drafts", "work"]);
    expect(readNotesViewPrefs()).toEqual({
      hiddenNotebookIds: ["work"],
      knownNotebookIds: ["drafts", "work"],
    });
  });
});

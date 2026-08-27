import { afterEach, describe, expect, it } from "vitest";
import {
  persistHiddenTaskListIds,
  readTasksViewPrefs,
  resolveHiddenTaskListIds,
  TASKS_VIEW_PREFS_STORAGE_KEY,
} from "@/tasks-core/src/tasks-view-prefs";

function clearStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(TASKS_VIEW_PREFS_STORAGE_KEY);
  }
}

describe("resolveHiddenTaskListIds", () => {
  const lists = [{ id: "inbox" }, { id: "work" }, { id: "hidden", isVisible: false }];

  it("uses server visibility when nothing is persisted", () => {
    expect(resolveHiddenTaskListIds(lists, undefined)).toEqual(["hidden"]);
  });

  it("keeps a user hide after the device has seen the list", () => {
    expect(
      resolveHiddenTaskListIds(lists, {
        hiddenTaskListIds: ["work"],
        knownTaskListIds: ["inbox", "work", "hidden"],
      }),
    ).toEqual(["work"]);
  });
});

describe("persistHiddenTaskListIds", () => {
  afterEach(() => {
    clearStorage();
  });

  it("writes hidden and known list ids to localStorage", () => {
    persistHiddenTaskListIds(new Set(["work"]), ["inbox", "work"]);
    expect(readTasksViewPrefs()).toEqual({
      hiddenTaskListIds: ["work"],
      knownTaskListIds: ["inbox", "work"],
    });
  });
});

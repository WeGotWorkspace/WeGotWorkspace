import { afterEach, describe, expect, it } from "vitest";
import {
  TASKS_VIEW_PREFS_STORAGE_KEY,
  tasksHiddenLists,
  tasksViewPrefs,
} from "@/tasks-core/src/tasks-view-prefs";

/** Written by the pre-#1636 `persistHiddenTaskListIds`. */
const OLD_FORMAT = '{"hiddenTaskListIds":["work"],"knownTaskListIds":["inbox","work"]}';

describe("tasksViewPrefs binding", () => {
  afterEach(() => {
    window.localStorage.removeItem(TASKS_VIEW_PREFS_STORAGE_KEY);
  });

  it("reads hidden lists written by the old store", () => {
    window.localStorage.setItem("wgw.ui.tasks.viewPrefs", OLD_FORMAT);
    expect(tasksHiddenLists.read()).toEqual({ hiddenIds: ["work"], knownIds: ["inbox", "work"] });
  });

  it("writes the same JSON the old store wrote", () => {
    tasksHiddenLists.write(new Set(["work"]), ["inbox", "work"]);
    expect(window.localStorage.getItem("wgw.ui.tasks.viewPrefs")).toBe(OLD_FORMAT);
    expect(tasksViewPrefs.read()).toEqual(JSON.parse(OLD_FORMAT));
  });
});

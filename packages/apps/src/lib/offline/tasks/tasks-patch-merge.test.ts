import { describe, expect, it } from "vitest";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import {
  applyTaskPatch,
  coalesceTaskPatches,
  withExplicitAlertsClear,
} from "@/lib/offline/tasks/tasks-patch-merge";
import { offsetReminderAlert, taskAlertsFromList } from "@/tasks-core/src/tasks-task-utils";

function taskWithAlert(): Task {
  return {
    "@type": "Task",
    id: "task-1",
    taskListId: "inbox",
    uid: "urn:uuid:task-1",
    title: "Reminded",
    isDraft: false,
    sortOrder: 0,
    categories: [],
    alerts: taskAlertsFromList([offsetReminderAlert("-PT30M")]),
  };
}

describe("applyTaskPatch", () => {
  it("maps alerts null to an omitted reminder on Task", () => {
    const merged = applyTaskPatch(taskWithAlert(), { alerts: null } as TaskPatch);

    expect(merged.alerts).toBeUndefined();
    expect("alerts" in merged).toBe(false);
  });

  it("replaces alerts when the patch sends a new map", () => {
    const next = taskAlertsFromList([offsetReminderAlert("-PT1H")]);
    const merged = applyTaskPatch(taskWithAlert(), { alerts: next });

    expect(merged.alerts).toEqual(next);
  });

  it("removes one alert sent as null and keeps the others, as the API does", () => {
    const task = {
      ...taskWithAlert(),
      alerts: taskAlertsFromList([offsetReminderAlert("-PT30M"), offsetReminderAlert("-P1D")]),
    };
    const merged = applyTaskPatch(task, { alerts: { alert1: null } });

    expect(merged.alerts).toEqual({ alert2: offsetReminderAlert("-P1D") });
  });
});

describe("coalesceTaskPatches", () => {
  it("lets a later alerts null win", () => {
    const first: TaskPatch = { alerts: taskAlertsFromList([offsetReminderAlert("-PT30M")]) };
    const coalesced = coalesceTaskPatches(first, { alerts: null } as TaskPatch);

    expect(coalesced.alerts).toBeNull();
  });

  it("merges two alert maps id by id, the later winning", () => {
    const coalesced = coalesceTaskPatches(
      { alerts: { alert1: offsetReminderAlert("-PT30M"), alert2: offsetReminderAlert("-P1D") } },
      { alerts: { alert1: null } },
    );

    expect(coalesced.alerts).toEqual({ alert1: null, alert2: offsetReminderAlert("-P1D") });
  });
});

describe("withExplicitAlertsClear", () => {
  it("keeps a cleared alarm gone when a new one is queued after it (offline)", () => {
    const server = {
      ...taskWithAlert(),
      alerts: taskAlertsFromList([offsetReminderAlert("-PT30M"), offsetReminderAlert("-P1D")]),
    };
    // Offline: remove both alarms, then add one. Each patch is queued against the cache.
    const clear = withExplicitAlertsClear({ alerts: null } as TaskPatch, server);
    const cleared = applyTaskPatch(server, clear);
    const added: TaskPatch = { alerts: { alert1: offsetReminderAlert("-PT1H") } };
    const queued = coalesceTaskPatches(
      clear,
      withExplicitAlertsClear(added, applyTaskPatch(cleared, added)),
    );

    // The server merges per id: only the new alarm is left.
    expect(applyTaskPatch(server, queued).alerts).toEqual({
      alert1: offsetReminderAlert("-PT1H"),
    });
  });

  it("leaves a clear of a task without alarms, and other patches, as they are", () => {
    const bare = { ...taskWithAlert(), alerts: undefined };
    expect(withExplicitAlertsClear({ alerts: null } as TaskPatch, bare)).toEqual({ alerts: null });
    const patch: TaskPatch = { title: "x" };
    expect(withExplicitAlertsClear(patch, taskWithAlert())).toBe(patch);
  });
});

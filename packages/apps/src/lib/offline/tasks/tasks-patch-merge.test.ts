import { describe, expect, it } from "vitest";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import { applyTaskPatch, coalesceTaskPatches } from "@/lib/offline/tasks/tasks-patch-merge";
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
});

describe("coalesceTaskPatches", () => {
  it("lets a later alerts null win", () => {
    const first: TaskPatch = { alerts: taskAlertsFromList([offsetReminderAlert("-PT30M")]) };
    const coalesced = coalesceTaskPatches(first, { alerts: null } as TaskPatch);

    expect(coalesced.alerts).toBeNull();
  });
});

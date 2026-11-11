import { describe, expect, it, vi } from "vitest";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import {
  runTasksIcsImport,
  tasksImportErrorReason,
  tasksImportErrorTitle,
  tasksImportNeedsResultStep,
} from "@/tasks-core/src/tasks-ics-import";
import type { Task, TaskList, TasksAPIOperations } from "@/tasks-core/src/tasks-types";

const L = defaultTasksLabels;

function operations(overrides: Partial<TasksAPIOperations> = {}): TasksAPIOperations {
  return {
    createTask: vi.fn(),
    patchTask: vi.fn(),
    deleteTask: vi.fn(),
    moveTaskToList: vi.fn(),
    importTasks: vi.fn().mockResolvedValue({ list: [], errors: [], skipped: { events: 0 } }),
    ...overrides,
  };
}

describe("runTasksIcsImport", () => {
  it("imports into an existing list", async () => {
    const ops = operations();

    const outcome = await runTasksIcsImport(ops, "BEGIN:VCALENDAR", {
      mode: "existing",
      collectionId: "work",
    });

    expect(ops.importTasks).toHaveBeenCalledWith("BEGIN:VCALENDAR", { taskListId: "work" });
    expect(outcome.taskListId).toBe("work");
    expect(outcome.createdList).toBeUndefined();
  });

  it("creates the list first, then imports into it", async () => {
    const created = { id: "list-new", name: "Groceries" } as TaskList;
    const createTaskList = vi.fn().mockResolvedValue(created);
    const ops = operations({ createTaskList });

    const outcome = await runTasksIcsImport(ops, "BEGIN:VCALENDAR", {
      mode: "create",
      name: "Groceries",
      color: "#22c55e",
    });

    expect(createTaskList).toHaveBeenCalledWith(
      { name: "Groceries", color: "#22c55e" },
      { requireServer: true },
    );
    expect(ops.importTasks).toHaveBeenCalledWith("BEGIN:VCALENDAR", { taskListId: "list-new" });
    expect(outcome).toMatchObject({ taskListId: "list-new", createdList: created });
  });

  it("throws when import is not available", async () => {
    await expect(
      runTasksIcsImport(operations({ importTasks: undefined }), "x", {
        mode: "existing",
        collectionId: "work",
      }),
    ).rejects.toThrow("ICS import is not available");
  });
});

describe("result helpers", () => {
  const task = { id: "t1" } as Task;

  it("keeps the dialog open only when there is something to report", () => {
    expect(tasksImportNeedsResultStep({ list: [task], errors: [], skipped: { events: 0 } })).toBe(
      false,
    );
    expect(tasksImportNeedsResultStep({ list: [task], errors: [], skipped: { events: 2 } })).toBe(
      true,
    );
    expect(
      tasksImportNeedsResultStep({
        list: [task],
        errors: [{ index: 1, message: "x" }],
        skipped: { events: 0 },
      }),
    ).toBe(true);
    expect(tasksImportNeedsResultStep({ list: [], errors: [], skipped: { events: 0 } })).toBe(true);
  });

  it("names each failed task with a readable reason", () => {
    expect(tasksImportErrorReason({ index: 0, message: "raw", code: "already_exists" }, L)).toBe(
      L.importErrorAlreadyExists,
    );
    expect(
      tasksImportErrorReason({ index: 0, message: "raw", code: "payload_too_complex" }, L),
    ).toBe(L.importErrorTooComplex);
    expect(tasksImportErrorReason({ index: 0, message: "Server said no." }, L)).toBe(
      "Server said no.",
    );
    expect(tasksImportErrorTitle({ index: 0, message: "x", title: "Buy milk" }, L)).toBe(
      "Buy milk",
    );
    expect(tasksImportErrorTitle({ index: 0, message: "x" }, L)).toBe(L.importUntitledTask);
  });

  it("words the counts", () => {
    expect(L.importedTasks(1)).toBe("Imported 1 task");
    expect(L.importedTasks(3)).toBe("Imported 3 tasks");
    expect(L.importEventsSkipped(2)).toBe("2 events were skipped. Import them in Calendar.");
  });
});

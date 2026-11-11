import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import type { Task, TaskList, TasksAPIOperations } from "@/tasks-core/src/tasks-types";
import { useTasksIcsImport } from "@/tasks-core/src/use-tasks-ics-import";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

const connection = vi.hoisted(() => ({ online: true }));
vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: () => connection.online };
});

const L = defaultTasksLabels;
const ics = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t1\r\nEND:VTODO\r\nEND:VCALENDAR";
const file = new File([ics], "groceries.ics", { type: "text/calendar" });
const task = { id: "t1", title: "Buy milk", taskListId: "work" } as Task;

function operations(overrides: Partial<TasksAPIOperations>): TasksAPIOperations {
  return {
    createTask: vi.fn(),
    patchTask: vi.fn(),
    deleteTask: vi.fn(),
    moveTaskToList: vi.fn(),
    ...overrides,
  };
}

async function submit(
  ops: TasksAPIOperations,
  destination: Parameters<ReturnType<typeof useTasksIcsImport>["submitImportDialog"]>[1],
) {
  const onImported = vi.fn();
  const hook = renderHook(() => useTasksIcsImport({ operations: ops, labels: L, onImported }));
  act(() => hook.result.current.beginImport(file));
  await act(async () => {
    hook.result.current.submitImportDialog(file, destination);
  });
  return { hook, onImported };
}

describe("useTasksIcsImport", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    connection.online = true;
  });

  it("creates no list when the connection dropped while the dialog was open", async () => {
    connection.online = false;
    const createTaskList = vi.fn();
    const importTasks = vi.fn();

    const { hook, onImported } = await submit(operations({ createTaskList, importTasks }), {
      mode: "create",
      name: "Groceries",
      color: "#22c55e",
    });

    expect(createTaskList).not.toHaveBeenCalled();
    expect(importTasks).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(hook.result.current.importDialogError).toBe(L.importOffline);
  });

  it("closes with a toast when everything imported", async () => {
    const importTasks = vi
      .fn()
      .mockResolvedValue({ list: [task], errors: [], skipped: { events: 0 } });

    const { hook, onImported } = await submit(operations({ importTasks }), {
      mode: "existing",
      collectionId: "work",
    });

    expect(toastApi.show).toHaveBeenCalledWith("Imported 1 task");
    expect(onImported).toHaveBeenCalledWith({
      taskListId: "work",
      createdList: undefined,
      tasks: [task],
    });
    expect(hook.result.current.importFile).toBeNull();
    expect(hook.result.current.importResult).toBeNull();
  });

  it("keeps the dialog on its result when tasks failed or events were skipped", async () => {
    const result = {
      list: [task],
      errors: [{ index: 1, message: "x", code: "already_exists", title: "Old task" }],
      skipped: { events: 3 },
    };
    const importTasks = vi.fn().mockResolvedValue(result);

    const { hook } = await submit(operations({ importTasks }), {
      mode: "existing",
      collectionId: "work",
    });

    expect(toastApi.show).toHaveBeenCalledWith("Imported 1 task");
    expect(hook.result.current.importFile).toBe(file);
    expect(hook.result.current.importResult).toEqual(result);
  });

  it("shows the result, without a toast, when nothing was imported", async () => {
    const result = {
      list: [],
      errors: [{ index: 0, message: "x", code: "already_exists" }],
      skipped: { events: 0 },
    };

    const { hook } = await submit(operations({ importTasks: vi.fn().mockResolvedValue(result) }), {
      mode: "existing",
      collectionId: "work",
    });

    expect(toastApi.show).not.toHaveBeenCalled();
    expect(hook.result.current.importResult).toEqual(result);
  });

  it("creates a new list, imports into it and reports both", async () => {
    const created = { id: "list-new", name: "Groceries" } as TaskList;
    const createTaskList = vi.fn().mockResolvedValue(created);
    const importTasks = vi
      .fn()
      .mockResolvedValue({ list: [task], errors: [], skipped: { events: 0 } });

    const { onImported } = await submit(operations({ createTaskList, importTasks }), {
      mode: "create",
      name: "Groceries",
      color: "#22c55e",
    });

    expect(importTasks).toHaveBeenCalledWith(ics, { taskListId: "list-new" });
    expect(onImported).toHaveBeenCalledWith({
      taskListId: "list-new",
      createdList: created,
      tasks: [task],
    });
  });

  it("keeps a created list visible when the import then fails", async () => {
    const created = { id: "list-new", name: "Groceries" } as TaskList;
    const importTasks = vi
      .fn()
      .mockRejectedValue(new TasksRequestError("Server error.", 500, "server_error"));

    const { hook, onImported } = await submit(
      operations({ createTaskList: vi.fn().mockResolvedValue(created), importTasks }),
      { mode: "create", name: "Groceries", color: "#22c55e" },
    );

    expect(onImported).toHaveBeenCalledWith({
      taskListId: "list-new",
      createdList: created,
      tasks: [],
    });
    expect(hook.result.current.importDialogError).toBe("Server error.");
  });

  it("stops before creating a list when the file has no tasks", async () => {
    const createTaskList = vi.fn();
    const importTasks = vi.fn();
    const onImported = vi.fn();
    const eventsOnly = new File(
      ["BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nEND:VEVENT\r\nEND:VCALENDAR"],
      "events.ics",
    );
    const hook = renderHook(() =>
      useTasksIcsImport({
        operations: operations({ createTaskList, importTasks }),
        labels: L,
        onImported,
      }),
    );
    act(() => hook.result.current.beginImport(eventsOnly));
    await act(async () => {
      hook.result.current.submitImportDialog(eventsOnly, {
        mode: "create",
        name: "Events",
        color: "#22c55e",
      });
    });

    expect(createTaskList).not.toHaveBeenCalled();
    expect(importTasks).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(hook.result.current.importDialogError).toBe(L.importNoTasksInFile);
  });

  it("explains a file that is too large", async () => {
    const importTasks = vi
      .fn()
      .mockRejectedValue(new TasksRequestError("too big", 413, "payload_too_large"));

    const { hook } = await submit(operations({ importTasks }), {
      mode: "existing",
      collectionId: "work",
    });

    expect(hook.result.current.importDialogError).toBe(L.importFileTooLarge);
  });
});

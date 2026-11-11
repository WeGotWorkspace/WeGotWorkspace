/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { taskToFormValue } from "@/tasks-core/src/tasks-task-form";
import type { Task, TaskPatch, TasksAPIOperations } from "@/lib/models/tasks-types";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));

const bootstrap = createTasksAppBootstrap();
const OPEN = bootstrap.data.tasks.find((task) => task.id === "task-buy-milk")!;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withEtag(task: Task, etag: string): Task {
  return { ...task, etag } as Task;
}

/** The server's copy of the open task: each answer carries every write so far. */
let server: Task = OPEN;
function answer(patch: TaskPatch, etag: string): Task {
  server = withEtag({ ...server, ...patch } as Task, etag);
  return server;
}

function setup(patchTask: TasksAPIOperations["patchTask"], tasks: Task[] = bootstrap.data.tasks) {
  server = tasks.find((task) => task.id === OPEN.id) ?? OPEN;
  const operations = {
    createTask: vi.fn(),
    patchTask: vi.fn(patchTask),
    deleteTask: vi.fn(async () => undefined),
    moveTaskToList: vi.fn(),
  } satisfies TasksAPIOperations;
  const data = {
    ...bootstrap.data,
    tasks: tasks.map((task) => (task.id === OPEN.id ? withEtag(task, '"v1"') : task)),
  };
  const hook = renderHook(() => useTasksController({ data, operations }));
  // Completed tasks stay in the list, so a done task can be read back.
  if (hook.result.current.showCompletedToggle && !hook.result.current.showCompletedTasks) {
    act(() => hook.result.current.toggleShowCompletedTasks());
  }
  return { operations, ...hook };
}

function taskById(result: { current: { visibleTasks: Task[] } }, id: string) {
  return result.current.visibleTasks.find((task) => task.id === id);
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("one save chain per task", () => {
  it("sends the done toggle after the text save, with the etag that save returned", async () => {
    const textSave = deferred<Task>();
    const { operations, result } = setup(async (taskId, patch: TaskPatch) => {
      if ("title" in patch) return textSave.promise;
      return answer(patch, '"v3"');
    });

    // The detail box: flush the typed title, then toggle at once.
    act(() => {
      void result.current.autosaveTask(OPEN.id, {
        ...taskToFormValue(OPEN, OPEN.taskListId),
        title: "Buy oat milk",
      });
      result.current.toggleTaskComplete(OPEN.id);
    });
    await act(async () => {});

    // Only the text save is out: the status patch waits for it.
    expect(operations.patchTask).toHaveBeenCalledTimes(1);
    expect(operations.patchTask.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ ifMatch: '"v1"' }),
    );

    await act(async () => {
      textSave.resolve(answer({ title: "Buy oat milk" }, '"v2"'));
    });
    await waitFor(() => expect(operations.patchTask).toHaveBeenCalledTimes(2));
    expect(operations.patchTask.mock.calls[1]?.[1]).toEqual({ workflowStatus: "completed" });
    expect(operations.patchTask.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ ifMatch: '"v2"' }),
    );
    await waitFor(() => expect(taskById(result, OPEN.id)?.workflowStatus).toBe("completed"));
    expect(taskById(result, OPEN.id)?.title).toBe("Buy oat milk");
  });

  it("a failed text save does not undo the done box", async () => {
    const textSave = deferred<Task>();
    const { result } = setup(async (_taskId, patch: TaskPatch) => {
      if ("title" in patch) return textSave.promise;
      return answer(patch, '"v3"');
    });

    act(() => {
      void result.current.autosaveTask(OPEN.id, {
        ...taskToFormValue(OPEN, OPEN.taskListId),
        title: "Buy oat milk",
      });
      result.current.toggleTaskComplete(OPEN.id);
    });
    expect(taskById(result, OPEN.id)?.workflowStatus).toBe("completed");

    await act(async () => {
      textSave.reject(new Error("412"));
    });
    await act(async () => {});
    // The text goes back; the toggle, a separate write, stays.
    await waitFor(() => expect(taskById(result, OPEN.id)?.title).toBe(OPEN.title));
    expect(taskById(result, OPEN.id)?.workflowStatus).toBe("completed");
  });

  it("a text save waiting for its pause goes after the list toggle, with that toggle's etag", async () => {
    const statusSave = deferred<Task>();
    const { operations, result } = setup(async (_taskId, patch: TaskPatch) => {
      if ("workflowStatus" in patch) return statusSave.promise;
      return answer(patch, '"v3"');
    });

    // The list row's box: no flush, the detail's debounced save lands later.
    act(() => result.current.toggleTaskComplete(OPEN.id));
    act(() => {
      void result.current.autosaveTask(OPEN.id, {
        ...taskToFormValue(taskById(result, OPEN.id)!, OPEN.taskListId),
        title: "Buy oat milk",
      });
    });
    await act(async () => {});
    expect(operations.patchTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      statusSave.resolve(answer({ workflowStatus: "completed" }, '"v2"'));
    });
    await waitFor(() => expect(operations.patchTask).toHaveBeenCalledTimes(2));
    expect(operations.patchTask.mock.calls[1]?.[1]).toEqual({ title: "Buy oat milk" });
    expect(operations.patchTask.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ ifMatch: '"v2"' }),
    );
    await waitFor(() => expect(taskById(result, OPEN.id)?.title).toBe("Buy oat milk"));
    expect(taskById(result, OPEN.id)?.workflowStatus).toBe("completed");
  });

  it("saves an edit to a task that has no title", async () => {
    const untitled = { ...OPEN, title: "" } as Task;
    const { operations, result } = setup(
      async (_taskId, patch: TaskPatch) => answer(patch, '"v2"'),
      bootstrap.data.tasks.map((task) => (task.id === OPEN.id ? untitled : task)),
    );

    await act(async () => {
      await result.current.autosaveTask(OPEN.id, {
        ...taskToFormValue(untitled, untitled.taskListId),
        priority: 1,
      });
    });

    expect(operations.patchTask).toHaveBeenCalledWith(OPEN.id, { priority: 1 }, expect.anything());
  });
  it("keeps the etag of a list move whose patch failed, also after the chain went idle", async () => {
    const { operations, result } = setup(async (_taskId, patch: TaskPatch) => {
      if ("title" in patch) throw new Error("412");
      return answer(patch, '"v3"');
    });
    operations.moveTaskToList.mockImplementation(async (_taskId: string, taskListId: string) =>
      answer({ taskListId } as TaskPatch, '"moved"'),
    );

    // One save moves the task and changes its title; the title patch fails.
    await act(async () => {
      await result.current.autosaveTask(OPEN.id, {
        ...taskToFormValue(OPEN, "default"),
        listId: "work",
        title: "Buy oat milk",
      });
    });
    await act(async () => {});
    expect(taskById(result, OPEN.id)?.taskListId).toBe("work");

    // The chain is idle now; the next write starts from the move's version.
    act(() => result.current.toggleTaskComplete(OPEN.id));
    await waitFor(() =>
      expect(operations.patchTask).toHaveBeenLastCalledWith(
        OPEN.id,
        { workflowStatus: "completed" },
        expect.objectContaining({ ifMatch: '"moved"' }),
      ),
    );
  });
});

/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TaskPatch, TasksAPIOperations } from "@/lib/models/tasks-types";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";

const toast = vi.hoisted(() => ({
  show: vi.fn((_title: string, _options?: unknown) => "toast-1" as string | number),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: toast.show,
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: (options: { onConfirm: () => void }) => options.onConfirm(),
  }),
}));

const bootstrap = createTasksAppBootstrap();
const OPEN_TASK = bootstrap.data.tasks.find((task) => task.id === "task-buy-milk")!;

function serverTask(taskId: string, patch: TaskPatch | Partial<Task> = {}): Task {
  const task = bootstrap.data.tasks.find((item) => item.id === taskId)!;
  return { ...task, ...patch, etag: `"server-${Math.random()}"` } as Task;
}

function createOperations() {
  return {
    createTask: vi.fn(),
    patchTask: vi.fn(async (taskId: string, patch: TaskPatch) => serverTask(taskId, patch)),
    deleteTask: vi.fn(async () => undefined),
    moveTaskToList: vi.fn(async (taskId: string, taskListId: string) =>
      serverTask(taskId, { taskListId }),
    ),
  } satisfies TasksAPIOperations;
}

function renderTasks(operations: TasksAPIOperations) {
  return renderHook(() => useTasksController({ data: bootstrap.data, operations }));
}

/** Presses Undo on the last undoable toast. */
function pressUndo() {
  const options = toast.show.mock.calls
    .map((call) => call[1] as AppToastShowOptions | undefined)
    .filter((item) => item?.canUndo)
    .at(-1);
  if (!options?.onUndo) throw new Error("no undo toast shown");
  act(() => options.onUndo!());
}

function taskById(result: { current: { visibleTasks: Task[] } }, id: string): Task | undefined {
  return result.current.visibleTasks.find((task) => task.id === id);
}

beforeEach(() => {
  toast.show.mockClear();
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

afterEach(() => {
  vi.useRealTimers();
});

describe("useTasksMutations undo as a compensating write", () => {
  it("completes a task at once and sends the old status back on undo", async () => {
    const operations = createOperations();
    const { result } = renderTasks(operations);

    act(() => result.current.toggleTaskComplete(OPEN_TASK.id));
    // Sent on the task's save chain (a microtask later), after any typed text.
    await act(async () => undefined);
    expect(operations.patchTask).toHaveBeenCalledWith(
      OPEN_TASK.id,
      { workflowStatus: "completed" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    pressUndo();

    await vi.waitFor(() => {
      expect(operations.patchTask).toHaveBeenCalledTimes(2);
    });
    // Only the status, against the version the complete produced (not the one before it).
    expect(operations.patchTask).toHaveBeenLastCalledWith(
      OPEN_TASK.id,
      { workflowStatus: "needs-action" },
      expect.objectContaining({ ifMatch: expect.stringMatching(/^"server-/) }),
    );
  });

  it("waits for a complete still on its way before sending the undo", async () => {
    const operations = createOperations();
    let land: () => void = () => undefined;
    operations.patchTask.mockImplementationOnce(
      (taskId: string, patch: TaskPatch) =>
        new Promise<Task>((resolve) => {
          land = () => resolve(serverTask(taskId, patch));
        }),
    );
    const { result } = renderTasks(operations);

    act(() => result.current.toggleTaskComplete(OPEN_TASK.id));
    pressUndo();
    await act(async () => undefined);

    expect(operations.patchTask).toHaveBeenCalledTimes(1);
    expect(taskById(result, OPEN_TASK.id)?.workflowStatus).toBe("needs-action");

    await act(async () => {
      land();
    });

    await vi.waitFor(() => {
      expect(operations.patchTask).toHaveBeenCalledTimes(2);
    });
    expect(operations.patchTask).toHaveBeenLastCalledWith(
      OPEN_TASK.id,
      { workflowStatus: "needs-action" },
      expect.objectContaining({ ifMatch: expect.stringMatching(/^"server-/) }),
    );
  });

  it("moves tasks at once and moves each one back to its own list on undo", async () => {
    const operations = createOperations();
    const { result } = renderTasks(operations);

    act(() => result.current.moveToList([OPEN_TASK.id, "task-review-spec"], "inbox"));

    expect(operations.moveTaskToList).toHaveBeenCalledWith(
      OPEN_TASK.id,
      "inbox",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await vi.waitFor(() => {
      expect(operations.moveTaskToList).toHaveBeenCalledTimes(2);
    });

    pressUndo();

    await vi.waitFor(() => {
      expect(operations.moveTaskToList).toHaveBeenCalledTimes(4);
    });
    expect(operations.moveTaskToList.mock.calls.slice(2)).toEqual([
      [OPEN_TASK.id, "default"],
      ["task-review-spec", "work"],
    ]);
  });

  it("holds a delete for the grace period, and undo cancels it", async () => {
    vi.useFakeTimers();
    const operations = createOperations();
    const { result } = renderTasks(operations);

    act(() => result.current.requestDeleteTask(OPEN_TASK.id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(operations.deleteTask).not.toHaveBeenCalled();

    pressUndo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(operations.deleteTask).not.toHaveBeenCalled();
    expect(taskById(result, OPEN_TASK.id)).toBeTruthy();
  });

  it("sends a delete after the grace period", async () => {
    vi.useFakeTimers();
    const operations = createOperations();
    const { result } = renderTasks(operations);

    act(() => result.current.requestDeleteTask(OPEN_TASK.id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(operations.deleteTask).toHaveBeenCalledWith(
      OPEN_TASK.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("useTasksMutations selection complete", () => {
  const click = (keys: { metaKey?: boolean } = {}) =>
    ({ metaKey: false, ctrlKey: false, shiftKey: false, ...keys }) as unknown as React.MouseEvent;

  it("sends the old status back for the tasks that landed when a later one fails", async () => {
    const operations = createOperations();
    const { result } = renderTasks(operations);
    const [first, second, third] = result.current.listTasks
      .filter((task) => task.workflowStatus !== "completed")
      .map((task) => task.id);
    const before = new Map(
      result.current.listTasks.map((task) => [task.id, task.workflowStatus ?? "needs-action"]),
    );
    act(() => result.current.handleSelect(first!, click()));
    act(() => result.current.handleSelect(second!, click({ metaKey: true })));
    act(() => result.current.handleSelect(third!, click({ metaKey: true })));

    // The first complete lands, the second fails: the batch must not stay half done.
    operations.patchTask
      .mockImplementationOnce(async (taskId: string, patch: TaskPatch) => serverTask(taskId, patch))
      .mockImplementationOnce(async () => {
        throw new Error("412");
      });
    act(() => result.current.selectionBarButtons[0]!.onClick());

    await vi.waitFor(() => {
      expect(operations.patchTask).toHaveBeenCalledWith(
        first,
        { workflowStatus: before.get(first!) },
        expect.anything(),
      );
    });
    // The third was never sent, the second never landed: only the first goes back.
    const sent = operations.patchTask.mock.calls.map(([id, patch]) => [id, patch.workflowStatus]);
    expect(sent).toEqual([
      [first, "completed"],
      [second, "completed"],
      [first, before.get(first!)],
    ]);
    const status = (id: string) =>
      result.current.displayTasks.find((task) => task.id === id)?.workflowStatus;
    expect(status(first!)).toBe(before.get(first!));
    expect(status(second!)).toBe(before.get(second!));
  });
});

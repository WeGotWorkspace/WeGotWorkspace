import type React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { writeDefaultCollectionPrefs } from "@/lib/default-collection-prefs";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { INBOX_TASK_LIST_ID } from "@/tasks-core/src/tasks-task-utils";
import type { TasksAPIOperations } from "@/tasks-core/src/tasks-types";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-queued-mutation", () => ({
  useQueuedMutation: () => ({
    queueMutation: vi.fn(),
    undoLatest: vi.fn(() => false),
  }),
}));

const bootstrap = createTasksAppBootstrap();

const mockOperations = {
  createTask: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTaskToList: vi.fn(),
} satisfies TasksAPIOperations;

describe("useTasksController URL routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
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

  it("opens a matching initialTaskId once", async () => {
    const { result, rerender } = renderHook(
      ({ initialTaskId }: { initialTaskId?: string }) =>
        useTasksController({ data: bootstrap.data, initialTaskId }),
      { initialProps: { initialTaskId: "task-inbox-demo" } },
    );

    await waitFor(() => {
      expect(result.current.activeId).toBe("task-inbox-demo");
    });
    expect(result.current.activeTask?.id).toBe("task-inbox-demo");
    expect(result.current.selectedIds).toEqual(["task-inbox-demo"]);

    act(() => {
      result.current.closeTask();
    });
    expect(result.current.activeId).toBe("");

    rerender({ initialTaskId: "task-inbox-demo" });
    expect(result.current.activeId).toBe("");
  });

  it("does not open an unknown initialTaskId", async () => {
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, initialTaskId: "missing-task" }),
    );
    await act(async () => undefined);
    expect(result.current.activeId).toBe("");
  });

  it("initialView seeds the controller view on mount", () => {
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, initialView: "state:today" }),
    );

    expect(result.current.view).toBe("state:today");
  });

  it("syncs view when initialView changes from the URL", () => {
    const { result, rerender } = renderHook(
      ({ initialView }: { initialView: string }) =>
        useTasksController({ data: bootstrap.data, initialView }),
      { initialProps: { initialView: "state:all" } },
    );

    expect(result.current.view).toBe("state:all");

    rerender({ initialView: "state:overdue" });

    expect(result.current.view).toBe("state:overdue");
  });

  it("onViewChange is called when selectView is invoked (not on mount)", () => {
    const onViewChange = vi.fn();
    const { result } = renderHook(() => useTasksController({ data: bootstrap.data, onViewChange }));

    expect(onViewChange).not.toHaveBeenCalled();

    act(() => {
      result.current.selectView("state:today");
    });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("state:today");
  });

  it("does not call onViewChange when only the callback identity changes", () => {
    const first = vi.fn();
    const { result, rerender } = renderHook(
      ({ onViewChange }: { onViewChange: (view: string) => void }) =>
        useTasksController({ data: bootstrap.data, initialView: "state:today", onViewChange }),
      { initialProps: { onViewChange: first } },
    );

    expect(result.current.view).toBe("state:today");
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn();
    rerender({ onViewChange: second });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(result.current.view).toBe("state:today");
  });

  it("does not revert optimistic selection when initialView is stale during navigation", () => {
    const onViewChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ initialView }: { initialView: string }) =>
        useTasksController({ data: bootstrap.data, initialView, onViewChange }),
      { initialProps: { initialView: "state:all" } },
    );

    act(() => {
      result.current.selectView(`list:${INBOX_TASK_LIST_ID}`);
    });

    expect(result.current.view).toBe(`list:${INBOX_TASK_LIST_ID}`);
    expect(onViewChange).toHaveBeenCalledWith(`list:${INBOX_TASK_LIST_ID}`);

    rerender({ initialView: "state:today" });

    expect(result.current.view).toBe(`list:${INBOX_TASK_LIST_ID}`);
    expect(onViewChange).toHaveBeenLastCalledWith(`list:${INBOX_TASK_LIST_ID}`);
  });

  it("clears pending navigation once the URL catches up", () => {
    const onViewChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ initialView }: { initialView: string }) =>
        useTasksController({ data: bootstrap.data, initialView, onViewChange }),
      { initialProps: { initialView: "state:all" } },
    );

    act(() => {
      result.current.selectView("state:upcoming");
    });

    rerender({ initialView: "state:upcoming" });

    expect(result.current.view).toBe("state:upcoming");

    act(() => {
      result.current.selectView("state:all");
    });
    rerender({ initialView: "state:all" });

    expect(result.current.view).toBe("state:all");
    expect(onViewChange).toHaveBeenLastCalledWith("state:all");
  });

  it("hides completed tasks by default on all view and reveals them when toggled", () => {
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, initialView: "state:all" }),
    );

    expect(result.current.showCompletedToggle).toBe(true);
    expect(result.current.displayTasks.some((task) => task.id === "task-done")).toBe(false);

    act(() => {
      result.current.toggleShowCompletedTasks();
    });

    expect(result.current.showCompletedTasks).toBe(true);
    expect(result.current.displayTasks.some((task) => task.id === "task-done")).toBe(true);
  });

  it("reveals a just-completed task when show completed is turned on", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
        initialView: "state:all",
      }),
    );

    act(() => {
      result.current.toggleTaskComplete("task-inbox-demo");
    });
    act(() => {
      result.current.handleTaskExitAnimationEnd("task-inbox-demo");
    });

    expect(result.current.displayTasks.some((task) => task.id === "task-inbox-demo")).toBe(false);

    act(() => {
      result.current.toggleShowCompletedTasks();
    });

    expect(result.current.showCompletedTasks).toBe(true);
    expect(result.current.displayTasks.some((task) => task.id === "task-inbox-demo")).toBe(true);
  });

  it("does not offer completed toggle on the completed status view", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        initialView: "state:completed",
      }),
    );

    expect(result.current.showCompletedToggle).toBe(false);
    expect(result.current.displayTasks.some((task) => task.id === "task-done")).toBe(true);
  });

  it("allows task creation on overdue view when operations are available", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
        initialView: "state:overdue",
      }),
    );

    expect(result.current.canCreateTask).toBe(true);
  });

  it("defaults to All Tasks when no initial view is provided", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
      }),
    );

    expect(result.current.view).toBe("state:all");
    expect(result.current.createListId).toBe(INBOX_TASK_LIST_ID);
  });

  it("uses the stored default list when All Tasks is selected", () => {
    writeDefaultCollectionPrefs("tasks", { collectionId: "work" });
    const allView = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
      }),
    );
    expect(allView.result.current.view).toBe("state:all");
    expect(allView.result.current.createListId).toBe("work");

    const listView = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
        initialView: "list:default",
      }),
    );
    expect(listView.result.current.createListId).toBe("default");
  });

  it("disables creation on a view-only shared list", () => {
    const data = {
      ...bootstrap.data,
      taskLists: [
        ...bootstrap.data.taskLists,
        {
          ...bootstrap.data.taskLists[0],
          id: "shared-inbox",
          name: "Inbox",
          role: null,
          isDefault: false,
          isSharee: true,
          myRights: {
            ...bootstrap.data.taskLists[0]!.myRights,
            mayWriteAll: false,
            mayWriteOwn: false,
            mayShare: false,
          },
        },
      ],
    };

    const { result } = renderHook(() =>
      useTasksController({
        data,
        operations: mockOperations,
        initialView: "list:shared-inbox",
      }),
    );

    expect(result.current.canCreateTask).toBe(false);
    expect(result.current.createListId).toBe("shared-inbox");
  });

  it("allows task creation on today view when operations are available", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
        initialView: "state:today",
      }),
    );

    expect(result.current.canCreateTask).toBe(true);
  });

  it("hides tasks from All Tasks when a list is unchecked and still shows a list view", () => {
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: mockOperations,
        initialView: "state:all",
      }),
    );

    const workTasks = bootstrap.data.tasks.filter((task) => task.taskListId === "work");
    expect(workTasks.length).toBeGreaterThan(0);
    expect(result.current.displayTasks.some((task) => task.taskListId === "work")).toBe(true);

    act(() => {
      result.current.toggleTaskListVisibility("work");
    });

    expect(result.current.hiddenTaskListIds.has("work")).toBe(true);
    expect(result.current.displayTasks.some((task) => task.taskListId === "work")).toBe(false);

    act(() => {
      result.current.selectView("list:work");
    });

    expect(result.current.displayTasks.some((task) => task.taskListId === "work")).toBe(true);
  });

  it("unhides Inbox when creating a task into it from All Tasks", async () => {
    const created = {
      ...bootstrap.data.tasks[0],
      id: "created-1",
      taskListId: "inbox",
      title: "From all tasks",
    };
    const createTask = vi.fn().mockResolvedValue(created);
    const { result } = renderHook(() =>
      useTasksController({
        data: bootstrap.data,
        operations: { ...mockOperations, createTask },
        initialView: "state:all",
      }),
    );

    act(() => {
      result.current.toggleTaskListVisibility("inbox");
    });
    expect(result.current.hiddenTaskListIds.has("inbox")).toBe(true);

    await act(async () => {
      await result.current.createTaskFromForm({
        title: "From all tasks",
        description: "",
        listId: "inbox",
        workflowStatus: "needs-action",
        priority: 0,
        due: null,
      });
    });

    expect(result.current.hiddenTaskListIds.has("inbox")).toBe(false);
    expect(createTask).toHaveBeenCalled();
  });
});

describe("useTasksController multi-select (the shared list controller)", () => {
  const click = (keys: { metaKey?: boolean; shiftKey?: boolean } = {}) =>
    ({ metaKey: false, ctrlKey: false, shiftKey: false, ...keys }) as unknown as React.MouseEvent;

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  function renderController() {
    const hook = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );
    const [first, second, third] = hook.result.current.listTasks.map((task) => task.id);
    return { ...hook, first: first!, second: second!, third: third! };
  }

  it("opens a task on a plain click and adds rows with Cmd and Shift", () => {
    const { result, first, second, third } = renderController();

    act(() => result.current.handleSelect(first, click()));
    expect(result.current.activeId).toBe(first);
    expect(result.current.selectedIds).toEqual([first]);

    act(() => result.current.handleSelect(second, click({ metaKey: true })));
    expect(result.current.selectedIds).toEqual([first, second]);

    act(() => result.current.handleSelect(third, click({ shiftKey: true })));
    expect(result.current.selectedIds).toEqual([second, third]);
  });

  it("offers complete, move, delete and done for a selection", () => {
    const { result, first, second } = renderController();
    act(() => result.current.handleSelect(first, click()));
    act(() => result.current.handleSelect(second, click({ metaKey: true })));

    expect(result.current.selectionBarButtons.map((button) => button.label)).toEqual([
      L.selectionComplete,
      L.selectionMoveToList,
      L.delete,
      L.selectionDone,
    ]);

    act(() => result.current.selectionBarButtons[1]!.onClick());
    expect(result.current.moveDialog).toEqual({ ids: [first, second] });
  });

  it("completes the whole selection in one go", () => {
    const { result, first, second } = renderController();
    act(() => result.current.handleSelect(first, click()));
    act(() => result.current.handleSelect(second, click({ metaKey: true })));

    act(() => result.current.selectionBarButtons[0]!.onClick());

    const status = (id: string) =>
      result.current.displayTasks.find((task) => task.id === id)?.workflowStatus;
    expect(status(first)).toBe("completed");
    expect(status(second)).toBe("completed");
  });

  it("walks the list with the arrow keys and extends with Shift", () => {
    const { result, first, second, third } = renderController();
    act(() => result.current.handleSelect(first, click()));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(result.current.activeId).toBe(second);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true }));
    });
    expect(result.current.selectedIds).toEqual([second, third]);
  });
});

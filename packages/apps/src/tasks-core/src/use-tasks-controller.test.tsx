import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
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

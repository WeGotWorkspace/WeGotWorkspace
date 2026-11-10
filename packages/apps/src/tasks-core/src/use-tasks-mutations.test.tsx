import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { emptyTaskForm, taskToFormValue } from "@/tasks-core/src/tasks-task-form";
import { offsetReminderAlert, taskAlertsFromList } from "@/tasks-core/src/tasks-task-utils";
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
const laterReminder = taskAlertsFromList([offsetReminderAlert("-PT1H")]);
const twoReminders = {
  alert1: offsetReminderAlert("-PT30M"),
  alert2: offsetReminderAlert("-P1D"),
};

const mockOperations = {
  createTask: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTaskToList: vi.fn(),
} satisfies TasksAPIOperations;

describe("useTasksMutations reminders", () => {
  beforeEach(() => {
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
    mockOperations.createTask.mockImplementation(async (body) => ({
      "@type": "Task",
      id: "created-1",
      taskListId: "inbox",
      uid: "urn:uuid:created-1",
      title: body.title,
      alerts: body.alerts,
      isDraft: false,
      sortOrder: 0,
      categories: [],
    }));
    mockOperations.patchTask.mockImplementation(async (_id, patch) => ({
      ...bootstrap.data.tasks[2],
      ...patch,
      alerts: patch.alerts === null ? undefined : (patch.alerts ?? bootstrap.data.tasks[2]?.alerts),
    }));
  });

  it("creates a task with multiple reminders", async () => {
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.createTaskFromForm({
        ...emptyTaskForm("inbox"),
        title: "Remind me later",
        alerts: twoReminders,
      });
    });

    expect(mockOperations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Remind me later",
        alerts: twoReminders,
      }),
    );
  });

  it("patches a changed reminder and sends null when cleared", async () => {
    const reminded = bootstrap.data.tasks.find(
      (task) => task.alerts && Object.keys(task.alerts).length > 0,
    );
    expect(reminded).toBeTruthy();

    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(reminded!.id, {
        ...taskToFormValue(reminded!, reminded!.taskListId),
        alerts: laterReminder,
      });
    });

    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      reminded!.id,
      expect.objectContaining({ alerts: laterReminder }),
      expect.anything(),
    );

    await act(async () => {
      await result.current.autosaveTask(reminded!.id, {
        ...taskToFormValue(reminded!, reminded!.taskListId),
        alerts: undefined,
      });
    });

    expect(mockOperations.patchTask).toHaveBeenLastCalledWith(
      reminded!.id,
      expect.objectContaining({ alerts: null }),
      expect.anything(),
    );
  });
});

describe("useTasksMutations rename and move in one autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the patch from the version the move produced (#1814)", async () => {
    const task = bootstrap.data.tasks[2]!;
    const otherList = bootstrap.data.taskLists.find((list) => list.id !== task.taskListId)!;
    mockOperations.moveTaskToList.mockResolvedValue({
      ...task,
      taskListId: otherList.id,
      etag: "after-move",
    });
    mockOperations.patchTask.mockImplementation(async (_id, patch) => ({ ...task, ...patch }));
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        listId: otherList.id,
        title: `${task.title} renamed`,
      });
    });

    expect(mockOperations.moveTaskToList).toHaveBeenCalledWith(task.id, otherList.id);
    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      task.id,
      { title: `${task.title} renamed` },
      expect.objectContaining({ ifMatch: "after-move" }),
    );
  });

  it("keeps a move that landed when the patch after it fails", async () => {
    const task = bootstrap.data.tasks[2]!;
    const otherList = bootstrap.data.taskLists.find((list) => list.id !== task.taskListId)!;
    mockOperations.moveTaskToList.mockResolvedValue({
      ...task,
      taskListId: otherList.id,
      etag: "after-move",
    });
    mockOperations.patchTask.mockRejectedValue(new Error("refused"));
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        listId: otherList.id,
        title: `${task.title} renamed`,
      });
    });

    const saved = result.current.displayTasks.find((item) => item.id === task.id);
    expect(saved).toMatchObject({
      taskListId: otherList.id,
      title: task.title,
    });
  });
});

describe("useTasksMutations autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs saves of one task one after the other, each on the etag before it", async () => {
    const task = bootstrap.data.tasks[2]!;
    let version = 0;
    mockOperations.patchTask.mockImplementation(async (_id, patch) => ({
      ...task,
      ...patch,
      etag: `v${++version}`,
    }));
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      const first = result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        title: `${task.title} a`,
      });
      const second = result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        title: `${task.title} ab`,
      });
      await Promise.all([first, second]);
    });

    expect(mockOperations.patchTask).toHaveBeenCalledTimes(2);
    expect(mockOperations.patchTask).toHaveBeenLastCalledWith(
      task.id,
      { title: `${task.title} ab` },
      expect.objectContaining({ ifMatch: "v1" }),
    );
  });

  it("keeps the stored title when the title field is emptied", async () => {
    const task = bootstrap.data.tasks[2]!;
    mockOperations.patchTask.mockImplementation(async (_id, patch) => ({ ...task, ...patch }));
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        title: "  ",
        description: "Only the notes changed",
      });
    });

    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      task.id,
      { description: "Only the notes changed" },
      expect.anything(),
    );
  });
});

describe("useTasksMutations due dates (#1821)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperations.patchTask.mockImplementation(async (id, patch) => ({
      ...bootstrap.data.tasks.find((task) => task.id === id)!,
      ...patch,
    }));
  });

  function taskWithoutDue() {
    const task = bootstrap.data.tasks.find((item) => !item.due);
    expect(task).toBeTruthy();
    return task!;
  }

  it("saves a date added in the detail pane as all day", async () => {
    const task = taskWithoutDue();
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        due: "2026-11-08",
        showWithoutTime: true,
      });
    });

    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ due: "2026-11-08", showWithoutTime: true }),
      expect.anything(),
    );
  });

  it("saves a date and time added in the detail pane as timed", async () => {
    const task = taskWithoutDue();
    const { result } = renderHook(() =>
      useTasksController({ data: bootstrap.data, operations: mockOperations }),
    );

    await act(async () => {
      await result.current.autosaveTask(task.id, {
        ...taskToFormValue(task, task.taskListId),
        due: "2026-11-08T09:30:00",
        showWithoutTime: false,
      });
    });

    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ due: "2026-11-08T09:30:00", showWithoutTime: false }),
      expect.anything(),
    );
  });
});

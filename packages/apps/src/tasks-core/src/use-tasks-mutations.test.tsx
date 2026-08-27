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

    act(() => {
      result.current.editTask(reminded!.id);
    });

    await act(async () => {
      await result.current.saveEditedTask({
        ...taskToFormValue(reminded!, reminded!.taskListId),
        alerts: laterReminder,
      });
    });

    expect(mockOperations.patchTask).toHaveBeenCalledWith(
      reminded!.id,
      expect.objectContaining({ alerts: laterReminder }),
      expect.anything(),
    );

    act(() => {
      result.current.editTask(reminded!.id);
    });

    await act(async () => {
      await result.current.saveEditedTask({
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

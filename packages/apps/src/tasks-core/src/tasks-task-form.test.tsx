import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import {
  CREATE_WORKFLOW_STATUSES,
  emptyTaskForm,
  orderedTaskMetaNodes,
  TASK_META_FIELD_ORDER,
  taskToFormValue,
  TasksTaskFormFields,
} from "@/tasks-core/src/tasks-task-form";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";

const bootstrap = createTasksAppBootstrap();

function renderFormFields(
  overrides: Partial<React.ComponentProps<typeof TasksTaskFormFields>> = {},
) {
  const value = emptyTaskForm("default");
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <TasksTaskFormFields
        L={defaultTasksLabels}
        value={value}
        onChange={onChange}
        taskLists={bootstrap.data.taskLists}
        mode="create"
        showDescription
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onChange, value };
}

describe("TasksTaskFormFields", () => {
  beforeEach(() => {
    cleanup();
    Element.prototype.scrollIntoView = vi.fn();
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

  it("shows only create workflow statuses in create mode", () => {
    renderFormFields({ mode: "create" });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskStatus));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(CREATE_WORKFLOW_STATUSES.length);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultTasksLabels.stateNeedsAction,
      defaultTasksLabels.stateInProcess,
    ]);
  });

  it("shows all workflow statuses in edit mode", () => {
    renderFormFields({ mode: "edit" });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskStatus));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultTasksLabels.stateNeedsAction,
      defaultTasksLabels.stateInProcess,
      defaultTasksLabels.stateCompleted,
      defaultTasksLabels.stateCancelled,
    ]);
  });

  it("renders the remind picker in create and edit modes", () => {
    renderFormFields({ mode: "create" });
    expect(screen.getByRole("button", { name: defaultTasksLabels.noReminders })).toBeTruthy();
    cleanup();
    renderFormFields({ mode: "edit" });
    expect(screen.getByRole("button", { name: defaultTasksLabels.noReminders })).toBeTruthy();
  });
});

describe("orderedTaskMetaNodes", () => {
  it("keeps remind last and matches the shared field order", () => {
    expect(TASK_META_FIELD_ORDER).toEqual(["due", "list", "status", "priority", "remind"]);
    expect(TASK_META_FIELD_ORDER.at(-1)).toBe("remind");
    expect(orderedTaskMetaNodes({ remind: "alerts", due: "due", list: "list" })).toEqual([
      "due",
      "list",
      "alerts",
    ]);
  });
});

describe("task form helpers", () => {
  it("maps task fields into form values", () => {
    const task = {
      ...bootstrap.data.tasks[0],
      title: "Review docs",
      description: "Before release",
      due: "2026-07-08T00:00:00",
      workflowStatus: "in-process" as const,
      priority: 1,
      taskListId: "default",
    };

    expect(taskToFormValue(task, "fallback")).toEqual({
      title: "Review docs",
      description: "Before release",
      listId: "default",
      workflowStatus: "in-process",
      priority: 1,
      due: "2026-07-08T00:00:00",
      alerts: task.alerts,
    });
  });
});

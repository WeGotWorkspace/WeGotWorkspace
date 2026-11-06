import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import {
  emptyTaskForm,
  TASK_FIELD_SELECT_TRIGGER_CLASS,
  taskFieldControls,
  taskToFormValue,
} from "@/tasks-core/src/tasks-task-form";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-field-controls.css";

const bootstrap = createTasksAppBootstrap();

function renderControls(disabled = false) {
  const onChange = vi.fn();
  const controls = taskFieldControls({
    L: defaultTasksLabels,
    value: emptyTaskForm("default"),
    onChange,
    disabled,
  });
  render(
    <TooltipProvider>
      {controls.status}
      {controls.due}
      {controls.remind}
      {controls.priority}
    </TooltipProvider>,
  );
  return { onChange };
}

describe("taskFieldControls", () => {
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

  it("offers every workflow status", () => {
    renderControls();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskStatus));

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultTasksLabels.stateNeedsAction,
      defaultTasksLabels.stateInProcess,
      defaultTasksLabels.stateCompleted,
      defaultTasksLabels.stateCancelled,
    ]);
  });

  it("hands a picked priority to onChange as an update", () => {
    const { onChange } = renderControls();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskPriority));
    fireEvent.click(screen.getByRole("option", { name: defaultTasksLabels.priorityHigh }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const update = onChange.mock.calls[0][0] as (
      previous: ReturnType<typeof emptyTaskForm>,
    ) => ReturnType<typeof emptyTaskForm>;
    expect(update(emptyTaskForm("default")).priority).toBe(1);
  });

  it("uses the compact md field chips", () => {
    renderControls();

    for (const name of [defaultTasksLabels.addTaskStatus, defaultTasksLabels.addTaskPriority]) {
      const trigger = screen.getByLabelText(name);
      expect(trigger.classList.contains("select-trigger--size-md")).toBe(true);
      expect(trigger.classList.contains(TASK_FIELD_SELECT_TRIGGER_CLASS)).toBe(true);
    }
    expect(screen.getByRole("button", { name: defaultTasksLabels.noReminders })).toBeTruthy();
  });

  it("disables every control when read-only", () => {
    renderControls(true);

    expect(screen.getByLabelText(defaultTasksLabels.addTaskStatus)).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText(defaultTasksLabels.addTaskPriority)).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: defaultTasksLabels.noReminders })).toHaveProperty(
      "disabled",
      true,
    );
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
      showWithoutTime: false,
      timeZone: null,
      alerts: task.alerts,
    });
  });
});

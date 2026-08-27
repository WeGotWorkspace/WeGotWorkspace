import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { tasksAlarmRowLabels } from "@/tasks-core/src/tasks-alert-mapping";
import { TasksEditDialog } from "@/tasks-core/src/tasks-edit-dialog";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";
import "@/tasks-core/src/tasks-workspace.css";

const bootstrap = createTasksAppBootstrap();

function renderEditDialog(overrides: Partial<React.ComponentProps<typeof TasksEditDialog>> = {}) {
  const task = bootstrap.data.tasks[0];
  const onSave = vi.fn();
  const onClose = vi.fn();

  render(
    <TooltipProvider>
      <TasksEditDialog
        dialog={{ taskId: task.id }}
        task={task}
        taskLists={bootstrap.data.taskLists}
        labels={defaultTasksLabels}
        onClose={onClose}
        onSave={onSave}
        {...overrides}
      />
    </TooltipProvider>,
  );

  return { task, onSave, onClose };
}

describe("TasksEditDialog", () => {
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

  it("prefills task fields and submits updated values", () => {
    const { task, onSave } = renderEditDialog();

    expect(screen.getByRole("heading", { name: defaultTasksLabels.editTaskTitle })).toBeTruthy();
    expect((screen.getByLabelText(defaultTasksLabels.addTaskName) as HTMLInputElement).value).toBe(
      task.title,
    );

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "Updated task title" },
    });
    fireEvent.change(screen.getByLabelText(defaultTasksLabels.descriptionLabel), {
      target: { value: "Updated notes" },
    });

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveTaskButton }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated task title",
        description: "Updated notes",
        listId: task.taskListId,
      }),
    );
  });

  it("prefills an existing reminder and can clear it", () => {
    const reminded = bootstrap.data.tasks.find(
      (item) => item.alerts && Object.keys(item.alerts).length > 0,
    );
    expect(reminded).toBeTruthy();

    const { onSave } = renderEditDialog({ task: reminded });

    const remind = screen.getByRole("button", { name: "Reminding 30 mins before" });
    expect(remind.classList.contains("tasks-main-view__remind-button--active")).toBe(true);

    fireEvent.click(remind);
    fireEvent.click(
      screen.getAllByRole("combobox", {
        name: tasksAlarmRowLabels(defaultTasksLabels).eventAlarmOffset,
      })[0]!,
    );
    fireEvent.click(
      screen.getByRole("option", { name: tasksAlarmRowLabels(defaultTasksLabels).eventAlarmNone }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveTaskButton }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: undefined,
      }),
    );
  });

  it("calls onClose when cancel is clicked", () => {
    const { onClose } = renderEditDialog();

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.cancel }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

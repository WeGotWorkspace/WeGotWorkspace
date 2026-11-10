import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { tasksAlarmRowLabels } from "@/tasks-core/src/tasks-alert-mapping";
import { TasksEditDialog } from "@/tasks-core/src/tasks-edit-dialog";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { taskToFormValue } from "@/tasks-core/src/tasks-task-form";
import type { Task } from "@/lib/models/tasks-types";
import { rebaseTaskForm } from "@/tasks-core/src/use-task-edit-form";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";
import "@/tasks-core/src/tasks-workspace.css";

const bootstrap = createTasksAppBootstrap();

function renderEditDialog(overrides: Partial<React.ComponentProps<typeof TasksEditDialog>> = {}) {
  const task = bootstrap.data.tasks[0];
  const onSave = vi.fn();
  const onClose = vi.fn();

  const ui = (props: Partial<React.ComponentProps<typeof TasksEditDialog>>) => (
    <TooltipProvider>
      <TasksEditDialog
        dialog={{ taskId: task.id }}
        task={task}
        taskLists={bootstrap.data.taskLists}
        labels={defaultTasksLabels}
        onClose={onClose}
        onSave={onSave}
        {...props}
      />
    </TooltipProvider>
  );
  const view = render(ui(overrides));
  const rerender = (props: Partial<React.ComponentProps<typeof TasksEditDialog>>) =>
    view.rerender(ui({ ...overrides, ...props }));

  return { task, onSave, onClose, rerender };
}

function fieldValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement).value;
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

  it("shows Delete and calls onDelete when clicked", () => {
    const onDelete = vi.fn();
    const { onClose } = renderEditDialog({ onDelete });

    const deleteButton = screen.getByRole("button", { name: defaultTasksLabels.delete });
    expect(deleteButton.className).toMatch(/button--severity-danger/);
    expect(deleteButton.className).toMatch(/button--variant-outline/);
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hides Delete when the task is read-only", () => {
    renderEditDialog({ onDelete: vi.fn(), readOnly: true });

    expect(screen.queryByRole("button", { name: defaultTasksLabels.delete })).toBeNull();
  });

  it("hides Delete when onDelete is omitted", () => {
    renderEditDialog();

    expect(screen.queryByRole("button", { name: defaultTasksLabels.delete })).toBeNull();
  });

  describe("when a newer copy of the task arrives (#1858)", () => {
    it("keeps what the person typed when the same task is re-rendered", () => {
      const { task, rerender } = renderEditDialog();
      fireEvent.change(screen.getByLabelText(defaultTasksLabels.descriptionLabel), {
        target: { value: "Draft, not saved" },
      });

      // A sync rebuilds the task objects: same id, new identity.
      rerender({ task: { ...task } });
      expect(fieldValue(defaultTasksLabels.descriptionLabel)).toBe("Draft, not saved");

      // Another field of this task changed elsewhere.
      rerender({ task: { ...task, title: "Renamed elsewhere" } });
      expect(fieldValue(defaultTasksLabels.descriptionLabel)).toBe("Draft, not saved");
      expect(fieldValue(defaultTasksLabels.addTaskName)).toBe("Renamed elsewhere");
    });

    it("keeps an edited field when the same field changed elsewhere", () => {
      const { task, rerender, onSave } = renderEditDialog();
      fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
        target: { value: "My title" },
      });

      rerender({ task: { ...task, title: "Their title", description: "Their notes" } });

      expect(fieldValue(defaultTasksLabels.addTaskName)).toBe("My title");
      fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveTaskButton }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My title", description: "Their notes" }),
      );
    });

    it("reseeds the form when it switches to another task", () => {
      const { task, rerender } = renderEditDialog();
      const other = bootstrap.data.tasks.find((item) => item.id !== task.id) as Task;
      fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
        target: { value: "Typed for the first task" },
      });

      rerender({ dialog: { taskId: other.id }, task: other });

      expect(fieldValue(defaultTasksLabels.addTaskName)).toBe(other.title);
      expect(fieldValue(defaultTasksLabels.descriptionLabel)).toBe(other.description ?? "");
    });

    it("reseeds the form when the same task is opened again", () => {
      const { task, rerender } = renderEditDialog();
      fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
        target: { value: "Cancelled draft" },
      });

      rerender({ dialog: null, task: null });
      rerender({ dialog: { taskId: task.id }, task });

      expect(fieldValue(defaultTasksLabels.addTaskName)).toBe(task.title);
    });

    it("mirrors the task once it becomes read-only", () => {
      const { task, rerender } = renderEditDialog();
      fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
        target: { value: "Cannot be saved" },
      });

      rerender({ task: { ...task }, readOnly: true });

      expect(fieldValue(defaultTasksLabels.addTaskName)).toBe(task.title);
    });
  });
});

describe("rebaseTaskForm", () => {
  const task = bootstrap.data.tasks[0] as Task;
  const base = taskToFormValue(task, task.taskListId);

  it("moves due, all-day and time zone as one group", () => {
    const current = { ...base, due: "2030-01-02T09:00:00", showWithoutTime: false };
    const next = {
      ...base,
      due: "2030-05-05",
      showWithoutTime: true,
      timeZone: "Europe/Amsterdam",
    };

    const merged = rebaseTaskForm(current, base, next);

    expect(merged.due).toBe("2030-01-02T09:00:00");
    expect(merged.showWithoutTime).toBe(false);
    expect(merged.timeZone).toBe(base.timeZone);
  });

  it("takes a list move made elsewhere when the list was not edited", () => {
    const next = { ...base, listId: "elsewhere" };

    expect(rebaseTaskForm({ ...base, title: "Edited" }, base, next)).toEqual({
      ...next,
      title: "Edited",
    });
  });
});

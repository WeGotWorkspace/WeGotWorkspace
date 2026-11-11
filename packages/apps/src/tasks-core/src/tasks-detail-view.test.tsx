import type React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TASK_DETAIL_SAVE_DEBOUNCE_MS, TasksDetailView } from "@/tasks-core/src/tasks-detail-view";
import { taskToFormValue } from "@/tasks-core/src/tasks-task-form";
import type { Task } from "@/tasks-core/src/tasks-types";
import { rebaseTaskForm } from "@/tasks-core/src/use-task-edit-form";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createTasksAppBootstrap();
const L = defaultTasksLabels;

function renderDetail(overrides: Partial<React.ComponentProps<typeof TasksDetailView>> = {}) {
  const task = bootstrap.data.tasks[0] as Task;
  const onSave = vi.fn();
  const onToggleComplete = vi.fn();
  const ui = (props: Partial<React.ComponentProps<typeof TasksDetailView>>) => (
    <TooltipProvider>
      <TasksDetailView
        key={(props.task ?? task).id}
        task={task}
        L={L}
        taskLists={bootstrap.data.taskLists}
        allTaskLists={bootstrap.data.taskLists}
        readOnly={false}
        onSave={onSave}
        onToggleComplete={onToggleComplete}
        {...props}
      />
    </TooltipProvider>
  );
  const view = render(ui(overrides));
  const rerender = (props: Partial<React.ComponentProps<typeof TasksDetailView>>) =>
    view.rerender(ui({ ...overrides, ...props }));
  return { task, onSave, onToggleComplete, rerender, unmount: view.unmount };
}

function fieldValue(label: string): string {
  return (screen.getByLabelText(label) as HTMLTextAreaElement).value;
}

describe("TasksDetailView", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the task like an open note: list, title, notes and field rows", () => {
    const { task } = renderDetail();

    expect(fieldValue(L.addTaskName)).toBe(task.title);
    expect(fieldValue(L.descriptionLabel)).toBe(task.description ?? "");
    expect(screen.getByRole("combobox", { name: L.addTaskList })).toBeTruthy();
    for (const label of [L.addTaskStatus, L.dueLabel, L.addTaskPriority, L.detailAlarm(1)]) {
      expect(screen.getByText(label, { selector: ".card__row-title, .card__row-title *" }));
    }
  });

  it("toggles done from the box left of the title, after saving what was typed", () => {
    vi.useFakeTimers();
    const { task, onSave, onToggleComplete } = renderDetail();
    const box = screen.getByRole("checkbox", { name: L.markComplete });
    expect(box.closest(".note-detail-view__title-row")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "Typed" } });
    fireEvent.click(box);

    expect(onSave).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "Typed" }));
    expect(onToggleComplete).toHaveBeenCalledWith(task.id);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      onToggleComplete.mock.invocationCallOrder[0],
    );
  });

  it("disables the done box on a read-only task", () => {
    renderDetail({ readOnly: true });
    expect(screen.getByRole("checkbox", { name: L.markComplete })).toHaveProperty("disabled", true);
  });

  it("saves typed text after a pause, once", () => {
    vi.useFakeTimers();
    const { task, onSave } = renderDetail();

    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "New title" } });
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(TASK_DETAIL_SAVE_DEBOUNCE_MS);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "New title" }));
  });

  it("saves the notes right away when the field loses focus", () => {
    const { task, onSave } = renderDetail();
    const notes = screen.getByLabelText(L.descriptionLabel);

    fireEvent.change(notes, { target: { value: "Bring the forms" } });
    fireEvent.blur(notes);

    expect(onSave).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ description: "Bring the forms" }),
    );
  });

  it("saves a picked value at once", () => {
    const { task, onSave } = renderDetail();

    fireEvent.click(screen.getByLabelText(L.addTaskPriority));
    fireEvent.click(screen.getByRole("option", { name: L.priorityHigh }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(task.id, expect.objectContaining({ priority: 1 }));
  });

  it("moves to another list only once the move is confirmed", () => {
    const onConfirmMove = vi.fn<(listName: string, move: () => void) => void>();
    const { task, onSave } = renderDetail({ onConfirmMove });
    const target = bootstrap.data.taskLists.find((list) => list.id !== task.taskListId)!;

    fireEvent.click(screen.getByRole("combobox", { name: L.addTaskList }));
    fireEvent.click(screen.getByRole("option", { name: target.name }));

    // Asked, not moved: Cancel is simply never calling `move`.
    expect(onConfirmMove).toHaveBeenCalledTimes(1);
    expect(onConfirmMove).toHaveBeenCalledWith(target.name, expect.any(Function));
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      onConfirmMove.mock.calls[0][1]();
    });
    expect(onSave).toHaveBeenCalledWith(task.id, expect.objectContaining({ listId: target.id }));
  });

  it("keeps the list when the move is cancelled", () => {
    vi.useFakeTimers();
    const onConfirmMove = vi.fn();
    const { task, onSave } = renderDetail({ onConfirmMove });
    const target = bootstrap.data.taskLists.find((list) => list.id !== task.taskListId)!;

    fireEvent.click(screen.getByRole("combobox", { name: L.addTaskList }));
    fireEvent.click(screen.getByRole("option", { name: target.name }));
    act(() => {
      vi.advanceTimersByTime(TASK_DETAIL_SAVE_DEBOUNCE_MS);
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: L.addTaskList }).textContent).not.toContain(
      target.name,
    );
  });

  it("saves what was typed when the task closes before the pause ends", () => {
    vi.useFakeTimers();
    const { task, onSave, unmount } = renderDetail();

    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "Half typed" } });
    unmount();

    expect(onSave).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "Half typed" }));
  });

  it("does not save a read-only task", () => {
    const { onSave } = renderDetail({ readOnly: true });

    expect(screen.getByLabelText(L.addTaskName)).toHaveProperty("readOnly", true);
    expect(screen.getByLabelText(L.descriptionLabel)).toHaveProperty("readOnly", true);
    expect(screen.getByLabelText(L.addTaskPriority)).toHaveProperty("disabled", true);
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("when a newer copy of the task arrives (#1858)", () => {
    it("keeps what the person typed when the same task is re-rendered", () => {
      const { task, rerender } = renderDetail();
      fireEvent.change(screen.getByLabelText(L.descriptionLabel), {
        target: { value: "Draft, not saved" },
      });

      // A sync rebuilds the task objects: same id, new identity.
      rerender({ task: { ...task } });
      expect(fieldValue(L.descriptionLabel)).toBe("Draft, not saved");

      // Another field of this task changed elsewhere.
      rerender({ task: { ...task, title: "Renamed elsewhere" } });
      expect(fieldValue(L.descriptionLabel)).toBe("Draft, not saved");
      expect(fieldValue(L.addTaskName)).toBe("Renamed elsewhere");
    });

    it("keeps an edited field when the same field changed elsewhere", () => {
      const { task, rerender } = renderDetail();
      fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "My title" } });

      rerender({ task: { ...task, title: "Their title", description: "Their notes" } });

      expect(fieldValue(L.addTaskName)).toBe("My title");
      expect(fieldValue(L.descriptionLabel)).toBe("Their notes");
    });

    it("mirrors the task once it becomes read-only", () => {
      const { task, rerender } = renderDetail();
      fireEvent.change(screen.getByLabelText(L.addTaskName), {
        target: { value: "Cannot be saved" },
      });

      rerender({ task: { ...task }, readOnly: true });

      expect(fieldValue(L.addTaskName)).toBe(task.title);
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

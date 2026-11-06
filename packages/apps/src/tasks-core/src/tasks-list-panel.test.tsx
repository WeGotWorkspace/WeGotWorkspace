import type React from "react";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksListPanel, type TasksListPanelProps } from "@/tasks-core/src/tasks-list-panel";
import { TasksListRow } from "@/tasks-core/src/tasks-list-row";
import type { Task } from "@/tasks-core/src/tasks-types";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createTasksAppBootstrap();
const L = defaultTasksLabels;
const lists = bootstrap.data.taskLists;

function taskById(id: string): Task {
  const task = bootstrap.data.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`missing fixture task ${id}`);
  return task;
}

function renderRow(task: Task, overrides: Partial<React.ComponentProps<typeof TasksListRow>> = {}) {
  const onToggleComplete = vi.fn();
  const onDeleteTask = vi.fn();
  render(
    <TooltipProvider>
      <TasksListRow
        task={task}
        L={L}
        taskList={lists.find((list) => list.id === task.taskListId)}
        taskLists={lists}
        canMutate
        isTouch={false}
        isExiting={false}
        dragging={false}
        onToggleComplete={onToggleComplete}
        onDeleteTask={onDeleteTask}
        onExitAnimationEnd={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  );
  const row = document.querySelector(".tasks-list-row") as HTMLElement;
  return { row, meta: row.querySelector(".tasks-list-row__meta") as HTMLElement, onToggleComplete };
}

function PanelHarness(props: Partial<TasksListPanelProps>) {
  const panel = TasksListPanel({
    L,
    sidebarOpen: false,
    onToggleSidebar: vi.fn(),
    viewLabel: "All Tasks",
    displayTasks: bootstrap.data.tasks.slice(0, 3),
    exitingTaskIds: new Set(),
    taskLists: lists,
    activeId: "",
    isTouch: false,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchInputRef: createRef(),
    showCompletedToggle: true,
    showCompletedTasks: false,
    onToggleShowCompleted: vi.fn(),
    listRefreshing: false,
    canCreate: true,
    quickAddRef: createRef(),
    onQuickAdd: vi.fn(),
    onOpenTask: vi.fn(),
    onToggleComplete: vi.fn(),
    onDeleteTask: vi.fn(),
    onTaskExitAnimationEnd: vi.fn(),
    itemDragHandlers: () => ({}),
    isItemDragging: () => false,
    ...props,
  });
  return <TooltipProvider>{panel.listTop}</TooltipProvider>;
}

beforeEach(() => {
  cleanup();
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

describe("TasksListRow", () => {
  it("shows the title, the notes excerpt and the list in the foot", () => {
    const task = { ...bootstrap.data.tasks[0]!, description: "Bring the forms" };
    const { row, meta } = renderRow(task);

    expect(row.textContent).toContain(task.title);
    expect(row.textContent).toContain("Bring the forms");
    const listName = lists.find((list) => list.id === task.taskListId)!.name;
    expect(meta.firstElementChild?.textContent).toBe(listName);
  });

  it("toggles complete from the circle without opening the task", () => {
    const task = bootstrap.data.tasks[0]!;
    const { onToggleComplete } = renderRow(task);
    const opened = vi.fn();
    document.addEventListener("click", opened);

    fireEvent.click(screen.getByRole("checkbox", { name: L.markComplete }));

    expect(onToggleComplete).toHaveBeenCalledWith(task.id);
    expect(opened).not.toHaveBeenCalled();
    document.removeEventListener("click", opened);
  });

  it("disables the circle on a view-only list", () => {
    renderRow(bootstrap.data.tasks[0]!, { canMutate: false });

    expect(screen.getByRole("checkbox", { name: L.markComplete })).toHaveProperty("disabled", true);
  });

  it("marks a completed task as checked", () => {
    const task = { ...bootstrap.data.tasks[0]!, workflowStatus: "completed" as const };
    const { row } = renderRow(task);

    expect(row.dataset.completed).toBe("true");
    expect(screen.getByRole("checkbox", { name: L.markIncomplete })).toHaveProperty(
      "ariaChecked",
      "true",
    );
  });

  it("shows due and priority only when set", () => {
    const bare = { ...bootstrap.data.tasks[0]!, due: null, priority: null };
    const { meta } = renderRow(bare);
    expect(meta.textContent).not.toContain(L.priorityHigh);
    expect(meta.querySelector(".lucide-calendar-days")).toBeNull();

    cleanup();
    const full = { ...bare, due: "2030-07-08", showWithoutTime: true, priority: 1 };
    const { meta: fullMeta } = renderRow(full);
    expect(fullMeta.textContent).toContain(L.priorityHigh);
    expect(fullMeta.querySelector(".lucide-calendar-days")).toBeTruthy();
    expect(fullMeta.querySelector(".tasks-priority-flag")).toBeTruthy();
  });

  it("shows a status only when it is in progress or cancelled", () => {
    const { meta } = renderRow({ ...bootstrap.data.tasks[0]!, workflowStatus: "needs-action" });
    expect(meta.textContent).not.toContain(L.stateNeedsAction);

    cleanup();
    const { meta: busy } = renderRow({
      ...bootstrap.data.tasks[0]!,
      workflowStatus: "in-process",
    });
    expect(busy.textContent).toContain(L.stateInProcess);
  });

  it("puts the reminder mark last", () => {
    const task = { ...taskById("task-two-reminders"), priority: 1, due: "2030-07-08" };
    const { meta } = renderRow(task);

    expect(meta.lastElementChild?.querySelector(".tasks-field__remind--row")).toBeTruthy();
    expect(meta.firstElementChild?.querySelector(".tasks-field__remind--row")).toBeNull();
  });
});

describe("TasksListPanel quick add", () => {
  it("adds a task from the title on Enter and clears the field", () => {
    const onQuickAdd = vi.fn();
    render(<PanelHarness onQuickAdd={onQuickAdd} />);
    const input = screen.getByLabelText(L.quickAddLabel) as HTMLInputElement;

    expect(input.placeholder).toBe(L.quickAddPlaceholder);
    fireEvent.change(input, { target: { value: "  Call the dentist  " } });
    fireEvent.submit(input.closest("form")!);

    expect(onQuickAdd).toHaveBeenCalledWith("Call the dentist");
    expect(input.value).toBe("");
  });

  it("ignores an empty title", () => {
    const onQuickAdd = vi.fn();
    render(<PanelHarness onQuickAdd={onQuickAdd} />);
    const input = screen.getByLabelText(L.quickAddLabel);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(onQuickAdd).not.toHaveBeenCalled();
  });

  it("is disabled when no list can take a new task", () => {
    render(<PanelHarness canCreate={false} />);

    expect(screen.getByLabelText(L.quickAddLabel)).toHaveProperty("disabled", true);
  });
});

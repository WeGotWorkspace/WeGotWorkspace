import type React from "react";
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksListPanel, type TasksListPanelProps } from "@/tasks-core/src/tasks-list-panel";
import { TasksListRow } from "@/tasks-core/src/tasks-list-row";
import { formatRelativeDay } from "@/lib/datetime/format-list-date";
import { formatTaskDueRelative } from "@/tasks-core/src/tasks-task-utils";
import type { Task } from "@/lib/models/tasks-types";
import { TooltipProvider } from "@/ui/tooltip";
import {
  TEST_VIEWPORT_ATTR,
  installListLayoutStubs,
} from "@/workspace-list/src/workspace-list-test-layout";

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
  return {
    row,
    meta: row.querySelector(".tasks-list-row__meta") as HTMLElement,
    corner: row.querySelector(".list-item__title-trailing") as HTMLElement | null,
    onToggleComplete,
  };
}

function panelFor(props: Partial<TasksListPanelProps>) {
  return TasksListPanel({
    L,
    sidebarOpen: false,
    onToggleSidebar: vi.fn(),
    viewLabel: "All Tasks",
    displayTasks: bootstrap.data.tasks.slice(0, 3),
    exitingTaskIds: new Set(),
    taskLists: lists,
    activeId: "",
    selectedIds: [],
    selectionMode: false,
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
    handleSelect: vi.fn(),
    enterSelectionFor: vi.fn(),
    onToggleComplete: vi.fn(),
    onDeleteTask: vi.fn(),
    onTaskExitAnimationEnd: vi.fn(),
    itemDragHandlers: () => ({}),
    isItemDragging: () => false,
    ...props,
  });
}

function PanelHarness(props: Partial<TasksListPanelProps>) {
  return <TooltipProvider>{panelFor(props).listTop}</TooltipProvider>;
}

/** The task rows inside a scrollport that jsdom's layout stubs give a height. */
function RowsHarness({
  scrollerRef,
  ...props
}: Partial<TasksListPanelProps> & { scrollerRef: (node: HTMLDivElement | null) => void }) {
  return (
    <TooltipProvider>
      <div ref={scrollerRef} style={{ overflowY: "auto" }} {...{ [TEST_VIEWPORT_ATTR]: "" }}>
        {panelFor(props).listContent}
      </div>
    </TooltipProvider>
  );
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

  it("shows the due day relative to today next to the list name", () => {
    const bare = { ...bootstrap.data.tasks[0]!, due: null, alerts: undefined };
    const { meta } = renderRow(bare);
    expect(meta.querySelector(".tasks-list-row__due")).toBeNull();

    cleanup();
    const today = new Date();
    const due = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    const { meta: dated } = renderRow({ ...bare, due, showWithoutTime: true });
    const dueItem = dated.querySelector(".tasks-list-row__due");
    expect(dueItem?.previousElementSibling).toBe(dated.firstElementChild);
    expect(dueItem?.textContent).toBe(
      `Due ${formatRelativeDay(today, today, { capitalised: false })}`,
    );
    expect(dueItem?.matches(".list-item__meta-segment")).toBe(true);
    expect(dated.firstElementChild?.matches(".list-item__meta-segment")).toBe(true);
  });

  it("colours the due day: today warns, an earlier day is an error, done is plain", () => {
    const bare = { ...bootstrap.data.tasks[0]!, alerts: undefined, showWithoutTime: true };
    const day = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    };
    const severity = (task: Task) => {
      cleanup();
      const { meta } = renderRow(task);
      return meta.querySelector<HTMLElement>(".tasks-list-row__due")?.dataset.severity;
    };

    expect(severity({ ...bare, due: day(0), workflowStatus: "needs-action" })).toBe("warn");
    expect(severity({ ...bare, due: day(-2), workflowStatus: "needs-action" })).toBe("error");
    expect(severity({ ...bare, due: day(3), workflowStatus: "needs-action" })).toBeUndefined();
    expect(severity({ ...bare, due: day(-2), workflowStatus: "completed" })).toBeUndefined();
  });

  it("always shows the priority flag in the top right corner, icon only", () => {
    const { corner, meta } = renderRow({ ...bootstrap.data.tasks[0]!, priority: 1 });

    const mark = screen.getByRole("img", { name: L.priorityHigh });
    expect(corner?.contains(mark)).toBe(true);
    expect(mark.textContent).toBe("");
    expect(meta.textContent).not.toContain(L.priorityHigh);

    cleanup();
    const { corner: none } = renderRow({ ...bootstrap.data.tasks[0]!, priority: null });
    const noneMark = screen.getByRole("img", { name: L.priorityNone });
    expect(none?.contains(noneMark)).toBe(true);
    expect(noneMark.querySelector("svg")).not.toBeNull();
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

  it("puts the reminder bell before the priority flag in the top right corner", () => {
    const task = { ...taskById("task-two-reminders"), priority: 1, due: "2030-07-08" };
    const { meta, corner } = renderRow(task);

    const marks = corner?.querySelector(".tasks-list-row__marks");
    expect(marks?.firstElementChild?.matches(".tasks-field__remind--row")).toBe(true);
    expect(marks?.lastElementChild?.matches(".tasks-priority-mark")).toBe(true);
    expect(meta.querySelector(".tasks-field__remind--row")).toBeNull();
    expect(meta.querySelector(".tasks-list-row__due")?.textContent).toBe(
      formatTaskDueRelative("2030-07-08", L),
    );
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

describe("TasksListPanel window", () => {
  const tasks: Task[] = Array.from({ length: 120 }, (_, index) => ({
    ...bootstrap.data.tasks[0]!,
    id: `task-${index}`,
    title: `Task ${String(index).padStart(3, "0")}`,
  }));

  beforeEach(() => {
    installListLayoutStubs(400);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(props: Partial<TasksListPanelProps> = {}) {
    const holder: { current: HTMLDivElement | null } = { current: null };
    const view = render(
      <RowsHarness
        displayTasks={tasks}
        scrollerRef={(node) => {
          holder.current = node;
        }}
        {...props}
      />,
    );
    const scroller = holder.current;
    if (!scroller) throw new Error("scroller missing");
    return { scroller, ...view };
  }

  function scrollTo(scroller: HTMLElement, top: number) {
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
    });
  }

  const mountedIds = (root: ParentNode) =>
    Array.from(root.querySelectorAll("[data-list-item-id]"), (node) =>
      node.getAttribute("data-list-item-id"),
    );

  it("mounts only the rows near the scrollport", () => {
    const { scroller } = mount();
    const list = scroller.querySelector("[data-workspace-list-rows]");

    expect(list?.getAttribute("data-workspace-list-rows")).toBe("120");
    expect(mountedIds(scroller).length).toBeLessThan(40);

    scrollTo(scroller, 4000);
    const ids = mountedIds(scroller);
    expect(ids).not.toContain("task-0");
    expect(ids).toContain("task-50");
    expect(ids.length).toBeLessThan(40);
  });

  it("keeps the open task mounted when the list scrolls away from it", () => {
    const { scroller } = mount({ activeId: "task-2", selectedIds: ["task-2"] });

    scrollTo(scroller, 6000);

    expect(mountedIds(scroller)).toContain("task-2");
  });

  it("keeps an exiting row mounted until its exit animation ends", () => {
    const onTaskExitAnimationEnd = vi.fn();
    const { scroller } = mount({
      exitingTaskIds: new Set(["task-1"]),
      onTaskExitAnimationEnd,
    });

    scrollTo(scroller, 6000);
    const exiting = scroller
      .querySelector('[data-list-item-id="task-1"]')
      ?.closest(".tasks-list-row");
    expect(exiting?.getAttribute("data-exiting")).toBe("true");

    expect(onTaskExitAnimationEnd).not.toHaveBeenCalled();
    // jsdom has no AnimationEvent, so React listens for the prefixed event there.
    const ended = new Event("webkitAnimationEnd", { bubbles: true });
    Object.defineProperty(ended, "animationName", { value: "tasks-row-exit" });
    fireEvent(exiting!, ended);
    expect(onTaskExitAnimationEnd).toHaveBeenCalledWith("task-1");
  });
});

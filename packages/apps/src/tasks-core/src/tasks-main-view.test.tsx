import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksMainView } from "@/tasks-core/src/tasks-main-view";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TASK_PRIORITY_FLAG_COLORS } from "@/tasks-core/src/tasks-priority";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";

function taskTitleForTest(title: string | null | undefined): string {
  if (!title) throw new Error("expected task title in fixture");
  return title;
}

const bootstrap = createTasksAppBootstrap();

/** Reproduces global svg { stroke: currentColor } rules that mute Lucide attrs in meta. */
function installSvgCurrentColorOverride(): void {
  const style = document.createElement("style");
  style.setAttribute("data-testid", "svg-current-color-override");
  style.textContent = "svg { stroke: currentColor; }";
  document.head.appendChild(style);
}

function installPriorityFlagStyles(): void {
  const style = document.createElement("style");
  style.setAttribute("data-testid", "tasks-priority-flag-styles");
  style.textContent = `
    .tasks-priority-flag svg {
      stroke: var(--tasks-priority-flag-stroke) !important;
      fill: var(--tasks-priority-flag-fill) !important;
    }
  `;
  document.head.appendChild(style);
}

function normalizedStrokeColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  return probe.style.color;
}

function expectPriorityFlagStroke(flag: SVGElement | null | undefined, color: string): void {
  expect(flag).toBeTruthy();
  const wrapper = flag!.closest(".tasks-priority-flag") as HTMLElement | null;
  expect(wrapper?.style.getPropertyValue("--tasks-priority-flag-stroke")).toBe(color);
  expect(flag!.style.stroke).not.toBe("");
}

function renderMainView(
  overrides: Partial<React.ComponentProps<typeof TasksMainView>> = {},
  onCreateTask = vi.fn(),
) {
  return render(
    <TooltipProvider>
      <TasksMainView
        L={defaultTasksLabels}
        displayTasks={[]}
        exitingTaskIds={new Set<string>()}
        taskLists={bootstrap.data.taskLists}
        defaultListId="default"
        view="state:all"
        canCreate
        onToggleComplete={vi.fn()}
        onEditTask={vi.fn()}
        onDeleteTask={vi.fn()}
        onCreateTask={onCreateTask}
        onTaskExitAnimationEnd={vi.fn()}
        itemDragHandlers={() => ({})}
        isItemDragging={() => false}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

function renderComposer(onCreateTask = vi.fn()) {
  return renderMainView({}, onCreateTask);
}

function calendarDataDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function selectComposerDueDay(dayOffset: number, now = new Date()): void {
  const targetDay = new Date(now);
  targetDay.setDate(targetDay.getDate() + dayOffset);
  const dayButton = document.querySelector(`button[data-day="${calendarDataDay(targetDay)}"]`);
  expect(dayButton).toBeTruthy();
  fireEvent.click(dayButton!);
}

describe("TasksMainView composer", () => {
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

  it("keeps description editable after title blur", () => {
    renderComposer();

    const title = screen.getByLabelText(defaultTasksLabels.addTaskName);
    fireEvent.focus(title);

    const description = screen.getByLabelText(defaultTasksLabels.descriptionLabel);
    fireEvent.blur(title);
    fireEvent.change(description, { target: { value: "Follow up tomorrow" } });

    expect((description as HTMLTextAreaElement).value).toBe("Follow up tomorrow");
  });

  it("opens edit when clicking the task row body", () => {
    const onEditTask = vi.fn();
    const onToggleComplete = vi.fn();
    const task = bootstrap.data.tasks[0];
    renderMainView({ displayTasks: [task], onEditTask, onToggleComplete });

    fireEvent.click(screen.getByText(taskTitleForTest(task.title)));

    expect(onEditTask).toHaveBeenCalledTimes(1);
    expect(onEditTask).toHaveBeenCalledWith(task.id);
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it("toggles complete when clicking the checkbox", () => {
    const onToggleComplete = vi.fn();
    const onEditTask = vi.fn();
    const task = bootstrap.data.tasks[0];
    renderMainView({ displayTasks: [task], onToggleComplete, onEditTask });

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.markComplete }));

    expect(onToggleComplete).toHaveBeenCalledTimes(1);
    expect(onToggleComplete).toHaveBeenCalledWith(task.id);
    expect(onEditTask).not.toHaveBeenCalled();
  });

  it("does not open edit when clicking task actions", () => {
    const onEditTask = vi.fn();
    const onToggleComplete = vi.fn();
    const task = bootstrap.data.tasks[0];
    renderMainView({ displayTasks: [task], onEditTask, onToggleComplete });

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.taskActions }));

    expect(onEditTask).not.toHaveBeenCalled();
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it("submits description with createTask when filled", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "New task" },
    });
    fireEvent.focus(screen.getByLabelText(defaultTasksLabels.addTaskName));

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.descriptionLabel), {
      target: { value: "Details here" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.addTaskButton }));

    expect(onCreateTask).toHaveBeenCalledWith({
      title: "New task",
      description: "Details here",
      listId: "default",
      workflowStatus: "needs-action",
      priority: 0,
      due: null,
    });
  });

  it("submits task when pressing Enter in description with non-empty title", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "New task" },
    });
    fireEvent.focus(screen.getByLabelText(defaultTasksLabels.addTaskName));

    const description = screen.getByLabelText(defaultTasksLabels.descriptionLabel);
    fireEvent.change(description, { target: { value: "Details here" } });
    fireEvent.keyDown(description, { key: "Enter", shiftKey: false });

    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onCreateTask).toHaveBeenCalledWith({
      title: "New task",
      description: "Details here",
      listId: "default",
      workflowStatus: "needs-action",
      priority: 0,
      due: null,
    });
    expect((screen.getByLabelText(defaultTasksLabels.addTaskName) as HTMLInputElement).value).toBe(
      "",
    );
    expect(screen.queryByLabelText(defaultTasksLabels.descriptionLabel)).toBeNull();
  });

  it("does not submit when pressing Enter in description with empty title", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.focus(screen.getByLabelText(defaultTasksLabels.addTaskName));

    const description = screen.getByLabelText(defaultTasksLabels.descriptionLabel);
    fireEvent.change(description, { target: { value: "Details only" } });
    fireEvent.keyDown(description, { key: "Enter", shiftKey: false });

    expect(onCreateTask).not.toHaveBeenCalled();
    expect((description as HTMLTextAreaElement).value).toBe("Details only");
  });

  it("allows newline when pressing Shift+Enter in description", () => {
    renderComposer();

    fireEvent.focus(screen.getByLabelText(defaultTasksLabels.addTaskName));

    const description = screen.getByLabelText(defaultTasksLabels.descriptionLabel);
    fireEvent.change(description, { target: { value: "Line one" } });
    fireEvent.keyDown(description, { key: "Enter", shiftKey: true });
    fireEvent.change(description, { target: { value: "Line one\nLine two" } });

    expect((description as HTMLTextAreaElement).value).toBe("Line one\nLine two");
  });

  it("shows a plus icon marker in the composer instead of a checkbox", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: defaultTasksLabels.markComplete })).toBeNull();

    const composer = document.querySelector(".tasks-main-view__composer");
    const marker = composer?.querySelector(".tasks-main-view__composer-marker svg");
    expect(marker).toBeTruthy();
    expect(marker?.classList.contains("lucide-plus")).toBe(true);
  });

  it("defaults status to needs action in the composer", () => {
    renderComposer();

    const statusTrigger = screen.getByLabelText(defaultTasksLabels.addTaskStatus);
    expect(statusTrigger.textContent).toContain(defaultTasksLabels.stateNeedsAction);
    expect(statusTrigger.querySelector(".lucide-clock")).toBeTruthy();
  });

  it("shows only needs-action and in-process in the composer status dropdown", () => {
    renderComposer();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskStatus));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultTasksLabels.stateNeedsAction,
      defaultTasksLabels.stateInProcess,
    ]);

    expect(
      screen
        .getByRole("option", { name: defaultTasksLabels.stateNeedsAction })
        .querySelector(".lucide-clock"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("option", { name: defaultTasksLabels.stateInProcess })
        .querySelector(".lucide-circle-dot"),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: defaultTasksLabels.stateCompleted })).toBeNull();
    expect(screen.queryByRole("option", { name: defaultTasksLabels.stateCancelled })).toBeNull();
  });

  it("submits selected workflowStatus with createTask", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "In progress task" },
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskStatus));
    fireEvent.click(screen.getByRole("option", { name: defaultTasksLabels.stateInProcess }));

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.addTaskButton }));

    expect(onCreateTask).toHaveBeenCalledWith({
      title: "In progress task",
      description: "",
      listId: "default",
      workflowStatus: "in-process",
      priority: 0,
      due: null,
    });
  });

  it("defaults priority to none in the composer", () => {
    installSvgCurrentColorOverride();
    renderComposer();

    const priorityTrigger = screen.getByLabelText(defaultTasksLabels.addTaskPriority);
    const flag = priorityTrigger.querySelector(".tasks-priority-flag svg") as SVGElement | null;
    expect(priorityTrigger.textContent).toContain(defaultTasksLabels.priorityNone);
    expect(flag).toBeTruthy();
    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.none);
  });

  it("shows high priority flag color in composer after selection", () => {
    installSvgCurrentColorOverride();
    renderComposer();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskPriority));
    fireEvent.click(screen.getByRole("option", { name: defaultTasksLabels.priorityHigh }));

    const priorityTrigger = screen.getByLabelText(defaultTasksLabels.addTaskPriority);
    const flag = priorityTrigger.querySelector(".tasks-priority-flag svg") as SVGElement | null;
    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
  });

  it("shows only none, high, medium, and low in the composer priority dropdown", () => {
    renderComposer();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskPriority));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultTasksLabels.priorityNone,
      defaultTasksLabels.priorityHigh,
      defaultTasksLabels.priorityMedium,
      defaultTasksLabels.priorityLow,
    ]);
  });

  it("submits selected priority with createTask", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "Urgent task" },
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskPriority));
    fireEvent.click(screen.getByRole("option", { name: defaultTasksLabels.priorityHigh }));

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.addTaskButton }));

    expect(onCreateTask).toHaveBeenCalledWith({
      title: "Urgent task",
      description: "",
      listId: "default",
      workflowStatus: "needs-action",
      priority: 1,
      due: null,
    });
  });

  it("defaults due date to none in the composer", () => {
    renderComposer();

    const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
    expect(dueTrigger.textContent).toContain(defaultTasksLabels.noDue);
    expect(dueTrigger.querySelector(".lucide-calendar-days")).toBeTruthy();
  });

  describe("composer due date by view", () => {
    const mockedNow = new Date(2026, 6, 8, 12, 0, 0);

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockedNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("prefills due date to today on today view", () => {
      renderMainView({ view: "state:today" });

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueToday);
    });

    it("prefills due date to tomorrow on upcoming view", () => {
      renderMainView({ view: "state:upcoming" });

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueTomorrow);
    });

    it("prefills due date to yesterday on overdue view", () => {
      renderMainView({ view: "state:overdue", canCreate: true });

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueYesterday);
    });

    it("clears view-prefilled due when switching away from today view", () => {
      const { rerender } = renderMainView({ view: "state:today" });

      expect(screen.getByLabelText(defaultTasksLabels.addTaskDue).textContent).toContain(
        defaultTasksLabels.dueToday,
      );

      rerender(
        <TooltipProvider>
          <TasksMainView
            L={defaultTasksLabels}
            displayTasks={[]}
            exitingTaskIds={new Set<string>()}
            taskLists={bootstrap.data.taskLists}
            defaultListId="default"
            view="state:all"
            canCreate
            onToggleComplete={vi.fn()}
            onEditTask={vi.fn()}
            onDeleteTask={vi.fn()}
            onCreateTask={vi.fn()}
            onTaskExitAnimationEnd={vi.fn()}
            itemDragHandlers={() => ({})}
            isItemDragging={() => false}
          />
        </TooltipProvider>,
      );

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.noDue);
    });
  });

  it("keeps composer fields enabled on overdue view", () => {
    renderMainView({ view: "state:overdue", canCreate: true });

    expect(
      (screen.getByLabelText(defaultTasksLabels.addTaskName) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText(defaultTasksLabels.addTaskDue) as HTMLButtonElement).disabled,
    ).toBe(false);

    const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
    const listTrigger = screen.getByLabelText(defaultTasksLabels.addTaskList);
    const dueStyles = window.getComputedStyle(dueTrigger);
    const listStyles = window.getComputedStyle(listTrigger);

    expect(dueStyles.opacity).toBe(listStyles.opacity);
    expect(dueStyles.color).toBe(listStyles.color);
    expect(dueStyles.backgroundColor).toBe(listStyles.backgroundColor);
  });

  describe("composer due date labels", () => {
    const mockedNow = new Date(2026, 6, 8, 12, 0, 0);

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockedNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows Today when due date is today", () => {
      renderComposer();

      fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
      selectComposerDueDay(0, mockedNow);

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueToday);
    });

    it("shows Yesterday when due date is yesterday", () => {
      renderComposer();

      fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
      selectComposerDueDay(-1, mockedNow);

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueYesterday);
    });

    it("shows Tomorrow when due date is tomorrow", () => {
      renderComposer();

      fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
      selectComposerDueDay(1, mockedNow);

      const dueTrigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
      expect(dueTrigger.textContent).toContain(defaultTasksLabels.dueTomorrow);
    });
  });

  it("renders due date before list, status, and priority in the composer", () => {
    renderComposer();

    const meta = document.querySelector(".tasks-main-view__composer-meta");
    expect(meta).toBeTruthy();

    const controls = meta!.querySelectorAll(
      "button[aria-label], button.select-trigger[aria-label]",
    );
    const labels = Array.from(controls).map((control) => control.getAttribute("aria-label"));

    expect(labels).toEqual([
      defaultTasksLabels.addTaskDue,
      defaultTasksLabels.addTaskList,
      defaultTasksLabels.addTaskStatus,
      defaultTasksLabels.addTaskPriority,
    ]);
  });

  it("submits optional due date with createTask when selected", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "Due task" },
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));

    const targetDay = new Date();
    targetDay.setDate(targetDay.getDate() + 3);
    const dataDay = `${targetDay.getMonth() + 1}/${targetDay.getDate()}/${targetDay.getFullYear()}`;
    const dayButton = document.querySelector(`button[data-day="${dataDay}"]`);
    expect(dayButton).toBeTruthy();
    fireEvent.click(dayButton!);

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.addTaskButton }));

    const expectedDue = `${targetDay.getFullYear()}-${String(targetDay.getMonth() + 1).padStart(2, "0")}-${String(targetDay.getDate()).padStart(2, "0")}T00:00:00`;

    expect(onCreateTask).toHaveBeenCalledWith({
      title: "Due task",
      description: "",
      listId: "default",
      workflowStatus: "needs-action",
      priority: 0,
      due: expectedDue,
    });
  });

  it("clears selected due date from the composer", () => {
    const onCreateTask = vi.fn();
    renderComposer(onCreateTask);

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.addTaskName), {
      target: { value: "Clear due task" },
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));

    const targetDay = new Date();
    targetDay.setDate(targetDay.getDate() + 5);
    const dataDay = `${targetDay.getMonth() + 1}/${targetDay.getDate()}/${targetDay.getFullYear()}`;
    const dayButton = document.querySelector(`button[data-day="${dataDay}"]`);
    expect(dayButton).toBeTruthy();
    fireEvent.click(dayButton!);

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.noDue }));

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.addTaskButton }));

    expect(onCreateTask).toHaveBeenCalledWith({
      title: "Clear due task",
      description: "",
      listId: "default",
      workflowStatus: "needs-action",
      priority: 0,
      due: null,
    });
  });
});

describe("TasksMainView task rows", () => {
  beforeEach(() => {
    cleanup();
    document.head
      .querySelectorAll(
        '[data-testid="svg-current-color-override"], [data-testid="tasks-priority-flag-styles"]',
      )
      .forEach((node) => node.remove());
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

  it("shows workflow status icon and label on task rows", () => {
    const task = bootstrap.data.tasks.find((item) => item.workflowStatus === "in-process")!;
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    expect(row).toBeTruthy();
    const meta = row?.querySelector(".tasks-main-view__meta");
    expect(meta?.textContent).toContain(defaultTasksLabels.stateInProcess);
    expect(meta?.querySelector(".lucide-circle-dot")).toBeTruthy();
  });

  it("defaults missing workflowStatus to needs action on task rows", () => {
    const task = { ...bootstrap.data.tasks[0], workflowStatus: undefined };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    expect(meta?.textContent).toContain(defaultTasksLabels.stateNeedsAction);
    expect(meta?.querySelector(".lucide-clock")).toBeTruthy();
  });

  it("shows priority flag only in meta when task has priority", () => {
    installSvgCurrentColorOverride();
    const task = { ...bootstrap.data.tasks[0], priority: 1 };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    const flag = meta?.querySelector(".tasks-priority-flag svg") as SVGElement | null;
    expect(meta?.textContent).not.toContain(defaultTasksLabels.priorityHigh);
    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
    expect(meta?.querySelector(`[aria-label="${defaultTasksLabels.priorityHigh}"]`)).toBeTruthy();
  });

  it("shows priority flag on newly created optimistic task rows", () => {
    installSvgCurrentColorOverride();
    const task = {
      ...bootstrap.data.tasks[0],
      id: "pending-new-task",
      title: "Urgent task",
      priority: 1,
      workflowStatus: "needs-action" as const,
    };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    const flag = meta?.querySelector(".tasks-priority-flag svg") as SVGElement | null;

    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
    expect(meta?.querySelector(`[aria-label="${defaultTasksLabels.priorityHigh}"]`)).toBeTruthy();
  });

  it("shows due date label on task rows when due is set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0));

    const task = {
      ...bootstrap.data.tasks[0],
      due: "2026-07-08T00:00:00",
    };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    expect(meta?.textContent).toContain(defaultTasksLabels.dueToday);
    expect(meta?.querySelector(".lucide-calendar-days")).toBeTruthy();

    vi.useRealTimers();
  });

  it("shows due date and priority on newly created optimistic task rows", () => {
    installSvgCurrentColorOverride();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0));

    const task = {
      ...bootstrap.data.tasks[0],
      id: "pending-new-task",
      title: "Due today urgent",
      due: "2026-07-08T00:00:00",
      priority: 1,
      workflowStatus: "needs-action" as const,
    };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    const flag = meta?.querySelector(".tasks-priority-flag svg") as SVGElement | null;

    expect(meta?.textContent).toContain(defaultTasksLabels.dueToday);
    expect(meta?.querySelector(".lucide-calendar-days")).toBeTruthy();
    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
    expect(meta?.querySelector(`[aria-label="${defaultTasksLabels.priorityHigh}"]`)).toBeTruthy();

    vi.useRealTimers();
  });

  it("shows medium and low priority flags in task row meta", () => {
    installSvgCurrentColorOverride();
    const mediumTask = { ...bootstrap.data.tasks[0], id: "task-medium", priority: 5 };
    const lowTask = { ...bootstrap.data.tasks[1], id: "task-low", priority: 9 };

    renderMainView({ displayTasks: [mediumTask, lowTask] });

    const mediumRow = screen
      .getByText(taskTitleForTest(mediumTask.title))
      .closest(".tasks-main-view__row");
    const lowRow = screen
      .getByText(taskTitleForTest(lowTask.title))
      .closest(".tasks-main-view__row");
    const mediumFlag = mediumRow?.querySelector(".tasks-priority-flag svg") as SVGElement | null;
    const lowFlag = lowRow?.querySelector(".tasks-priority-flag svg") as SVGElement | null;

    expectPriorityFlagStroke(mediumFlag, TASK_PRIORITY_FLAG_COLORS.medium);
    expectPriorityFlagStroke(lowFlag, TASK_PRIORITY_FLAG_COLORS.low);
    expect(
      mediumRow?.querySelector(`[aria-label="${defaultTasksLabels.priorityMedium}"]`),
    ).toBeTruthy();
    expect(lowRow?.querySelector(`[aria-label="${defaultTasksLabels.priorityLow}"]`)).toBeTruthy();
  });

  it("enforces priority flag stroke over meta currentColor inheritance", () => {
    installSvgCurrentColorOverride();
    installPriorityFlagStyles();
    const task = { ...bootstrap.data.tasks[0], priority: 1 };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta") as HTMLElement | null;
    const flag = meta?.querySelector(".tasks-priority-flag svg") as SVGElement | null;

    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
    expect(normalizedStrokeColor(window.getComputedStyle(flag!).stroke)).toBe(
      normalizedStrokeColor(TASK_PRIORITY_FLAG_COLORS.high),
    );
    expect(window.getComputedStyle(flag!).stroke).not.toBe(window.getComputedStyle(meta!).color);
  });

  it("hides priority meta when task priority is none", () => {
    const task = { ...bootstrap.data.tasks[0], priority: null };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    expect(meta?.querySelector(".tasks-priority-flag")).toBeNull();
    expect(meta?.textContent).not.toContain(defaultTasksLabels.priorityHigh);
    expect(meta?.textContent).not.toContain(defaultTasksLabels.priorityMedium);
    expect(meta?.textContent).not.toContain(defaultTasksLabels.priorityLow);
  });

  it("shows colored flag for legacy inverted API priority values", () => {
    installSvgCurrentColorOverride();
    const task = { ...bootstrap.data.tasks[0], priority: 10 };
    renderMainView({ displayTasks: [task] });

    const row = screen.getByText(taskTitleForTest(task.title)).closest(".tasks-main-view__row");
    const meta = row?.querySelector(".tasks-main-view__meta");
    const flag = meta?.querySelector(".tasks-priority-flag svg") as SVGElement | null;
    expectPriorityFlagStroke(flag, TASK_PRIORITY_FLAG_COLORS.high);
  });

  it("does not open edit when clicking task actions", () => {
    const onEditTask = vi.fn();
    const onToggleComplete = vi.fn();
    const task = bootstrap.data.tasks[0];
    renderMainView({ displayTasks: [task], onEditTask, onToggleComplete });

    const row = screen
      .getByText(taskTitleForTest(task.title))
      .closest(".tasks-main-view__row") as HTMLElement;
    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.taskActions }));

    expect(onEditTask).not.toHaveBeenCalled();
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it("keeps actions visible while the menu trigger is open", () => {
    const style = document.createElement("style");
    style.setAttribute("data-testid", "tasks-actions-visibility-styles");
    style.textContent = `
      .tasks-main-view__actions { opacity: 0; }
      .tasks-main-view__actions:has([data-state="open"]) { opacity: 1; }
    `;
    document.head.appendChild(style);

    const task = bootstrap.data.tasks[0];
    renderMainView({ displayTasks: [task] });

    const row = screen
      .getByText(taskTitleForTest(task.title))
      .closest(".tasks-main-view__row") as HTMLElement;
    const actions = row.querySelector(".tasks-main-view__actions") as HTMLElement;
    const actionsButton = screen.getByRole("button", { name: defaultTasksLabels.taskActions });

    expect(window.getComputedStyle(actions).opacity).toBe("0");

    actionsButton.setAttribute("data-state", "open");

    expect(window.getComputedStyle(actions).opacity).toBe("1");
    expect(screen.getByRole("button", { name: defaultTasksLabels.taskActions })).toBeTruthy();

    style.remove();
  });
});

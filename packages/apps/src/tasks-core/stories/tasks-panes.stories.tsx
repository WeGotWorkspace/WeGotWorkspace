import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksDetailView } from "@/tasks-core/src/tasks-detail-view";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { tasksStoryOperations } from "@/tasks-core/stories/tasks-story-shared";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";
import "@/workspace-app/src/workspace-app.css";

const L = defaultTasksLabels;

function TasksPanesHarness() {
  const bootstrap = createTasksAppBootstrap();
  return (
    <TasksStoryScope>
      <TasksWorkspace
        data={bootstrap.data}
        session={bootstrap.session}
        operations={tasksStoryOperations}
        initialView="state:all"
      />
    </TasksStoryScope>
  );
}

function rowFor(canvasElement: HTMLElement, title: string): HTMLElement {
  const row = Array.from(canvasElement.querySelectorAll<HTMLElement>(".tasks-list-row")).find(
    (item) => item.querySelector(".list-item__title")?.textContent === title,
  );
  if (!row) throw new Error(`no row for ${title}`);
  return row;
}

/** The list column, then the open task: the Notes layout with a complete circle per row. */
async function playListAndDetail(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvasElement.querySelector(".tasks-list-row")).toBeTruthy());

  // Quick add above the rows; search floats at the bottom of the column.
  const quickAdd = canvas.getByLabelText(L.quickAddLabel);
  expect(quickAdd.getAttribute("placeholder")).toBe(L.quickAddPlaceholder);
  expect(canvas.getByPlaceholderText(L.searchPlaceholder)).toBeTruthy();

  // A row: the circle sits outside the row button (no nested buttons), level with the title.
  const row = rowFor(canvasElement, "Buy milk");
  const circle = row.querySelector<HTMLElement>(".tasks-list-row__complete")!;
  expect(circle).toBeTruthy();
  expect(circle.closest("button.list-item__button")).toBeNull();
  const title = row.querySelector(".list-item__title")!.getBoundingClientRect();
  const box = circle.getBoundingClientRect();
  expect(Math.abs(box.top + box.height / 2 - (title.top + title.height / 2))).toBeLessThan(3);
  expect(box.right).toBeLessThan(title.left);
  expect(row.querySelector(".tasks-list-row__meta")?.textContent).toBeTruthy();

  // Nothing open yet.
  expect(canvas.getByText(L.selectTask)).toBeTruthy();

  // An open task's circle: a dimmed ring, half a pixel heavier than the 1px border.
  expect(getComputedStyle(circle).boxShadow).toContain("inset");
  expect(getComputedStyle(circle).backgroundColor).toBe("rgba(0, 0, 0, 0)");

  await userEvent.click(row.querySelector(".list-item__button")!);
  const detailTitle = await waitFor(() => canvas.getByLabelText(L.addTaskName));
  expect((detailTitle as HTMLTextAreaElement).value).toBe("Buy milk");
  await waitFor(() =>
    expect(row.querySelector(".list-item__button")).toHaveAttribute("data-active", "true"),
  );

  // The open task reads like an open note: no card around it, then one row per field.
  const sheet = canvasElement.querySelector<HTMLElement>(".tasks-detail-view.paper-sheet")!;
  expect(getComputedStyle(sheet).boxShadow).toBe("none");
  const fields = sheet.querySelectorAll(".tasks-detail-view__field");
  expect(fields).toHaveLength(5);
  expect(
    Array.from(fields).map((field) => field.querySelector(".card__row-title")?.textContent),
  ).toEqual([L.addTaskStatus, L.dueLabel, L.dueAllDay, L.addTaskPriority, L.detailAlarm(1)]);
  for (const field of Array.from(fields)) {
    expect(getComputedStyle(field).borderBottomStyle).toBe("solid");
    // Each value is the shared ghost dropdown (no chrome), its label at the same size;
    // All day is a switch.
    if (field.querySelector('[role="switch"]')) continue;
    const ghost = field.querySelector<HTMLElement>(".collection-ghost-select")!;
    expect(getComputedStyle(ghost).borderTopWidth).toBe("0px");
    expect(getComputedStyle(field.querySelector(".card__row-title")!).fontSize).toBe(
      getComputedStyle(ghost).fontSize,
    );
  }
  expect(canvas.getByRole("combobox", { name: L.addTaskList })).toBeTruthy();
}

const meta = {
  title: "Features/Tasks/Panes",
  component: TasksPanesHarness,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "desktop" },
  },
} satisfies Meta<typeof TasksPanesHarness>;

export default meta;
type Story = StoryObj<typeof TasksPanesHarness>;

export const ListAndDetail: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    await playListAndDetail(canvasElement);
  },
};

export const ListAndDetailDark: Story = {
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    await playListAndDetail(canvasElement);
  },
};

/** Multi-select, as in Notes: Cmd-click adds a row, the detail shows the selection. */
async function playMultiSelect(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvasElement.querySelector(".tasks-list-row")).toBeTruthy());

  // The quick add field has no box.
  const quickAdd = canvas.getByLabelText(L.quickAddLabel);
  expect(getComputedStyle(quickAdd).borderTopColor).toBe("rgba(0, 0, 0, 0)");

  // Top right: the reminder bell, then the priority flag, icons only. The relative due
  // day sits in the foot, after the list name.
  const marked = rowFor(canvasElement, "Prep launch notes");
  const corner = marked.querySelector(".list-item__title-trailing")!;
  expect(corner.querySelector(".tasks-field__remind--row")).toBeTruthy();
  expect(corner.querySelector(".tasks-priority-mark")).toBeTruthy();
  expect(marked.querySelector(".tasks-list-row__due")?.textContent).toMatch(/^Due /);

  const first = rowFor(canvasElement, "Buy milk");
  const second = rowFor(canvasElement, "Review API spec");
  // One session, so the held Meta key reaches the second click.
  const user = userEvent.setup();
  await user.click(first.querySelector(".list-item__button")!);
  await user.keyboard("{Meta>}");
  await user.click(second.querySelector(".list-item__button")!);
  await user.keyboard("{/Meta}");

  await waitFor(() => expect(canvas.getByText(L.selectionTitle(2))).toBeTruthy());
  const pane = canvasElement.querySelector<HTMLElement>(".multi-selection-view")!;
  for (const label of [L.selectionComplete, L.selectionMoveToList, L.delete]) {
    expect(within(pane).getByRole("button", { name: label })).toBeTruthy();
  }
  expect(first.querySelector(".list-item__button")).toHaveAttribute("data-selected", "true");
  expect(second.querySelector(".list-item__button")).toHaveAttribute("data-selected", "true");
}

export const MultiSelect: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    await playMultiSelect(canvasElement);
  },
};

export const MultiSelectDark: Story = {
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    await playMultiSelect(canvasElement);
  },
};

function TasksDetailHarness({
  readOnly,
  onSave,
  onToggleComplete = () => {},
  taskId = "task-review-spec",
}: {
  readOnly: boolean;
  onSave: () => void;
  onToggleComplete?: (taskId: string) => void;
  taskId?: string;
}) {
  const bootstrap = createTasksAppBootstrap();
  const task = bootstrap.data.tasks.find((item) => item.id === taskId)!;
  return (
    <TasksStoryScope>
      <div className="tasks-workspace note-detail-desk flex min-h-dvh flex-col">
        <div className="workspace-detail-pane__scroll flex-1">
          <TasksDetailView
            task={task}
            L={L}
            taskLists={bootstrap.data.taskLists}
            allTaskLists={bootstrap.data.taskLists}
            readOnly={readOnly}
            onSave={onSave}
            onToggleComplete={onToggleComplete}
          />
        </div>
      </div>
    </TasksStoryScope>
  );
}

export const Detail: StoryObj<typeof TasksDetailHarness> = {
  tags: ["vitest-ci"],
  render: (args) => <TasksDetailHarness {...args} />,
  args: { readOnly: false, onSave: fn(), onToggleComplete: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // The done box sits left of the title, its top on the top of the capitals.
    const box = canvas.getByRole("checkbox", { name: L.markComplete });
    const title = canvas.getByLabelText(L.addTaskName);
    const boxRect = box.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    expect(boxRect.right).toBeLessThanOrEqual(titleRect.left);
    expect(boxRect.top).toBeGreaterThan(titleRect.top);
    expect(boxRect.bottom).toBeLessThan(
      titleRect.top + parseFloat(getComputedStyle(title).lineHeight) + 8,
    );
    await userEvent.click(box);
    expect(args.onToggleComplete).toHaveBeenCalledWith("task-review-spec");
    // A picked value saves at once; there is no Save button.
    await userEvent.click(canvas.getByLabelText(L.addTaskPriority));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: L.priorityLow }),
    );
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1));
    expect(canvas.queryByRole("button", { name: /save/i })).toBeNull();
  },
};

export const DetailReadOnly: StoryObj<typeof TasksDetailHarness> = {
  tags: ["vitest-ci"],
  render: (args) => <TasksDetailHarness {...args} />,
  args: { readOnly: true, onSave: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByLabelText(L.addTaskName)).toHaveProperty("readOnly", true);
    expect(canvas.getByLabelText(L.descriptionLabel)).toHaveProperty("readOnly", true);
    for (const name of [L.addTaskStatus, L.addTaskPriority, L.addTaskList]) {
      expect(canvas.getByRole("combobox", { name })).toHaveProperty("disabled", true);
    }
    // The done box is there but cannot be ticked.
    expect(canvas.getByRole("checkbox", { name: L.markComplete })).toBeDisabled();
  },
};

/** A done task: the box is ticked, and a click marks it incomplete again. */
async function playDetailCompleted(canvasElement: HTMLElement, onToggle: unknown) {
  const canvas = within(canvasElement);
  const box = canvas.getByRole("checkbox", { name: L.markIncomplete });
  await expect(box).toHaveAttribute("data-state", "checked");
  // Ticked, the box is filled with the selection mark, not left as a ring.
  await expect(getComputedStyle(box).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  await userEvent.click(box);
  await expect(onToggle).toHaveBeenCalledWith("task-done");
}

export const DetailCompleted: StoryObj<typeof TasksDetailHarness> = {
  tags: ["vitest-ci"],
  render: (args) => <TasksDetailHarness {...args} />,
  args: { readOnly: false, onSave: fn(), onToggleComplete: fn(), taskId: "task-done" },
  play: async ({ canvasElement, args }) => {
    await playDetailCompleted(canvasElement, args.onToggleComplete);
  },
};

export const DetailCompletedDark: StoryObj<typeof TasksDetailHarness> = {
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: (args) => <TasksDetailHarness {...args} />,
  args: { readOnly: false, onSave: fn(), onToggleComplete: fn(), taskId: "task-done" },
  play: async ({ canvasElement, args }) => {
    await playDetailCompleted(canvasElement, args.onToggleComplete);
  },
};

/**
 * The complete circle says what a click does in a tooltip. (Its hover look is CSS
 * `:hover`, which a scripted hover does not set; the app e2e checks that.)
 */
export const CompleteCheckboxTooltip: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector(".tasks-list-row")).toBeTruthy());
    const circle = rowFor(canvasElement, "Buy milk").querySelector<HTMLElement>(
      ".tasks-list-row__complete",
    )!;
    // The box keeps its own checked state; the tooltip trigger is the span around it.
    await expect(circle.dataset.state).toBe("unchecked");
    await userEvent.hover(circle);
    const tooltip = await within(document.body).findByRole("tooltip");
    await expect(tooltip.textContent).toBe(L.markComplete);
    await userEvent.unhover(circle);
  },
};

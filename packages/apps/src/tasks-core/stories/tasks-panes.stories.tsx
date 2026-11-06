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
  expect(fields).toHaveLength(4);
  expect(
    Array.from(fields).map((field) => field.querySelector(".card__row-title")?.textContent),
  ).toEqual([L.addTaskStatus, L.dueLabel, L.detailReminder, L.addTaskPriority]);
  for (const field of Array.from(fields)) {
    expect(getComputedStyle(field).borderBottomStyle).toBe("solid");
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

  // Reminder bell, then priority flag, then the relative due day: top right, icons only.
  const marked = rowFor(canvasElement, "Prep launch notes");
  const corner = marked.querySelector(".list-item__title-trailing")!;
  expect(corner.querySelector(".tasks-field__remind--row")).toBeTruthy();
  expect(corner.querySelector(".list-item__date")?.textContent).toBeTruthy();

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

function TasksDetailHarness({ readOnly, onSave }: { readOnly: boolean; onSave: () => void }) {
  const bootstrap = createTasksAppBootstrap();
  const task = bootstrap.data.tasks.find((item) => item.id === "task-review-spec")!;
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
          />
        </div>
      </div>
    </TasksStoryScope>
  );
}

export const Detail: StoryObj<typeof TasksDetailHarness> = {
  tags: ["vitest-ci"],
  render: (args) => <TasksDetailHarness {...args} />,
  args: { readOnly: false, onSave: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
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
  },
};

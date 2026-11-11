import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksImportDialog } from "@/tasks-core/src/tasks-import-dialog";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import type { Task, TaskImportResponse } from "@/lib/models/tasks-types";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const bootstrap = createTasksAppBootstrap();
const L = defaultTasksLabels;
const sampleFile = new File(["BEGIN:VCALENDAR"], "groceries.ics", { type: "text/calendar" });

const partialResult: TaskImportResponse = {
  list: bootstrap.data.tasks.slice(0, 3) as Task[],
  errors: [
    {
      index: 3,
      message: "exists",
      code: "already_exists",
      uid: "milk@example.test",
      title: "Buy milk",
    },
    { index: 4, message: "Minutely and secondly recurrence is not supported.", title: "Stretch" },
  ],
  skipped: { events: 2 },
};

const meta: Meta<typeof TasksImportDialog> = {
  title: "Features/Tasks/ImportDialog",
  component: TasksImportDialog,
  decorators: [
    (Story) => (
      <TasksStoryScope variant="main">
        <Story />
      </TasksStoryScope>
    ),
  ],
  args: {
    open: true,
    file: sampleFile,
    labels: L,
    taskLists: bootstrap.data.taskLists,
    preferredTaskListId: "work",
    onClose: fn(),
    onImport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TasksImportDialog>;

function destinationTrigger(name: string) {
  return screen.getByRole("button", { name: `${L.importDestinationLegend}: ${name}` });
}

export const ExistingList: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(destinationTrigger("Work")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: L.importSubmit }));
    await expect(args.onImport).toHaveBeenCalledWith(sampleFile, {
      mode: "existing",
      collectionId: "work",
    });
  },
};

export const NewList: Story = {
  tags: ["vitest-ci"],
  play: async () => {
    await userEvent.click(destinationTrigger("Work"));
    await userEvent.click(screen.getByRole("menuitem", { name: L.importNewList }));
    await waitFor(() => {
      expect(screen.getByLabelText(L.projectNameLabel)).toHaveValue("groceries");
    });
  },
};

export const ExistingListDark: Story = {
  name: "Existing list (dark)",
  decorators: [withDarkTheme],
};

export const Result: Story = {
  tags: ["vitest-ci"],
  args: { result: partialResult },
  play: async () => {
    await expect(screen.getByText("Imported 3 tasks")).toBeTruthy();
    await expect(screen.getByText(L.importEventsSkipped(2))).toBeTruthy();
    await expect(screen.getByRole("button", { name: L.importDone })).toBeTruthy();
  },
};

export const ResultDark: Story = {
  name: "Result (dark)",
  args: { result: partialResult },
  decorators: [withDarkTheme],
};

export const NothingImported: Story = {
  args: {
    result: {
      list: [],
      errors: [
        { index: 0, message: "exists", code: "already_exists", title: "Buy milk" },
        { index: 1, message: "exists", code: "already_exists", title: "Call the dentist" },
      ],
      skipped: { events: 0 },
    },
  },
};

export const NoTasksInFile: Story = {
  args: { error: L.importNoTasksInFile },
};

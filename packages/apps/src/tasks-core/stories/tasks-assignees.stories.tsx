import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MOCK_TASK_LIST_COLLEAGUES } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TaskListMember, TaskListMembersResult } from "@/lib/models/tasks-types";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksAssigneesField } from "@/tasks-core/src/tasks-assignees-field";
import { assigneeParticipant } from "@/tasks-core/src/tasks-assignees";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const L = defaultTasksLabels;
const me: TaskListMember = {
  username: "me",
  displayName: "Morgan Vale",
  email: "morgan@example.org",
  access: "write",
};
const audience = [me, ...MOCK_TASK_LIST_COLLEAGUES];
const [alex, sam, jordan] = MOCK_TASK_LIST_COLLEAGUES as [
  TaskListMember,
  TaskListMember,
  TaskListMember,
];

const assigned = (...members: TaskListMember[]): Task["participants"] =>
  Object.fromEntries(
    members.map((member) => [`u:${member.username}`, assigneeParticipant(member)]),
  );

/** The Assignee value of the task detail, with the picker it opens. */
function TasksAssigneesHarness({
  initial,
  members = audience,
  offline = false,
  disabled = false,
}: {
  initial?: Task["participants"];
  members?: TaskListMember[];
  /** The list was never opened online: no cached audience. */
  offline?: boolean;
  disabled?: boolean;
}) {
  const [participants, setParticipants] = useState(initial);
  const [load] = useState(
    () => async (): Promise<TaskListMembersResult> =>
      offline ? { members: null, fromCache: true } : { members, fromCache: false },
  );
  return (
    <TasksStoryScope variant="main">
      <div className="p-4">
        <TasksAssigneesField
          L={L}
          listId="inbox"
          participants={participants}
          disabled={disabled}
          loadMembers={load}
          onChange={setParticipants}
        />
      </div>
    </TasksStoryScope>
  );
}

const meta: Meta<typeof TasksAssigneesHarness> = {
  title: "Features/Tasks/Panes/Assignees",
  component: TasksAssigneesHarness,
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof TasksAssigneesHarness>;

const trigger = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole("button", { name: new RegExp(`^${L.assigneeLabel}:`) });

/** Nobody assigned; the keyboard alone opens the picker and assigns someone. */
export const Empty: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const page = within(document.body);
    expect(trigger(canvasElement)).toHaveAccessibleName(
      `${L.assigneeLabel}: ${L.assigneeUnassigned}`,
    );

    trigger(canvasElement).focus();
    await userEvent.keyboard("{Enter}");
    const search = await page.findByRole("combobox", { name: L.assigneeSearch });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.type(search, "alex");
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(trigger(canvasElement)).toHaveAccessibleName(`${L.assigneeLabel}: Alex Morgan`),
    );
    expect(page.getByRole("option", { name: /Alex Morgan/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(page.getByRole("status")).toHaveTextContent(/Alex Morgan/);
  },
};

/** Three people: stacked avatars and "3 people"; read-only people cannot be picked. */
export const ThreeAssignees: Story = {
  args: { initial: assigned(alex, sam, jordan) },
  play: async ({ canvasElement }) => {
    const page = within(document.body);
    await waitFor(() => expect(trigger(canvasElement)).toHaveTextContent(L.assigneePeople(3)));
    expect(trigger(canvasElement)).toHaveAccessibleName(
      `${L.assigneeLabel}: ${L.assigneePeople(3)} (Alex Morgan, Sam Rivera, Jordan Lee)`,
    );
    await userEvent.click(trigger(canvasElement));

    const robin = await page.findByRole("option", { name: /Robin Chen/ });
    expect(robin).toHaveAttribute("aria-disabled", "true");
    expect(robin).toHaveTextContent(L.assigneeReadOnly);
    await userEvent.click(robin);
    expect(robin).toHaveAttribute("aria-selected", "false");

    await userEvent.click(page.getByRole("option", { name: /Sam Rivera/ }));
    await waitFor(() => expect(trigger(canvasElement)).toHaveTextContent(L.assigneePeople(2)));
  },
};

/** Someone who lost access stays on the task, greyed, and can still be removed. */
export const NoAccessAssignee: Story = {
  args: {
    initial: assigned({
      username: "casey",
      displayName: "Casey Brooks",
      email: "casey@example.org",
      access: "write",
    }),
  },
  play: async ({ canvasElement }) => {
    const page = within(document.body);
    await waitFor(() =>
      expect(trigger(canvasElement)).toHaveAccessibleName(
        `${L.assigneeLabel}: Casey Brooks, ${L.assigneeNoAccess}`,
      ),
    );
    await userEvent.click(trigger(canvasElement));
    const casey = await page.findByRole("option", { name: /Casey Brooks/ });
    expect(casey).toHaveTextContent(L.assigneeNoAccess);
    await userEvent.click(casey);
    await waitFor(() =>
      expect(trigger(canvasElement)).toHaveAccessibleName(
        `${L.assigneeLabel}: ${L.assigneeUnassigned}`,
      ),
    );
  },
};

/** Offline, for a list never opened online: the assignees show, the picker can't load people. */
export const Offline: Story = {
  args: { initial: assigned(alex), offline: true },
  play: async ({ canvasElement }) => {
    const page = within(document.body);
    expect(trigger(canvasElement)).toHaveTextContent("Alex Morgan");
    await userEvent.click(trigger(canvasElement));
    await expect(await page.findByText(L.assigneeConnect)).toBeInTheDocument();
    expect(page.queryAllByRole("option")).toHaveLength(0);
  },
};

/** A reader sees who is assigned but cannot open the picker. */
export const ReadOnly: Story = {
  args: { initial: assigned(alex), disabled: true },
  play: async ({ canvasElement }) => {
    expect(trigger(canvasElement)).toBeDisabled();
  },
};

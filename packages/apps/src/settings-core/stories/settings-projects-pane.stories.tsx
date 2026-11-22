import type { SettingsGroup } from "@/lib/models/settings-types";
import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectOperations, ProjectTeam } from "@/lib/api/wgw/projects";
import { createProjectsStore, type ProjectsStore } from "@/lib/projects/projects-store";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import { SettingsStoryScope } from "./settings-story-scope";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";

const TEAM_GROUPS: SettingsGroup[] = MOCK_PROJECT_TEAMS.map((team, index) => ({
  id: `principals/groups/${team.slug}`,
  displayName: team.displayName,
  memberCount: index + 3,
  isTeamAdmin: team.isTeamAdmin,
}));

type HarnessProps = {
  teams: ProjectTeam[];
  /** Archive the "Website relaunch" Project before the pane opens. */
  startArchived?: boolean;
};

function Harness({ teams, startArchived }: HarnessProps) {
  const [store, setStore] = useState<ProjectsStore | null>(null);
  useEffect(() => {
    const mock = createMockProjectOperations(teams);
    const operations: ProjectOperations = mock;
    const next = createProjectsStore(operations);
    void next.load().then(async () => {
      const website = next.getSnapshot().projects.find((p) => p.name === "Website relaunch");
      if (startArchived && website) await next.archive(website.id);
      setStore(next);
    });
  }, [teams, startArchived]);
  if (!store) return null;
  return (
    <SettingsStoryScope>
      <AutosaveStatusProvider>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AutosaveStatusTag />
        </div>
        <ProjectsManagePane store={store} groups={TEAM_GROUPS} />
      </AutosaveStatusProvider>
    </SettingsStoryScope>
  );
}

const meta = {
  title: "Features/Settings/Panes/Projects",
  component: Harness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Team admin of Design, member of Sales: Design rows are editable, Sales rows are text. */
export const TeamAdmin: Story = { args: { teams: MOCK_PROJECT_TEAMS } };

/** Member only: nothing to edit, a hint says who can. */
export const MemberOnly: Story = {
  args: { teams: MOCK_PROJECT_TEAMS.map((team) => ({ ...team, isTeamAdmin: false })) },
};

/** An archived Project sits in its own group, with Restore and Delete permanently. */
export const WithArchived: Story = { args: { teams: MOCK_PROJECT_TEAMS, startArchived: true } };

/** Archive asks to confirm; the Project then stays in its Team's list with an Archived tag. */
export const ArchiveAndRestore: Story = {
  args: { teams: MOCK_PROJECT_TEAMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Archive" }));
    const body = within(canvasElement.ownerDocument.body);
    const confirm = (await body.findAllByRole("button", { name: "Archive" })).pop()!;
    await userEvent.click(confirm);
    await canvas.findByText("Archived");
    await userEvent.click(await canvas.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(canvas.queryByText("Archived")).toBeNull());
  },
};

/** Edit opens a dialog with the name and color; nothing is stored before Save. */
export const EditInDialog: Story = {
  args: { teams: MOCK_PROJECT_TEAMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click((await canvas.findAllByRole("button", { name: "Edit" }))[1]!);
    const body = within(canvasElement.ownerDocument.body);
    const field = await body.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Brand book");
    await userEvent.click(await body.findByRole("button", { name: "Save" }));
    await canvas.findByText("Brand book");
  },
};

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectOperations, ProjectTeam } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { createProjectsStore, type ProjectsStore } from "@/lib/projects/projects-store";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import { SettingsStoryScope } from "./settings-story-scope";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";

type HarnessProps = {
  teams: ProjectTeam[];
  /** Archive the "Website relaunch" Project before the pane opens. */
  startArchived?: boolean;
  /** Every purge answers 409, as if the Project was restored elsewhere. */
  purgeConflict?: boolean;
};

function Harness({ teams, startArchived, purgeConflict }: HarnessProps) {
  const [store, setStore] = useState<ProjectsStore | null>(null);
  useEffect(() => {
    const mock = createMockProjectOperations(teams);
    const operations: ProjectOperations = purgeConflict
      ? {
          ...mock,
          purge: async () => {
            throw new WgwRequestError("Archive the Project before you purge it.", 409);
          },
        }
      : mock;
    const next = createProjectsStore(operations);
    void next.load().then(async () => {
      const website = next.getSnapshot().projects.find((p) => p.name === "Website relaunch");
      if (startArchived && website) await next.archive(website.id);
      setStore(next);
    });
  }, [teams, startArchived, purgeConflict]);
  if (!store) return null;
  return (
    <SettingsStoryScope>
      <AutosaveStatusProvider>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AutosaveStatusTag />
        </div>
        <ProjectsManagePane store={store} />
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

/** Archive acts at once and the Project moves to the Archived group. */
export const ArchiveAndRestore: Story = {
  args: { teams: MOCK_PROJECT_TEAMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Archive" }));
    await canvas.findByRole("heading", { name: "Archived" });
    await userEvent.click(await canvas.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(canvas.queryByRole("heading", { name: "Archived" })).toBeNull());
  },
};

/** The name saves after a pause; the tag shows Saving, then Saved. */
export const RenameAutosaves: Story = {
  args: { teams: MOCK_PROJECT_TEAMS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByLabelText("Name of Website relaunch");
    await userEvent.clear(field);
    await userEvent.type(field, "Brand book");
    await canvas.findByLabelText("Name of Brand book");
  },
};

/** Purge needs the Project's name typed. */
export const PurgeNeedsName: Story = {
  args: { teams: MOCK_PROJECT_TEAMS, startArchived: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Delete permanently" }));
    const body = within(canvasElement.ownerDocument.body);
    const confirm = (await body.findAllByRole("button", { name: "Delete permanently" })).pop()!;
    await expect(confirm).toBeDisabled();
    await userEvent.type(await body.findByLabelText(/Type “Website relaunch”/), "Website relaunch");
    await expect(confirm).toBeEnabled();
  },
};

/** The server answers 409 to a purge: its message shows and the dialog stays. */
export const PurgeConflict: Story = {
  args: { teams: MOCK_PROJECT_TEAMS, startArchived: true, purgeConflict: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Delete permanently" }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByLabelText(/Type “Website relaunch”/), "Website relaunch");
    await userEvent.click(
      (await body.findAllByRole("button", { name: "Delete permanently" })).pop()!,
    );
    await body.findByLabelText(/Type “Website relaunch”/);
  },
};

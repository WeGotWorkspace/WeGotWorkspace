import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectTeam } from "@/lib/api/wgw/projects";
import { createProjectsStore, type ProjectsStore } from "@/lib/projects/projects-store";
import { OpenSettingsPanelContext } from "@/lib/settings/open-settings-panel";
import { ProjectFilterSelect } from "@/projects-ui/src/project-filter-select";

function Harness({ teams, withSettings }: { teams: ProjectTeam[]; withSettings?: boolean }) {
  const [store, setStore] = useState<ProjectsStore | null>(null);
  useEffect(() => {
    const next = createProjectsStore(createMockProjectOperations(teams));
    void next.load().then(() => setStore(next));
  }, [teams]);
  return (
    <OpenSettingsPanelContext.Provider value={withSettings ? () => undefined : null}>
      <div style={{ width: 240 }}>{store ? <ProjectFilterSelect store={store} /> : null}</div>
    </OpenSettingsPanelContext.Provider>
  );
}

const meta = {
  title: "Projects/Project Filter Select",
  component: Harness,
  tags: ["autodocs"],
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Team admin of Design, member of Sales: each Team has "All", then its other Projects. */
export const TeamAdmin: Story = { args: { teams: MOCK_PROJECT_TEAMS } };

/** Inside Settings' provider a team admin also gets Manage Projects. */
export const WithManageProjects: Story = {
  args: { teams: MOCK_PROJECT_TEAMS, withSettings: true },
};

/** Member only: no Manage Projects. */
export const MemberOnly: Story = {
  args: { teams: MOCK_PROJECT_TEAMS.map((team) => ({ ...team, isTeamAdmin: false })) },
};

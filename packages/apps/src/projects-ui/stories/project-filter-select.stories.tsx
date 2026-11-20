import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectTeam } from "@/lib/api/wgw/projects";
import { createProjectsStore, type ProjectsStore } from "@/lib/projects/projects-store";
import { ProjectFilterSelect } from "@/projects-ui/src/project-filter-select";

function Harness({ teams }: { teams: ProjectTeam[] }) {
  const [store, setStore] = useState<ProjectsStore | null>(null);
  useEffect(() => {
    const next = createProjectsStore(createMockProjectOperations(teams));
    void next.load().then(() => setStore(next));
  }, [teams]);
  return <div style={{ width: 240 }}>{store ? <ProjectFilterSelect store={store} /> : null}</div>;
}

const meta = {
  title: "Projects/Project Filter Select",
  component: Harness,
  tags: ["autodocs"],
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Team admin of Design, member of Sales: Create Project is offered. */
export const TeamAdmin: Story = { args: { teams: MOCK_PROJECT_TEAMS } };

/** Member only: the list has no Create Project. */
export const MemberOnly: Story = {
  args: { teams: MOCK_PROJECT_TEAMS.map((team) => ({ ...team, isTeamAdmin: false })) },
};

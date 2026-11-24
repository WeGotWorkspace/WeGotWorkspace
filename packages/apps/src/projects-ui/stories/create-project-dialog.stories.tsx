import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import { CreateProjectDialog } from "@/projects-ui/src/create-project-dialog";

const meta = {
  title: "Projects/Create Project Dialog",
  component: CreateProjectDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    teams: MOCK_PROJECT_TEAMS.filter((team) => team.isTeamAdmin),
    onOpenChange: fn(),
    onCreate: fn(async () => true),
  },
} satisfies Meta<typeof CreateProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One Team the caller is team admin of: the Team select is fixed. */
export const OneTeam: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const create = await body.findByRole("button", { name: "Create" });
    await expect(create).toBeDisabled();
    await userEvent.type(body.getByLabelText("Name"), "Brand book");
    await userEvent.click(create);
    await expect(args.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ teamSlug: "design", name: "Brand book" }),
    );
  },
};

/** Team admin of two Teams: the Team can be chosen. */
export const TwoTeams: Story = {
  args: {
    teams: MOCK_PROJECT_TEAMS.map((team) => ({ ...team, isTeamAdmin: true })),
  },
};

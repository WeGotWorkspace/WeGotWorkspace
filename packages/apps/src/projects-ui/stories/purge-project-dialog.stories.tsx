import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { PurgeProjectDialog } from "@/projects-ui/src/purge-project-dialog";

const meta = {
  title: "Projects/Purge Project Dialog",
  component: PurgeProjectDialog,
  args: {
    projectName: "Website relaunch",
    onOpenChange: () => undefined,
    onPurge: async () => true,
  },
} satisfies Meta<typeof PurgeProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete permanently stays off until the Project's name is typed in full. */
export const NeedsTheName: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const confirm = await body.findByRole("button", { name: "Delete permanently" });
    await expect(confirm).toBeDisabled();
    await userEvent.type(await body.findByLabelText(/Type “Website relaunch”/), "Website relaunch");
    await expect(confirm).toBeEnabled();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { WorkspaceProject } from "@/lib/projects/projects-store";
import { EditProjectDialog } from "@/projects-ui/src/edit-project-dialog";

const project = {
  id: "01storyproject0000000000000",
  teamSlug: "design",
  teamName: "Design",
  slug: "website-relaunch",
  name: "Website relaunch",
  color: "#3b82f6",
  isDefault: false,
  archived: false,
  archivedAt: null,
  mayManage: true,
  resources: {
    calendarId: "cal-1",
    taskListId: "tasks-1",
    notebookId: "notes-1",
    channelId: "chat-1",
    driveFolderId: "folder-1",
    driveFolderPath: "groups/design/Website relaunch",
  },
} as unknown as WorkspaceProject;

const meta = {
  title: "Projects/Edit Project Dialog",
  component: EditProjectDialog,
  args: {
    project,
    onOpenChange: fn(),
    onSave: fn(async () => true),
  },
} satisfies Meta<typeof EditProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Save stays off until the name or color changes; nothing is stored before Save. */
export const SaveAfterRename: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const save = await body.findByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    const name = body.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Brand book");
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: project.id }),
      expect.objectContaining({ name: "Brand book" }),
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CollectionDialogActions } from "@/share-ui/collection-dialog-actions";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";

const meta: Meta<typeof CollectionDialogActions> = {
  title: "Features/Share/CollectionDialogActions",
  component: CollectionDialogActions,
  tags: ["autodocs"],
  args: {
    doneLabel: workspaceLabels.dialog.done,
    cancelLabel: workspaceLabels.dialog.cancel,
    submitLabel: workspaceLabels.dialog.save,
    canSubmit: true,
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex justify-end gap-2 p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CollectionDialogActions>;

/** Only access changed: it saved at once, so Done alone closes the dialog. */
export const DoneOnly: Story = {
  tags: ["vitest-ci"],
  args: { doneOnly: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: workspaceLabels.dialog.cancel })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: workspaceLabels.dialog.done }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** Name, colour or owner is edited: Cancel and Save apply to the record. */
export const SaveAndCancel: Story = {
  tags: ["vitest-ci"],
  args: { doneOnly: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: workspaceLabels.dialog.done })).toBeNull();
    await expect(canvas.getByRole("button", { name: workspaceLabels.dialog.save })).toBeTruthy();
    await expect(canvas.getByRole("button", { name: workspaceLabels.dialog.cancel })).toBeTruthy();
  },
};

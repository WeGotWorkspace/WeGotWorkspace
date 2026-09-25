import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { ShareDialog } from "@/share-ui/share-dialog";
import { shareLabels } from "@/share-ui/share-labels";
import {
  createShareStoryOperations,
  SHARE_STORY_PATH,
  SHARE_STORY_TITLE,
  shareStoryAtPathInherited,
  shareStoryAtPathPublicOff,
  shareStoryAtPathPublicOn,
  shareStoryAtPathPublicPasswordOn,
  shareStoryAtPathReadOnlyMember,
} from "@/share-ui/stories/share-dialog.fixtures";

function ShareDialogHarness({
  fixture = shareStoryAtPathPublicOn,
  title = SHARE_STORY_TITLE,
}: {
  fixture?: typeof shareStoryAtPathPublicOn;
  title?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <DriveStoryScope className="max-w-xl p-6">
      <ShareDialog
        open={open}
        path={SHARE_STORY_PATH}
        title={title}
        shareOperations={createShareStoryOperations(fixture)}
        onOpenChange={setOpen}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Features/Share/ShareDialog",
  component: ShareDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof ShareDialog>;

export default meta;
type Story = StoryObj<typeof ShareDialog>;

export const PublicOn: Story = {
  tags: ["vitest-ci"],
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicOn} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: `Share ${SHARE_STORY_TITLE}` });
    const toggle = await within(dialog).findByRole("switch", {
      name: shareLabels.enablePublicAccess,
    });
    await expect(toggle).toBeEnabled();
    await userEvent.click(toggle);
    const confirm = await body.findByRole("alertdialog", {
      name: shareLabels.disablePublicLinkTitle,
    });
    await expect(
      within(confirm).getByRole("button", { name: shareLabels.confirmCancel }),
    ).toBeEnabled();
    await userEvent.click(within(confirm).getByRole("button", { name: shareLabels.confirmCancel }));
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  },
};

export const PublicPasswordOn: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicPasswordOn} />,
};

export const PublicOff: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicOff} />,
};

export const InheritedRows: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathInherited} />,
};

export const ReadOnlyMember: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathReadOnlyMember} />,
};

function NotesShareDialogHarness() {
  const [open, setOpen] = useState(true);

  return (
    <DriveStoryScope className="max-w-xl p-6">
      <ShareDialog
        open={open}
        path="/users/alice/.notes/Drafts/n1.md"
        title="Meeting notes"
        mode="notes"
        shareOperations={createShareStoryOperations(shareStoryAtPathPublicOff)}
        onOpenChange={setOpen}
      />
    </DriveStoryScope>
  );
}

/** Notes mode: team ACL only, view/edit — no public link section. */
export const NotesMode: Story = {
  render: () => <NotesShareDialogHarness />,
};

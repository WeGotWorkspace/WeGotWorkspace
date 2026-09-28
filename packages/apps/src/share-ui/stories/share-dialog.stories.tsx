import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
  const [shareOperations] = useState(() => createShareStoryOperations(fixture));

  return (
    <DriveStoryScope className="max-w-xl p-6">
      <ShareDialog
        open={open}
        path={SHARE_STORY_PATH}
        title={title}
        shareOperations={shareOperations}
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
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicOn} />,
};

export const PublicPasswordOn: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicPasswordOn} />,
};

export const PublicOff: Story = {
  tags: ["vitest-ci"],
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicOff} />,
  play: async () => {
    const body = within(document.body);
    const toggle = await body.findByRole("switch", { name: shareLabels.enablePublicAccess });
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(body.getByRole("switch", { name: shareLabels.enablePublicAccess })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    await body.findByRole("button", { name: shareLabels.copyLink });
  },
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

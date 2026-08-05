import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { ShareDialog } from "@/share-ui/share-dialog";
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
        onOpenAccess={() => setOpen(false)}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Apps/Share/ShareDialog",
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
  render: () => <ShareDialogHarness fixture={shareStoryAtPathPublicOff} />,
};

export const InheritedRows: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathInherited} />,
};

export const ReadOnlyMember: Story = {
  render: () => <ShareDialogHarness fixture={shareStoryAtPathReadOnlyMember} />,
};

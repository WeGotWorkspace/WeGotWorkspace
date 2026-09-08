import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { MeetChannelDialog } from "@/meet-core/src/meet-channel-dialog";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

const { data, session } = createMeetAppBootstrap();
const groups = data.groups ?? [];

const meta: Meta<typeof MeetChannelDialog> = {
  title: "Apps/Meet/Components/MeetChannelDialog",
  component: MeetChannelDialog,
};

export default meta;
type Story = StoryObj<typeof MeetChannelDialog>;

export const CreateChannel: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <MeetStoryScope>
      <MeetChannelDialog
        dialog={{ mode: "create", kind: "channel" }}
        groups={groups}
        personalOwnerLabel={session.user.displayName}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    </MeetStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("heading", { name: meetLabels.newChannel })).toBeInTheDocument();
    await expect(body.queryByText(meetLabels.channelKindLabel)).not.toBeInTheDocument();
    await expect(body.queryByText(meetLabels.channelKindMeeting)).not.toBeInTheDocument();
  },
};

export const EditChannel: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <MeetStoryScope variant="split">
      <MeetChannelDialog
        dialog={{
          mode: "edit",
          channelId: "channel-general",
          name: "General",
          kind: "channel",
          scope: "personal",
          groupSlug: null,
          mayShare: true,
          shareWith: { "ada.lovelace": { mayRead: true, mayWrite: true } },
          canChangeOwner: true,
          mayDelete: true,
        }}
        groups={groups}
        personalOwnerLabel={session.user.displayName}
        onClose={() => {}}
        onConfirm={() => {}}
        onDelete={() => {}}
        share={{
          knownPrincipals: data.directory,
          online: true,
          onSearchPrincipals: async () => data.directory ?? [],
          onPatchShareWith: async () => undefined,
        }}
      />
    </MeetStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText(meetLabels.shareChannelSectionTitle)).toBeInTheDocument();
    await expect(body.getByText("Ada Lovelace")).toBeInTheDocument();
    await expect(canvas.queryByText(/Can view|Can edit/i)).not.toBeInTheDocument();
    await expect(body.getByRole("button", { name: meetLabels.deleteChannel })).toBeInTheDocument();
  },
};

export const EditMeetingGuestLink: Story = {
  render: () => (
    <MeetStoryScope>
      <MeetChannelDialog
        dialog={{
          mode: "edit",
          channelId: "meeting-standup",
          name: "Standup",
          kind: "meeting",
          scope: "personal",
          groupSlug: null,
          mayShare: true,
          shareWith: null,
          canChangeOwner: true,
          guestRoomCode: "h8y8-ewp6-al8n",
          mayDelete: true,
        }}
        groups={groups}
        personalOwnerLabel={session.user.displayName}
        onClose={() => {}}
        onConfirm={() => {}}
        onDelete={() => {}}
        share={{
          knownPrincipals: data.directory,
          online: true,
          onSearchPrincipals: async () => data.directory ?? [],
          onPatchShareWith: async () => undefined,
        }}
        onCopyGuestLink={() => {}}
      />
    </MeetStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const link = body.getByLabelText(meetLabels.meetingLinkLabel) as HTMLInputElement;
    await expect(link).toBeInTheDocument();
    await expect(link).toHaveProperty("readOnly", true);
    await expect(body.getByRole("button", { name: meetLabels.copyLink })).toBeInTheDocument();
    const shareTitle = body.getByText(meetLabels.shareChannelSectionTitle);
    await expect(
      link.compareDocumentPosition(shareTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

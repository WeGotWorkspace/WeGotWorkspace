import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeetChannelDialog,
  MeetDeleteConfirmDialog,
  type MeetChannelDialogState,
} from "@/meet-core/src/meet-channel-dialog";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { TooltipProvider } from "@/ui/tooltip";

const groups = [
  { slug: "editorial", displayName: "Editorial" },
  { slug: "studio", displayName: "Studio" },
];

const editChannel: Exclude<MeetChannelDialogState, null> = {
  mode: "edit",
  channelId: "channel-general",
  name: "General",
  kind: "channel",
  scope: "personal",
  groupSlug: null,
  mayDelete: true,
};

function renderDialog(
  dialog: MeetChannelDialogState,
  extra?: { onDelete?: () => void; onConfirm?: () => void },
) {
  return render(
    <TooltipProvider>
      <MeetChannelDialog
        dialog={dialog}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={extra?.onConfirm ?? vi.fn()}
        onDelete={extra?.onDelete}
      />
    </TooltipProvider>,
  );
}

describe("MeetChannelDialog delete", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("shows delete in edit mode and confirms through onDelete", () => {
    const onDelete = vi.fn();
    renderDialog(editChannel, { onDelete });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.deleteChannel }));
    fireEvent.click(screen.getByRole("button", { name: meetLabels.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("hides delete in create mode even when onDelete is set", () => {
    renderDialog({ mode: "create", kind: "channel" }, { onDelete: vi.fn() });

    expect(screen.queryByRole("button", { name: meetLabels.deleteChannel })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.deleteMeeting })).toBeNull();
  });

  it("does not offer a type picker on create", () => {
    renderDialog({ mode: "create", kind: "channel" });

    expect(screen.queryByLabelText(meetLabels.channelKindLabel)).toBeNull();
    expect(screen.queryByText(meetLabels.channelKindMeeting)).toBeNull();
    expect(screen.getByRole("heading", { name: meetLabels.newChannel })).toBeTruthy();
  });

  it("hides delete when mayDelete is false even if onDelete is set", () => {
    renderDialog({ ...editChannel, mayDelete: false }, { onDelete: vi.fn() });

    expect(screen.queryByRole("button", { name: meetLabels.deleteChannel })).toBeNull();
  });

  it("hides delete without mayDelete or onDelete", () => {
    renderDialog({ ...editChannel, mayDelete: undefined });

    expect(screen.queryByRole("button", { name: meetLabels.deleteChannel })).toBeNull();
  });

  it("uses meeting delete copy for meeting rooms", () => {
    const onDelete = vi.fn();
    renderDialog({ ...editChannel, kind: "meeting", name: "Standup" }, { onDelete });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.deleteMeeting }));
    expect(screen.getByText(meetLabels.deleteMeetingConfirmTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows a readonly meeting link above People with access", () => {
    const origin = window.location.origin;
    const onCopyGuestLink = vi.fn();
    render(
      <TooltipProvider>
        <MeetChannelDialog
          dialog={{
            ...editChannel,
            kind: "meeting",
            name: "Standup",
            channelId: "chat-standup",
            mayShare: true,
          }}
          groups={groups}
          personalOwnerLabel="Demo User"
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          onCopyGuestLink={onCopyGuestLink}
          share={{
            online: true,
            knownPrincipals: [],
            onSearchPrincipals: async () => [],
            onPatchShareWith: async () => undefined,
          }}
        />
      </TooltipProvider>,
    );

    const link = screen.getByLabelText(meetLabels.meetingLinkLabel) as HTMLInputElement;
    expect(link).toHaveProperty("readOnly", true);
    expect(link.value).toBe(`${origin}/meet/meetings/standup`);
    const shareTitle = screen.getByText(meetLabels.shareChannelSectionTitle);
    expect(
      link.compareDocumentPosition(shareTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    fireEvent.click(screen.getByRole("button", { name: meetLabels.copyLink }));
    expect(onCopyGuestLink).toHaveBeenCalledWith(`${origin}/meet/meetings/standup`);
  });

  it("confirms leftover meeting delete without inventing a channel id", () => {
    const onConfirm = vi.fn();
    render(
      <MeetDeleteConfirmDialog open meetingKind onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    expect(screen.getByText(meetLabels.deleteMeetingConfirmTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.delete }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

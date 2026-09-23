import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetChannelDeepLinkGate, MeetInviteGate } from "@/meet-core/src/meet-invite-gate";
import type { MeetInviteAccessIo } from "@/meet-core/src/meet-invite-access";
import { meetLabels } from "@/meet-core/src/meet-labels";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: () => true,
  wgwHasAuthenticatedSession: () => false,
  wgwEnsureSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const anonymousIo: MeetInviteAccessIo = {
  hasSession: async () => false,
  getChannel: async () => null,
  listChannels: async () => [],
};

describe("guest conversation refusal", () => {
  it("refuses a signed-out channel visitor without a knock lobby", async () => {
    render(
      <MeetChannelDeepLinkGate
        channelId="general"
        guestClosed
        workspace={<div>workspace</div>}
        accessIo={anonymousIo}
      />,
    );

    expect(await screen.findByText(meetLabels.guestConversationRefusedTitle)).toBeTruthy();
    expect(screen.getByText(meetLabels.guestConversationRefusedBody)).toBeTruthy();
    expect(screen.queryByRole("button", { name: meetLabels.knockToJoin })).toBeNull();
    expect(screen.queryByText("workspace")).toBeNull();
  });

  it("refuses a signed-out direct message without mounting the workspace", async () => {
    render(
      <MeetChannelDeepLinkGate
        channelId={null}
        guestClosed
        workspace={<div>workspace</div>}
        accessIo={anonymousIo}
      />,
    );

    expect(await screen.findByText(meetLabels.guestConversationRefusedTitle)).toBeTruthy();
    expect(screen.queryByText("workspace")).toBeNull();
  });

  it("refuses a saved meeting url and keeps the ad-hoc room on the invite gate path", async () => {
    render(<MeetInviteGate room={null} channelId="standup" accessIo={anonymousIo} />);

    expect(await screen.findByText(meetLabels.guestConversationRefusedTitle)).toBeTruthy();
    expect(screen.queryByRole("button", { name: meetLabels.knockToJoin })).toBeNull();
  });
});

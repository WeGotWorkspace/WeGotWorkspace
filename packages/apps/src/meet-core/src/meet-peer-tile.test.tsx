/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";

const toastApi = {
  show: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

function renderTile(props: Partial<ComponentProps<typeof MeetPeerTile>> = {}) {
  return render(
    <TooltipProvider>
      <MeetPeerTile name={props.name ?? "Admin"} stream={null} {...props} />
    </TooltipProvider>,
  );
}

describe("MeetPeerTile mute", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
  });

  it("toggles the local mic from the name badge instead of a corner button", () => {
    const onToggleMic = vi.fn();
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "You",
      micOn: true,
      onToggleMic,
      onMuteParticipant,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.mute }));
    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(onMuteParticipant).not.toHaveBeenCalled();
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.microphoneMuted, { severity: "info" });
    expect(screen.queryByRole("button", { name: meetLabels.muteParticipant })).toBeNull();
  });

  it("unmutes the local mic from the name badge", () => {
    const onToggleMic = vi.fn();
    renderTile({
      name: "You",
      micOn: false,
      onToggleMic,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.unmute }));
    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.microphoneUnmuted, { severity: "info" });
  });

  it("asks the host to mute a live participant from the name badge", () => {
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "Admin",
      disclosedMedia: { camera: true, mic: true },
      onMuteParticipant,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.muteParticipant }));
    expect(onMuteParticipant).toHaveBeenCalledWith(true);
    expect(toastApi.show).not.toHaveBeenCalled();
  });

  it("asks the host to unmute a muted participant from the name badge", () => {
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "Admin",
      disclosedMedia: { camera: true, mic: false },
      onMuteParticipant,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.unmuteParticipant }));
    expect(onMuteParticipant).toHaveBeenCalledWith(false);
  });

  it("hides peer mute when the viewer cannot moderate", () => {
    renderTile({ name: "Admin", disclosedMedia: { camera: true, mic: true } });
    expect(screen.queryByRole("button", { name: meetLabels.muteParticipant })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.unmuteParticipant })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.mute })).toBeNull();
  });
});

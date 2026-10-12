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

  it("toggles the local mic from the mute button", () => {
    const onToggleMic = vi.fn();
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "You",
      micOn: true,
      onToggleMic,
      onMuteParticipant,
    });

    const mute = screen.getByRole("button", { name: meetLabels.mutePeer("You") });
    expect(mute.className).toContain("button--variant-outline");
    expect(mute.className).not.toContain("button--severity-danger");
    fireEvent.click(mute);
    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(onMuteParticipant).not.toHaveBeenCalled();
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.microphoneMuted, { severity: "info" });
    expect(screen.queryByRole("button", { name: meetLabels.muteParticipant })).toBeNull();
    expect(screen.getByText("You").closest("button")).toBeNull();
  });

  it("unmutes the local mic from the mute button", () => {
    const onToggleMic = vi.fn();
    renderTile({
      name: "You",
      micOn: false,
      onToggleMic,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.unmutePeer("You") }));
    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.microphoneUnmuted, { severity: "info" });
  });

  it("asks the host to mute a live participant from the mute button", () => {
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "Admin",
      disclosedMedia: { camera: true, mic: true },
      onMuteParticipant,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.mutePeer("Admin") }));
    expect(onMuteParticipant).toHaveBeenCalledWith(true);
    expect(toastApi.show).not.toHaveBeenCalled();
  });

  it("asks the host to unmute a muted participant from the mute button", () => {
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "Admin",
      disclosedMedia: { camera: true, mic: false },
      onMuteParticipant,
    });

    const mute = screen.getByRole("button", { name: meetLabels.unmutePeer("Admin") });
    expect(mute.className).toContain("button--variant-outline");
    expect(mute.className).not.toContain("button--severity-danger");
    expect(mute.className).toContain("meet-peer-tile__control--persistent");
    fireEvent.click(mute);
    expect(onMuteParticipant).toHaveBeenCalledWith(false);
  });

  it("hides peer mute when the viewer cannot moderate", () => {
    renderTile({ name: "Admin", disclosedMedia: { camera: true, mic: true } });
    expect(screen.queryByRole("button", { name: meetLabels.mutePeer("Admin") })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.unmutePeer("Admin") })).toBeNull();
    expect(screen.getByText("Admin").closest("button")).toBeNull();
  });

  it("pins and unpins the tile locally", () => {
    const onToggleMic = vi.fn();
    renderTile({ name: "Alex Morgan", micOn: true, onToggleMic });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") }));
    const pinned = screen.getByRole("button", {
      name: meetLabels.unpinParticipant("Alex Morgan"),
    });
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
    expect(onToggleMic).not.toHaveBeenCalled();

    fireEvent.click(pinned);
    expect(
      screen
        .getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows a speaking tag and speaking class for the active speaker", () => {
    const { container } = renderTile({ name: "Alex Morgan", speaking: true });
    expect(screen.getByText(meetLabels.speaking)).toBeTruthy();
    expect(container.querySelector(".meet-peer-tile--speaking")).toBeTruthy();
    expect(screen.getByText(meetLabels.speaking).className).toContain("meet-peer-tile__speaking");
  });

  it("keeps the camera-off initial visible when an audio stream is still attached", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const track = {
      kind: "audio",
      readyState: "live",
      enabled: true,
      muted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [],
      getAudioTracks: () => [track],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaStream;
    renderTile({
      name: "Admin",
      stream,
      disclosedMedia: { camera: false, mic: true },
      spotlight: true,
    });

    const mark = screen.getByRole("img", { name: "Admin avatar" });
    expect(mark.textContent).toBe("A");
    expect(mark.closest(".meet-peer-tile__fill")).not.toBeNull();
    expect(mark.closest(".sr-only")).toBeNull();
  });
});

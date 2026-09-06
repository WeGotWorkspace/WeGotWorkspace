/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";

function renderTile(props: Partial<ComponentProps<typeof MeetPeerTile>> = {}) {
  return render(
    <TooltipProvider>
      <MeetPeerTile name={props.name ?? "Admin"} stream={null} {...props} />
    </TooltipProvider>,
  );
}

describe("MeetPeerTile mute", () => {
  it("toggles the local mic on the self tile instead of a mute-soon stub", () => {
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
  });

  it("asks the host mute action for another participant", () => {
    const onMuteParticipant = vi.fn();
    renderTile({
      name: "Admin",
      onMuteParticipant,
    });

    fireEvent.click(screen.getByRole("button", { name: meetLabels.muteParticipant }));
    expect(onMuteParticipant).toHaveBeenCalledTimes(1);
  });

  it("hides peer mute when the viewer cannot moderate", () => {
    renderTile({ name: "Admin" });
    expect(screen.queryByRole("button", { name: meetLabels.muteParticipant })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.mute })).toBeNull();
  });
});

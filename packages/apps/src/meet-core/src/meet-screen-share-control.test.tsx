/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetScreenShareControl } from "@/meet-core/src/meet-screen-share-control";
import { TooltipProvider } from "@/ui/tooltip";
import { meetLabels } from "@/meet-core/src/meet-labels";

function renderControl(screenOn: boolean, onStart: () => void, onStop: () => void) {
  render(
    <TooltipProvider>
      <MeetScreenShareControl screenOn={screenOn} onStart={onStart} onStop={onStop} />
    </TooltipProvider>,
  );
}

describe("MeetScreenShareControl", () => {
  it("starts sharing with exactly one call per click and offers no menu", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderControl(false, onStart, onStop);
    fireEvent.click(screen.getByRole("button", { name: meetLabels.shareScreen }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("stops sharing with one call per click while a share is live", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderControl(true, onStart, onStop);
    fireEvent.click(screen.getByRole("button", { name: meetLabels.stopSharing }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});

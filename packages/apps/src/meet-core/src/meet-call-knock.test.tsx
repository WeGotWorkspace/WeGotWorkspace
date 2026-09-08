import { type ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetCallKnockQueue, MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { MeetKnockBadge } from "@/meet-core/src/meet-knock-badge";
import { meetGuestChannelPhase } from "@/meet-core/src/meet-guest-channel";
import { meetLabels } from "@/meet-core/src/meet-labels";

function renderKnock(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("MeetCallKnockQueue", () => {
  const knockers = [
    { id: "peer-1", name: "Alex Morgan" },
    { id: "peer-2", name: "Jamie Lee" },
  ];

  it("renders one admit/deny row per knocker", () => {
    renderKnock(<MeetCallKnockQueue knockers={knockers} onAdmit={() => {}} onDeny={() => {}} />);
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByText("Jamie Lee")).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.admitName("Alex Morgan") })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.denyName("Jamie Lee") })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("routes admit and deny to the matching peer id", () => {
    const onAdmit = vi.fn();
    const onDeny = vi.fn();
    renderKnock(<MeetCallKnockQueue knockers={knockers} onAdmit={onAdmit} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }));
    fireEvent.click(screen.getByRole("button", { name: meetLabels.denyName("Jamie Lee") }));
    expect(onAdmit).toHaveBeenCalledWith("peer-1");
    expect(onDeny).toHaveBeenCalledWith("peer-2");
  });

  it("renders nothing without knockers", () => {
    const { container } = renderKnock(
      <MeetCallKnockQueue knockers={[]} onAdmit={() => {}} onDeny={() => {}} />,
    );
    expect(container.querySelector(".meet-knock-list")).toBeNull();
  });
});

describe("MeetKnockBadge", () => {
  const knockers = [
    { id: "peer-1", name: "Alex Morgan" },
    { id: "peer-2", name: "Jamie Lee" },
  ];

  it("renders an action-row icon with a waiting count", () => {
    renderKnock(<MeetKnockBadge knockers={knockers} onAdmit={() => {}} onDeny={() => {}} />);
    const trigger = screen.getByRole("button", { name: meetLabels.waitingToJoin(2) });
    expect(trigger.getAttribute("data-count")).toBe("2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens admit/deny rows from the icon", () => {
    const onAdmit = vi.fn();
    renderKnock(<MeetKnockBadge knockers={knockers} onAdmit={onAdmit} onDeny={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: meetLabels.waitingToJoin(2) }));
    fireEvent.click(screen.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }));
    expect(onAdmit).toHaveBeenCalledWith("peer-1");
    const popover = document.querySelector(".meet-knock-badge__popover");
    expect(popover).toBeTruthy();
    expect(popover?.className).not.toMatch(/meet-popover-surface/);
  });

  it("renders nothing without knockers", () => {
    const { container } = render(
      <MeetKnockBadge knockers={[]} onAdmit={() => {}} onDeny={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("MeetCallKnockWaiting", () => {
  it("announces the wait state politely with channel copy and a cancel button", () => {
    const onCancel = vi.fn();
    renderKnock(<MeetCallKnockWaiting channelTitle="#general" onCancel={onCancel} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText(meetLabels.knockWaitTitle("#general"))).toBeTruthy();
    expect(screen.getByText(meetLabels.knockWaitHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.cancelRequest }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("falls back to the generic knocking title without a channel", () => {
    renderKnock(<MeetCallKnockWaiting />);
    expect(screen.getByText(meetLabels.knocking)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("meetGuestChannelPhase", () => {
  const idle = {
    inCall: false,
    showInviteCheckingScreen: false,
    showWaitingForHostScreen: false,
    showMissingInviteScreen: false,
    showInviteErrorScreen: false,
    endedMessage: null,
    waitingForAdmission: false,
  };

  it("maps invite probe states onto the guest landing phases", () => {
    expect(meetGuestChannelPhase({ ...idle, inCall: true })).toBe("in-channel");
    expect(meetGuestChannelPhase({ ...idle, endedMessage: "Call ended" })).toBe("ended");
    expect(meetGuestChannelPhase({ ...idle, showInviteCheckingScreen: true })).toBe("checking");
    expect(meetGuestChannelPhase({ ...idle, showMissingInviteScreen: true })).toBe("missing");
    expect(meetGuestChannelPhase({ ...idle, showInviteErrorScreen: true })).toBe("error");
    expect(meetGuestChannelPhase({ ...idle, showWaitingForHostScreen: true })).toBe("waiting");
    expect(meetGuestChannelPhase({ ...idle, waitingForAdmission: true })).toBe("knocking");
    expect(meetGuestChannelPhase(idle)).toBe("lobby");
  });

  it("keeps the guest lobby while knocking even if inCall is already true", () => {
    expect(meetGuestChannelPhase({ ...idle, inCall: true, waitingForAdmission: true })).toBe(
      "knocking",
    );
  });
});

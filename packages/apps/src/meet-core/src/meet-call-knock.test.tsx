import { type ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetCallKnockQueue, MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
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
    expect(screen.getByText(meetLabels.knockerWantsToJoin("Alex Morgan"))).toBeTruthy();
    expect(screen.getByText(meetLabels.knockerWantsToJoin("Jamie Lee"))).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.admitAll })).toBeTruthy();
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
    expect(container.querySelector(".meet-lobby-banner")).toBeNull();
  });

  it("names the section from the heading", () => {
    renderKnock(<MeetCallKnockQueue knockers={knockers} onAdmit={() => {}} onDeny={() => {}} />);
    const region = screen.getByRole("region", { name: meetLabels.lobbyWaiting(2) });
    const heading = screen.getByRole("heading", { name: meetLabels.lobbyWaiting(2) });
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(region.getAttribute("aria-label")).toBeNull();
  });

  it("admits each knocker once and ignores a second click while that runs", async () => {
    const resolvers: Array<() => void> = [];
    const onAdmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderKnock(<MeetCallKnockQueue knockers={knockers} onAdmit={onAdmit} onDeny={() => {}} />);
    const admitAll = screen.getByRole("button", { name: meetLabels.admitAll });
    fireEvent.click(admitAll);
    fireEvent.click(admitAll);
    expect(onAdmit).toHaveBeenCalledTimes(1);
    expect(onAdmit).toHaveBeenCalledWith("peer-1");
    expect((admitAll as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: meetLabels.admitName("Alex Morgan"),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: meetLabels.denyName("Jamie Lee") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => {
      resolvers[0]!();
      await Promise.resolve();
    });
    expect(onAdmit).toHaveBeenCalledTimes(2);
    expect(onAdmit).toHaveBeenNthCalledWith(2, "peer-2");

    await act(async () => {
      resolvers[1]!();
      await Promise.resolve();
    });
    expect(
      (screen.getByRole("button", { name: meetLabels.admitAll }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("reports a failed admit and leaves the button ready to retry", async () => {
    const onAdmitError = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onAdmit = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error("offline")));
    renderKnock(
      <MeetCallKnockQueue
        knockers={knockers}
        onAdmit={onAdmit}
        onDeny={() => {}}
        onAdmitError={onAdmitError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: meetLabels.admitAll }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAdmit).toHaveBeenCalledTimes(2);
    expect(onAdmitError).toHaveBeenCalledWith(meetLabels.couldNotAdmitParticipant);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    errorSpy.mockRestore();
    expect(
      (screen.getByRole("button", { name: meetLabels.admitAll }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: meetLabels.admitName("Jamie Lee") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
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

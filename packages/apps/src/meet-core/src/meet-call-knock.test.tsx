import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetCallKnockQueue, MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { meetLabels } from "@/meet-core/src/meet-labels";

describe("MeetCallKnockQueue", () => {
  const knockers = [
    { id: "peer-1", name: "Alex Morgan" },
    { id: "peer-2", name: "Jamie Lee" },
  ];

  it("renders an alert with one admit/deny row per knocker", () => {
    render(<MeetCallKnockQueue knockers={knockers} onAdmit={() => {}} onDeny={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-label")).toBe(meetLabels.waitingToJoin(2));
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByText("Jamie Lee")).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.admitName("Alex Morgan") })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.denyName("Jamie Lee") })).toBeTruthy();
  });

  it("routes admit and deny to the matching peer id", () => {
    const onAdmit = vi.fn();
    const onDeny = vi.fn();
    render(<MeetCallKnockQueue knockers={knockers} onAdmit={onAdmit} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }));
    fireEvent.click(screen.getByRole("button", { name: meetLabels.denyName("Jamie Lee") }));
    expect(onAdmit).toHaveBeenCalledWith("peer-1");
    expect(onDeny).toHaveBeenCalledWith("peer-2");
  });

  it("renders nothing without knockers", () => {
    render(<MeetCallKnockQueue knockers={[]} onAdmit={() => {}} onDeny={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("MeetCallKnockWaiting", () => {
  it("announces the wait state politely with channel copy and a cancel button", () => {
    const onCancel = vi.fn();
    render(<MeetCallKnockWaiting channelTitle="#general" onCancel={onCancel} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText(meetLabels.knockWaitTitle("#general"))).toBeTruthy();
    expect(screen.getByText(meetLabels.knockWaitHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.cancelRequest }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("falls back to the generic knocking title without a channel", () => {
    render(<MeetCallKnockWaiting />);
    expect(screen.getByText(meetLabels.knocking)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

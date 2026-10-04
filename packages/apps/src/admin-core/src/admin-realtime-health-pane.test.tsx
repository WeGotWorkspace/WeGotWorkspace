import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminRealtimeHealthPane,
  type RealtimeHealthSnapshot,
} from "@/admin-core/src/admin-realtime-health-pane";

afterEach(() => {
  cleanup();
});

const health: RealtimeHealthSnapshot = {
  day: windowStats(4),
  week: windowStats(9),
  relayDays: [{ date: "2026-10-04", issued: 1, unavailable: 2, denied: 0 }],
  turnConfigured: false,
  unavailablePeopleThisWeek: 3,
  callout: "3 people couldn't connect directly this week. Set up TURN.",
  retentionDays: 30,
};

describe("AdminRealtimeHealthPane", () => {
  it("shows both windows, relay outcomes, and the TURN callout", () => {
    const onOpenTurnSettings = vi.fn();
    render(<AdminRealtimeHealthPane health={health} onOpenTurnSettings={onOpenTurnSettings} />);

    expect(screen.getByText("Last 24 hours")).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.getAllByText("200 ms").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-10-04")).toBeTruthy();
    expect(screen.getByText(/3 people couldn't connect directly this week/i)).toBeTruthy();
    expect(screen.getByText(/symmetric or UDP-blocked/i)).toBeTruthy();
    expect(screen.queryByText(/203\.0\.113/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set up TURN" }));
    expect(onOpenTurnSettings).toHaveBeenCalledTimes(1);
  });

  it("says when a window has no samples", () => {
    render(
      <AdminRealtimeHealthPane
        health={{ ...health, day: windowStats(0), callout: null }}
        onOpenTurnSettings={() => undefined}
      />,
    );
    expect(screen.getByText("No session samples in this window yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up TURN" })).toBeNull();
  });
});

function windowStats(samples: number): RealtimeHealthSnapshot["day"] {
  return {
    samples,
    joinP50Ms: samples === 0 ? null : 200,
    joinP95Ms: samples === 0 ? null : 400,
    relayPercent: 25,
    failedPairsPercent: 25,
    fallbackPercent: 10,
    pollP95Ms: samples === 0 ? null : 140,
    constrainedPercent: 12.5,
    byChannel: { meet: samples, collab: 0 },
  };
}

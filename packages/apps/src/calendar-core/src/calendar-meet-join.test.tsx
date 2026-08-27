import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarMeetJoin } from "@/calendar-core/src/calendar-meet-join";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import { TooltipProvider } from "@/ui/tooltip";

const ORIGIN = "https://workspace.example.com";
const HREF = `${ORIGIN}/meet/guest?room=h8y8-ewp6-al8n`;

function renderJoin(meetOperations?: CalendarMeetOperations) {
  const onJoin = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <CalendarMeetJoin
        href={HREF}
        labels={defaultCalendarLabels}
        workspaceOrigin={ORIGIN}
        meetOperations={meetOperations}
        onJoin={onJoin}
      />
    </TooltipProvider>,
  );
  return { onJoin };
}

describe("CalendarMeetJoin", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows Join and calls onJoin for a reserved room", async () => {
    const roomStatus = vi.fn().mockResolvedValue({ reserved: true, active: false });
    const { onJoin } = renderJoin({ roomStatus });
    const join = await screen.findByRole("button", { name: defaultCalendarLabels.eventMeetJoin });
    expect(join.className).toContain("button--variant-primary");
    fireEvent.click(join);
    expect(onJoin).toHaveBeenCalledWith(HREF);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("shows dead-link copy when GET is 404 / not reserved", async () => {
    renderJoin({
      roomStatus: vi.fn().mockResolvedValue({ reserved: false, active: false }),
    });
    await waitFor(() => {
      expect(screen.getByText(defaultCalendarLabels.eventMeetDeadLink)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventMeetJoin })).toBeNull();
  });

  it("does not treat a network error as a dead link", async () => {
    renderJoin({
      roomStatus: vi.fn().mockRejectedValue(new Error("offline")),
    });
    expect(
      await screen.findByRole("button", { name: defaultCalendarLabels.eventMeetJoin }),
    ).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.eventMeetDeadLink)).toBeNull();
  });
});

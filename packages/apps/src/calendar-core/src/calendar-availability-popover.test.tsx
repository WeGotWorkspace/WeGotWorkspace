import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarAvailabilityPopover } from "@/calendar-core/src/calendar-availability-popover";
import type { AvailabilityPreview } from "@/calendar-core/src/calendar-availability-preview";

const { isMobileRef } = vi.hoisted(() => ({ isMobileRef: { current: false } }));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileRef.current,
  MOBILE_BREAKPOINT_PX: 768,
  MOBILE_MEDIA_QUERY: "(max-width: 767px)",
}));

const withDetails: AvailabilityPreview = {
  key: "availability:ada#0",
  username: "ada",
  name: "Ada Lovelace",
  color: "violet",
  period: {
    start: "2033-01-12T10:00:00",
    timeZone: "Europe/Amsterdam",
    duration: "PT1H",
    showWithoutTime: false,
    title: "Roadmap review",
    location: "Room Babbage",
  },
};

const timeOnly: AvailabilityPreview = {
  key: "availability:grace#1",
  username: "grace",
  name: "Grace Hopper",
  color: "rose",
  period: { start: "2033-01-14", timeZone: null, duration: "P1D", showWithoutTime: true },
};

function renderPopover(preview: AvailabilityPreview) {
  return render(
    <TooltipProvider delayDuration={0}>
      <CalendarAvailabilityPopover
        open
        preview={preview}
        labels={defaultCalendarLabels}
        locale="en-GB"
        timeZone="Europe/Amsterdam"
        onClose={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("CalendarAvailabilityPopover", () => {
  beforeEach(() => {
    cleanup();
    isMobileRef.current = false;
  });

  it("shows the person, time, title and location when details are shared", () => {
    renderPopover(withDetails);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Roadmap review")).toBeTruthy();
    expect(screen.getByText(/Wed 12 Jan, 10:00\s*–\s*11:00/)).toBeTruthy();
    expect(screen.getByText("Room Babbage")).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.teamAvailabilityPreviewNoDetails)).toBeNull();
    expect(
      screen.getByRole("dialog", {
        name: defaultCalendarLabels.teamAvailabilityPreviewTitle("Ada Lovelace"),
      }),
    ).toBeTruthy();
  });

  it("shows Busy, the dates and a hint when only busy times are shared", () => {
    renderPopover(timeOnly);
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    // The resolved colour (rose), not Grace's own avatar colour (violet).
    expect(document.querySelector(".user-avatar--color-rose")).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.teamAvailabilityBusy)).toBeTruthy();
    expect(screen.getByText("Fri 14 Jan")).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.teamAvailabilityPreviewNoDetails)).toBeTruthy();
    expect(
      screen.queryByText(`${defaultCalendarLabels.teamAvailabilityPreviewLocation}:`),
    ).toBeNull();
  });

  it("shows a location without a title, and no hint", () => {
    const { title: _title, ...placeOnly } = withDetails.period;
    renderPopover({ ...withDetails, period: placeOnly });
    expect(screen.getByText(defaultCalendarLabels.teamAvailabilityBusy)).toBeTruthy();
    expect(screen.getByText("Room Babbage")).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.teamAvailabilityPreviewNoDetails)).toBeNull();
  });

  it("renders valid markup: the avatar heading is not inside a <p>", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPopover(withDetails);
    const nesting = errors.mock.calls.filter((args) =>
      String(args[0]).includes("cannot be a descendant of"),
    );
    errors.mockRestore();
    expect(nesting).toEqual([]);
    expect(document.querySelector("p .user-avatar")).toBeNull();
  });

  it("opens a dialog titled with the person on phones", () => {
    isMobileRef.current = true;
    renderPopover(withDetails);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("calendar-dialog-surface");
    expect(screen.getByRole("heading", { name: /Ada Lovelace/ })).toBeTruthy();
  });
});

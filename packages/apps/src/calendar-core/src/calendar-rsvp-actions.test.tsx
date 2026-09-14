import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  CalendarRsvpActions,
  CalendarRsvpSelect,
  calendarRespondStatus,
} from "@/calendar-core/src/calendar-rsvp-actions";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function renderActions(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("CalendarRsvpActions", () => {
  it("defaults to compact segmented size and maps lg to md", () => {
    const { rerender } = renderActions(
      <CalendarRsvpActions
        currentStatus="accepted"
        labels={defaultCalendarLabels}
        onRespond={vi.fn()}
      />,
    );

    const compact = document.querySelector(".calendar-rsvp-actions");
    expect(compact?.className).toContain("calendar-rsvp-actions--sm");
    expect(compact?.className).not.toContain("calendar-rsvp-actions--lg");
    expect(compact?.querySelector(".segmented-control")).toBeTruthy();
    expect(compact?.querySelector(".segmented-control--size-md")).toBeNull();

    rerender(
      <TooltipProvider delayDuration={0}>
        <CalendarRsvpActions
          currentStatus="accepted"
          labels={defaultCalendarLabels}
          size="lg"
          onRespond={vi.fn()}
        />
      </TooltipProvider>,
    );

    const large = document.querySelector(".calendar-rsvp-actions");
    expect(large?.className).toContain("calendar-rsvp-actions--lg");
    expect(large?.className).not.toContain("calendar-rsvp-actions--sm");
    expect(large?.querySelector(".segmented-control--size-md")).toBeTruthy();
  });

  it("selects Maybe when status is unset or needs-action without sending until click", () => {
    const onRespond = vi.fn();
    renderActions(
      <CalendarRsvpActions
        currentStatus="needs-action"
        labels={defaultCalendarLabels}
        onRespond={onRespond}
      />,
    );

    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    const decline = screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline });
    expect(maybe.getAttribute("aria-pressed")).toBe("true");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    expect(decline.getAttribute("aria-pressed")).toBe("false");
    expect(onRespond).not.toHaveBeenCalled();

    fireEvent.click(maybe);
    expect(onRespond).toHaveBeenCalledWith("tentative");
  });

  it("marks the newly chosen option selected without waiting for currentStatus", () => {
    const onRespond = vi.fn();
    renderActions(
      <CalendarRsvpActions
        currentStatus="accepted"
        labels={defaultCalendarLabels}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe }));

    expect(onRespond).toHaveBeenCalledWith("tentative");
    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    expect(maybe.getAttribute("aria-pressed")).toBe("true");
    expect(maybe.className).toContain("segmented-control__button--active");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    expect(accept.className).not.toContain("segmented-control__button--active");
  });

  it("reverts the optimistic selection when onRespond rejects", async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error("Could not send RSVP"));
    renderActions(
      <CalendarRsvpActions
        currentStatus="accepted"
        labels={defaultCalendarLabels}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe }));

    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    expect(maybe.getAttribute("aria-pressed")).toBe("true");

    await waitFor(() => {
      expect(accept.getAttribute("aria-pressed")).toBe("true");
      expect(maybe.getAttribute("aria-pressed")).toBe("false");
    });
  });
});

describe("CalendarRsvpSelect", () => {
  it("maps PARTSTAT to a respond status", () => {
    expect(calendarRespondStatus("accepted")).toBe("accepted");
    expect(calendarRespondStatus("needs-action")).toBeUndefined();
    expect(calendarRespondStatus(null)).toBeUndefined();
  });

  it("keeps changes local until the parent persists", () => {
    const onChange = vi.fn();
    render(
      <CalendarRsvpSelect value="accepted" labels={defaultCalendarLabels} onChange={onChange} />,
    );

    const trigger = screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel });
    expect(trigger.className).toContain("calendar-rsvp-select--accept");
    expect(trigger.className).toContain("calendar-rsvp-select--selected");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.rsvpDecline }));
    expect(onChange).toHaveBeenCalledWith("declined");
  });
});

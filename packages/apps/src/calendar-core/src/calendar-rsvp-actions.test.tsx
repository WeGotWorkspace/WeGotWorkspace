import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  CalendarRsvpActions,
  CalendarRsvpSelect,
  calendarRespondStatus,
} from "@/calendar-core/src/calendar-rsvp-actions";

afterEach(() => {
  cleanup();
});

describe("CalendarRsvpActions", () => {
  it("defaults to the compact size and accepts a large BEM variant", () => {
    const { rerender } = render(
      <CalendarRsvpActions
        currentStatus="accepted"
        labels={defaultCalendarLabels}
        onRespond={vi.fn()}
      />,
    );

    const compact = document.querySelector(".calendar-rsvp-actions");
    expect(compact?.className).toContain("calendar-rsvp-actions--sm");
    expect(compact?.className).not.toContain("calendar-rsvp-actions--lg");
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }).className,
    ).toContain("calendar-rsvp-action--sm");

    rerender(
      <CalendarRsvpActions
        currentStatus="accepted"
        labels={defaultCalendarLabels}
        size="lg"
        onRespond={vi.fn()}
      />,
    );

    const large = document.querySelector(".calendar-rsvp-actions");
    expect(large?.className).toContain("calendar-rsvp-actions--lg");
    expect(large?.className).not.toContain("calendar-rsvp-actions--sm");
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }).className,
    ).toContain("calendar-rsvp-action--lg");
  });

  it("marks the newly chosen option selected without waiting for currentStatus", () => {
    const onRespond = vi.fn();
    render(
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
    expect(maybe.className).toContain("calendar-rsvp-action--selected");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    expect(accept.className).not.toContain("calendar-rsvp-action--selected");
  });

  it("reverts the optimistic selection when onRespond rejects", async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error("Could not send RSVP"));
    render(
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

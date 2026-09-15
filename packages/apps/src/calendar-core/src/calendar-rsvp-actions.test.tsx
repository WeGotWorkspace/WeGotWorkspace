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
  it("defaults to compact segmented size and maps xs/lg to SegmentedControl sizes", () => {
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
    expect(compact?.className).not.toContain("calendar-rsvp-actions--xs");
    expect(compact?.querySelector(".segmented-control")).toBeTruthy();
    expect(compact?.querySelector(".segmented-control--size-md")).toBeTruthy();
    expect(compact?.querySelector(".segmented-control--size-lg")).toBeNull();
    expect(compact?.querySelector(".segmented-control--size-xs")).toBeNull();
    expect(compact?.querySelector(".segmented-control__button--text")).toBeNull();
    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    expect(accept.textContent).not.toContain(defaultCalendarLabels.rsvpAccept);
    expect(accept.querySelector("svg")).toBeTruthy();

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
    expect(large?.querySelector(".segmented-control--size-lg")).toBeTruthy();

    rerender(
      <TooltipProvider delayDuration={0}>
        <CalendarRsvpActions
          currentStatus="accepted"
          labels={defaultCalendarLabels}
          size="sm"
          showLabels
          onRespond={vi.fn()}
        />
      </TooltipProvider>,
    );

    const labeled = document.querySelector(".calendar-rsvp-actions");
    expect(labeled?.className).toContain("calendar-rsvp-actions--sm");
    expect(labeled?.querySelector(".segmented-control--size-md")).toBeTruthy();
    const labeledAccept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    expect(labeledAccept.className).toContain("segmented-control__button--text");
    expect(labeledAccept.textContent).toContain(defaultCalendarLabels.rsvpAccept);
    expect(labeledAccept.querySelector("svg")).toBeTruthy();
  });

  it.each([undefined, "needs-action", "delegated"] as const)(
    "selects no option when currentStatus is %s without sending until click",
    (currentStatus) => {
      const onRespond = vi.fn();
      renderActions(
        <CalendarRsvpActions
          currentStatus={currentStatus}
          labels={defaultCalendarLabels}
          onRespond={onRespond}
        />,
      );

      const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
      const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
      const decline = screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline });
      expect(accept.getAttribute("aria-pressed")).not.toBe("true");
      expect(maybe.getAttribute("aria-pressed")).not.toBe("true");
      expect(decline.getAttribute("aria-pressed")).not.toBe("true");
      expect(accept.className).not.toContain("segmented-control__button--active");
      expect(maybe.className).not.toContain("segmented-control__button--active");
      expect(decline.className).not.toContain("segmented-control__button--active");
      expect(onRespond).not.toHaveBeenCalled();

      fireEvent.click(maybe);
      expect(onRespond).toHaveBeenCalledWith("tentative");
      expect(maybe.getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("presses Maybe only when status is tentative", () => {
    renderActions(
      <CalendarRsvpActions
        currentStatus="tentative"
        labels={defaultCalendarLabels}
        onRespond={vi.fn()}
      />,
    );

    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    const decline = screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline });
    expect(maybe.getAttribute("aria-pressed")).toBe("true");
    expect(maybe.className).toContain("segmented-control__button--active");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    expect(decline.getAttribute("aria-pressed")).toBe("false");
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

  it("stays interactive while a respond promise is pending (no busy greying)", () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined));
    renderActions(
      <CalendarRsvpActions
        currentStatus="needs-action"
        labels={defaultCalendarLabels}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }));
    expect(onRespond).toHaveBeenCalledWith("accepted");
    expect(
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpAccept })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpMaybe })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpDecline })
        .hasAttribute("disabled"),
    ).toBe(false);
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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormShowAs } from "@/calendar-core/src/calendar-event-form-show-as";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;

afterEach(() => {
  cleanup();
});

describe("CalendarEventFormShowAs", () => {
  it("offers only busy and free and reports the chosen status", () => {
    const onFieldChange = vi.fn();
    render(
      <TooltipProvider>
        <CalendarEventFormShowAs
          form={emptyCalendarEventForm("default", "2033-01-12")}
          labels={labels}
          controlSize="sm"
          disabled={false}
          onFieldChange={onFieldChange}
        />
      </TooltipProvider>,
    );

    const showAs = screen.getByRole("combobox", { name: labels.eventShowAs });
    expect(showAs.closest(".card")).toBeNull();
    expect(showAs.textContent).toMatch(/Busy/i);
    fireEvent.click(showAs);
    expect(screen.getByRole("option", { name: labels.eventShowAsBusy })).toBeTruthy();
    expect(screen.getByRole("option", { name: labels.eventShowAsFree })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Tentative/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: labels.eventShowAsFree }));
    expect(onFieldChange).toHaveBeenCalledWith("freeBusyStatus", "free");
  });

  it("disables the control while the form cannot be edited", () => {
    render(
      <TooltipProvider>
        <CalendarEventFormShowAs
          form={emptyCalendarEventForm("default", "2033-01-12")}
          labels={labels}
          controlSize="sm"
          disabled
          onFieldChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    const showAs = screen.getByRole("combobox", { name: labels.eventShowAs });
    expect(showAs.hasAttribute("disabled") || showAs.getAttribute("data-disabled") !== null).toBe(
      true,
    );
  });
});

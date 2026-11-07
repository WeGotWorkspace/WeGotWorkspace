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

  describe("time-off hint (#1927)", () => {
    const hint = labels.eventShowAsAllDayFreeHint;
    const base = emptyCalendarEventForm("default", "2033-01-12");

    function renderShowAs(
      form: ReturnType<typeof emptyCalendarEventForm>,
      options: { readOnly?: boolean } = {},
    ) {
      return render(
        <TooltipProvider>
          <CalendarEventFormShowAs
            form={form}
            labels={labels}
            controlSize="sm"
            disabled={Boolean(options.readOnly)}
            readOnly={options.readOnly}
            onFieldChange={vi.fn()}
          />
        </TooltipProvider>,
      );
    }

    it("shows the hint while an all-day event is Free", () => {
      expect(hint).toBe("Set to Busy for time off, so teammates see you as away.");
      renderShowAs({ ...base, allDay: true, freeBusyStatus: "free" });
      expect(screen.getByText(hint)).toBeTruthy();
    });

    it("hides the hint for all-day Busy and for timed events", () => {
      renderShowAs({ ...base, allDay: true, freeBusyStatus: "busy" });
      expect(screen.queryByText(hint)).toBeNull();
      cleanup();
      renderShowAs({ ...base, allDay: false, freeBusyStatus: "free" });
      expect(screen.queryByText(hint)).toBeNull();
    });

    it("hides the hint on someone else's read-only event", () => {
      renderShowAs({ ...base, allDay: true, freeBusyStatus: "free" }, { readOnly: true });
      expect(screen.queryByText(hint)).toBeNull();
    });
  });
});

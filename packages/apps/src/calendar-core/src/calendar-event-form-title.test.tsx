import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormTitle } from "@/calendar-core/src/calendar-event-form-title";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;
const calendars = createCalendarAppBootstrap().data.calendars;

afterEach(() => {
  cleanup();
});

function renderTitle(overrides: Partial<ComponentProps<typeof CalendarEventFormTitle>> = {}) {
  const onFieldChange = vi.fn();
  const onDraftCalendarIdChange = vi.fn();
  const onRsvp = vi.fn();
  render(
    <TooltipProvider>
      <CalendarEventFormTitle
        form={{ ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" }}
        calendars={calendars}
        labels={labels}
        controlSize="sm"
        busy={false}
        readOnly={false}
        fieldsDisabled={false}
        autoFocusTitle
        calendarPickerInteractive={false}
        showInviteeRsvp={false}
        invitationMode={false}
        draftCalendarId="default"
        onDraftCalendarIdChange={onDraftCalendarIdChange}
        onRsvp={onRsvp}
        onFieldChange={onFieldChange}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onFieldChange, onDraftCalendarIdChange, onRsvp };
}

function chooseWorkCalendar() {
  const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Work" }));
}

describe("CalendarEventFormTitle", () => {
  it("reports title edits and writes the calendar on a normal event", () => {
    const { onFieldChange, onRsvp } = renderTitle();
    fireEvent.change(screen.getByLabelText(labels.eventTitleLabel), {
      target: { value: "Team lunch" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("title", "Team lunch");
    chooseWorkCalendar();
    expect(onFieldChange).toHaveBeenCalledWith("calendarId", "work");
    expect(onRsvp).not.toHaveBeenCalled();
  });

  it("hides the calendar picker when the layout asks", () => {
    renderTitle({ hideCalendarPicker: true });
    expect(screen.queryByRole("button", { name: /Calendar:/i })).toBeNull();
  });

  it("stages the calendar for an invitee RSVP without saving it", () => {
    const { onDraftCalendarIdChange, onFieldChange, onRsvp } = renderTitle({
      showInviteeRsvp: true,
      calendarPickerInteractive: true,
    });
    chooseWorkCalendar();
    expect(onDraftCalendarIdChange).toHaveBeenCalledWith("work");
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(onRsvp).not.toHaveBeenCalled();
  });

  it("keeps a declined invitation calendar local until Accept or Maybe", () => {
    const { onDraftCalendarIdChange, onRsvp } = renderTitle({
      invitationMode: true,
      calendarPickerInteractive: true,
      incomingRsvp: "declined",
    });
    chooseWorkCalendar();
    expect(onDraftCalendarIdChange).toHaveBeenCalledWith("work");
    expect(onRsvp).not.toHaveBeenCalled();
  });

  it("persists an accepted invitation calendar and reverts the draft when RSVP fails", async () => {
    const onRsvp = vi.fn().mockRejectedValue(new Error("offline"));
    const { onDraftCalendarIdChange } = renderTitle({
      invitationMode: true,
      calendarPickerInteractive: true,
      incomingRsvp: "accepted",
      onRsvp,
    });
    chooseWorkCalendar();
    expect(onRsvp).toHaveBeenCalledWith("accepted", "work");
    await waitFor(() => {
      expect(onDraftCalendarIdChange).toHaveBeenLastCalledWith("default");
    });
  });
});

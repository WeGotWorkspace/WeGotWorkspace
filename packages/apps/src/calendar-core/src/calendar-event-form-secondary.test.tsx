import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormSecondary } from "@/calendar-core/src/calendar-event-form-secondary";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;

afterEach(() => {
  cleanup();
});

function renderSecondary(
  overrides: Partial<ComponentProps<typeof CalendarEventFormSecondary>> = {},
  onFieldChange = vi.fn(),
) {
  render(
    <TooltipProvider>
      <CalendarEventFormSecondary
        form={{
          ...emptyCalendarEventForm("default", "2033-01-12"),
          description: "Bring laptop",
        }}
        labels={labels}
        invitees={[]}
        contactCards={[]}
        busy={false}
        readOnly={false}
        fieldsDisabled={false}
        canSubmitEmail
        controlSize="sm"
        onFieldChange={onFieldChange}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onFieldChange };
}

describe("CalendarEventFormSecondary", () => {
  it("keeps invitees in the start column and alarms with notes in the end column", () => {
    renderSecondary();
    const start = document.querySelector(".calendar-event-dialog__secondary-start");
    const end = document.querySelector(".calendar-event-dialog__secondary-end");
    const invitees = document.querySelector(".calendar-event-dialog__field--invitees");
    const alarms = document.querySelector(".calendar-event-dialog__field--alarms");
    const notes = document.querySelector(".calendar-event-dialog__field--notes");
    expect(start?.contains(invitees)).toBe(true);
    expect(end?.contains(alarms)).toBe(true);
    expect(end?.contains(notes)).toBe(true);
    expect(start?.contains(alarms)).toBe(false);
  });

  it("reports description edits", () => {
    const { onFieldChange } = renderSecondary();
    fireEvent.change(screen.getByLabelText(labels.eventNotesLabel), {
      target: { value: "Updated" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("description", "Updated");
  });

  it("omits a section when its layout flag is set", () => {
    renderSecondary({ hideInvitees: true, hideAlarms: true, hideNotes: true });
    expect(document.querySelector(".calendar-event-dialog__field--invitees")).toBeNull();
    expect(document.querySelector(".calendar-event-dialog__field--alarms")).toBeNull();
    expect(document.querySelector(".calendar-event-dialog__field--notes")).toBeNull();
    expect(document.querySelector(".calendar-event-dialog__secondary")).not.toBeNull();
  });
});

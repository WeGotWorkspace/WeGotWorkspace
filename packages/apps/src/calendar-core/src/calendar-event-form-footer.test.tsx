import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventFormFooter } from "@/calendar-core/src/calendar-event-form-footer";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;

afterEach(() => {
  cleanup();
});

function renderFooter(overrides: Partial<ComponentProps<typeof CalendarEventFormFooter>> = {}) {
  const onRsvp = vi.fn();
  const onDelete = vi.fn();
  const onDismiss = vi.fn();
  const onDraftRsvpChange = vi.fn();
  render(
    <TooltipProvider>
      <CalendarEventFormFooter
        mode="edit"
        labels={labels}
        busy={false}
        controlSize="sm"
        readOnly={false}
        valid
        canSubmit
        saveLabel={labels.saveChanges}
        showInvitationRsvp={false}
        showInviteeRsvp={false}
        showSaveCancel
        draftRsvp=""
        draftCalendarId="default"
        onDraftRsvpChange={onDraftRsvpChange}
        onRsvp={onRsvp}
        onDelete={onDelete}
        onDismiss={onDismiss}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onRsvp, onDelete, onDismiss, onDraftRsvpChange };
}

describe("CalendarEventFormFooter", () => {
  it("end-aligns labeled RSVP actions and omits the calendar when declining", () => {
    const { onRsvp } = renderFooter({
      mode: "invitation",
      showInvitationRsvp: true,
      showSaveCancel: false,
      inviteeRsvp: "needs-action",
      draftCalendarId: "work",
    });

    const group = document.querySelector(".calendar-event-dialog__invitation-rsvp");
    expect(group?.querySelector(".calendar-rsvp-actions")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: labels.rsvpDecline }));
    expect(onRsvp).toHaveBeenCalledWith("declined", undefined);
    fireEvent.click(screen.getByRole("button", { name: labels.rsvpAccept }));
    expect(onRsvp).toHaveBeenCalledWith("accepted", "work");
  });

  it("keeps an invitee RSVP select and blocks save until a status is chosen", () => {
    const { onDraftRsvpChange } = renderFooter({
      showInviteeRsvp: true,
      draftRsvp: "",
      saveLabel: labels.save,
    });

    expect(screen.getByRole("button", { name: labels.save }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("combobox", { name: labels.rsvpLabel }));
    fireEvent.click(screen.getByRole("option", { name: labels.rsvpMaybe }));
    expect(onDraftRsvpChange).toHaveBeenCalledWith("tentative");
  });

  it("shows delete for an editable event and dismisses from cancel", () => {
    const { onDelete, onDismiss } = renderFooter();
    fireEvent.click(screen.getByRole("button", { name: labels.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: labels.saveChanges }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides delete when the event is read-only and disables save until the form is valid", () => {
    renderFooter({ readOnly: true, valid: false, showSaveCancel: true, onDelete: undefined });
    expect(screen.queryByRole("button", { name: labels.delete })).toBeNull();
    expect(screen.getByRole("button", { name: labels.saveChanges }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});

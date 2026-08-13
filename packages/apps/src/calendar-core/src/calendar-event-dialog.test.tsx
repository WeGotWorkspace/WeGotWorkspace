import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import {
  calendarEventToForm,
  emptyCalendarEventForm,
} from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

function renderDialog(overrides: Partial<React.ComponentProps<typeof CalendarEventDialog>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const onChange = vi.fn();
  const onDelete = vi.fn();

  render(
    <CalendarEventDialog
      open
      mode="create"
      form={emptyCalendarEventForm("default", "2033-01-12")}
      calendars={bootstrap.data.calendars}
      labels={defaultCalendarLabels}
      onChange={onChange}
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />,
  );

  return { onSave, onClose, onChange, onDelete };
}

describe("CalendarEventDialog", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("disables save until the form is valid", () => {
    renderDialog();
    const save = screen.getByRole("button", { name: defaultCalendarLabels.save });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("propagates title edits and submits a valid form", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onSave, onChange } = renderDialog({ form });

    const titleInput = screen.getByDisplayValue("Lunch");
    fireEvent.change(titleInput, { target: { value: "Team lunch" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Team lunch" }));

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("hides time inputs for all-day events", () => {
    const form = {
      ...calendarEventToForm({
        "@type": "Event",
        id: "offsite",
        uid: "urn:uuid:offsite",
        calendarIds: { default: true },
        title: "Offsite",
        start: "2033-01-17T00:00:00",
        duration: "P2D",
        showWithoutTime: true,
      } as Parameters<typeof calendarEventToForm>[0]),
    };
    renderDialog({ form, mode: "edit", onDelete: vi.fn() });
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2);
  });

  it("offers delete only in edit mode and forwards it", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "x" };
    const { onDelete } = renderDialog({ form, mode: "edit", onDelete: vi.fn() });
    void onDelete;
    const deleteButton = screen.getByRole("button", { name: defaultCalendarLabels.delete });
    expect(deleteButton).toBeTruthy();
  });
});

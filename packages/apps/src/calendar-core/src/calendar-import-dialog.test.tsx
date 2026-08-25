import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import { CalendarImportDialog } from "@/calendar-core/src/calendar-import-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createCalendarAppBootstrap();
const sampleFile = new File(["BEGIN:VCALENDAR"], "team-offsite.ics", { type: "text/calendar" });
const L = defaultCalendarLabels;

function renderDialog(ui: ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

function destinationTrigger(destinationName: string) {
  return screen.getByRole("button", {
    name: `${L.importDestinationLegend}: ${destinationName}`,
  });
}

function openDestination(destinationName: string) {
  const trigger = destinationTrigger(destinationName);
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  return trigger;
}

describe("CalendarImportDialog", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("imports into the preferred writable calendar", () => {
    const onImport = vi.fn();

    renderDialog(
      <CalendarImportDialog
        open
        file={sampleFile}
        labels={L}
        calendars={bootstrap.data.calendars}
        preferredCalendarId="default"
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    const trigger = destinationTrigger("Personal");
    const triggerSwatch = trigger.querySelector(".calendar-color-swatch-trigger__dot");
    expect(triggerSwatch).toBeTruthy();
    expect((triggerSwatch as HTMLElement | null)?.style.backgroundColor).toBeTruthy();
    expect(screen.queryByLabelText(L.calendarNameLabel)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(sampleFile, {
      mode: "existing",
      calendarId: "default",
    });
  });

  it("lists existing calendars with swatches, then New calendar after a separator", () => {
    const onImport = vi.fn();

    renderDialog(
      <CalendarImportDialog
        open
        file={sampleFile}
        labels={L}
        calendars={bootstrap.data.calendars}
        preferredCalendarId="default"
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    openDestination("Personal");

    const personal = screen.getByRole("menuitem", { name: "Personal" });
    const personalSwatch = personal.querySelector(".calendar-sidebar-dot");
    expect(personalSwatch).toBeTruthy();
    expect((personalSwatch as HTMLElement | null)?.style.backgroundColor).toBeTruthy();

    const newCalendar = screen.getByRole("menuitem", { name: L.newCalendar });
    expect(newCalendar.querySelector(".calendar-sidebar-dot")).toBeNull();
    const menu = newCalendar.closest("[role='menu']");
    expect(menu).toBeTruthy();
    const items = within(menu as HTMLElement).getAllByRole("menuitem");
    const separator = within(menu as HTMLElement).getByRole("separator");
    expect(items.at(-1)?.textContent).toBe(L.newCalendar);
    expect(separator.compareDocumentPosition(newCalendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(newCalendar);

    const name = screen.getByLabelText(L.calendarNameLabel);
    expect(name).toHaveProperty("value", "team-offsite");
    expect(
      destinationTrigger(L.newCalendar).querySelector(".calendar-color-swatch-trigger__dot"),
    ).toBeNull();

    fireEvent.change(name, { target: { value: "  Travel  " } });
    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(sampleFile, {
      mode: "create",
      name: "Travel",
      color: DEFAULT_CALENDAR_COLOR,
    });
  });

  it("defaults to New calendar and disables import when the name is empty", () => {
    renderDialog(
      <CalendarImportDialog
        open
        file={new File(["BEGIN:VCALENDAR"], ".ics")}
        labels={L}
        calendars={bootstrap.data.calendars.map((calendar) => ({ ...calendar, mayWrite: false }))}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(
      destinationTrigger(L.newCalendar).querySelector(".calendar-color-swatch-trigger__dot"),
    ).toBeNull();
    const name = screen.getByLabelText(L.calendarNameLabel);
    expect(name).toHaveProperty("value", L.newCalendar);

    fireEvent.change(name, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: L.importSubmit })).toHaveProperty("disabled", true);
  });
});

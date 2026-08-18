import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarRecurrenceScopeDialog } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import type { RecurrenceScopeChoice } from "@/calendar-core/src/calendar-recurrence-scope";

describe("CalendarRecurrenceScopeDialog", () => {
  beforeEach(() => {
    cleanup();
  });

  it("edit action offers only this / all future as stacked buttons", () => {
    const resolve = vi.fn();
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{ action: "edit", resolve }}
        labels={defaultCalendarLabels}
      />,
    );

    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.recurrenceScopeThisInstance }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.recurrenceScopeThisAndFuture }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.recurrenceScopeAllInstances }),
    ).toBeNull();
    expect(screen.getByText(defaultCalendarLabels.recurrenceScopeEditTitle)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.recurrenceScopeEditDescription)).toBeTruthy();
  });

  it("delete action offers all events and resolves it immediately", () => {
    let chosen: RecurrenceScopeChoice | null | undefined;
    const resolve = vi.fn((scope: RecurrenceScopeChoice | null) => {
      chosen = scope;
    });
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{ action: "delete", resolve }}
        labels={defaultCalendarLabels}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.recurrenceScopeAllInstances }),
    );

    expect(resolve).toHaveBeenCalledWith("allInstances");
    expect(chosen).toBe("allInstances");
  });

  it("primary action resolves thisInstance without a continue step", () => {
    const resolve = vi.fn();
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{ action: "edit", resolve }}
        labels={defaultCalendarLabels}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.recurrenceScopeThisInstance }),
    );

    expect(resolve).toHaveBeenCalledWith("thisInstance");
  });

  it("shows a custom description when provided", () => {
    const resolve = vi.fn();
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{
          action: "edit",
          description: "Do you want to move only this occurrence to 11/08/2026, 14:00?",
          resolve,
        }}
        labels={defaultCalendarLabels}
      />,
    );

    expect(
      screen.getByText("Do you want to move only this occurrence to 11/08/2026, 14:00?"),
    ).toBeTruthy();
  });

  it("cancel resolves null", () => {
    const resolve = vi.fn();
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{ action: "delete", resolve }}
        labels={defaultCalendarLabels}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.cancel }));

    expect(resolve).toHaveBeenCalledWith(null);
  });
});

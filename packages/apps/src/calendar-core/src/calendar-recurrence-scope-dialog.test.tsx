import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarRecurrenceScopeDialog } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import type { RecurrenceScopeChoice } from "@/calendar-core/src/calendar-recurrence-scope";

describe("CalendarRecurrenceScopeDialog", () => {
  beforeEach(() => {
    cleanup();
  });

  it("edit action offers only this / this and future", () => {
    const resolve = vi.fn();
    render(
      <CalendarRecurrenceScopeDialog
        dialog={{ action: "edit", resolve }}
        labels={defaultCalendarLabels}
      />,
    );

    expect(screen.getByText(defaultCalendarLabels.recurrenceScopeThisInstance)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.recurrenceScopeThisAndFuture)).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.recurrenceScopeAllInstances)).toBeNull();
  });

  it("delete action offers all instances and resolves it", () => {
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

    const allInstances = screen.getByLabelText(defaultCalendarLabels.recurrenceScopeAllInstances);
    fireEvent.click(allInstances);
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.recurrenceScopeContinue }),
    );

    expect(resolve).toHaveBeenCalledWith("allInstances");
    expect(chosen).toBe("allInstances");
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

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { MyCalendarsSidebarSection } from "@/calendar-core/src/calendar-sidebar-rows";
import type { CalendarInfo } from "@/lib/models/calendar-types";

const calendars = [
  { id: "personal", name: "Personal", color: "#0ea5e9" },
  { id: "work", name: "Work", color: "#f43f5e" },
] as CalendarInfo[];

function renderSection(hidden: string[]) {
  const onSetVisible = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <MyCalendarsSidebarSection
        rowProps={{
          calendars,
          hiddenCalendarIds: new Set(hidden),
          canDeleteCalendars: false,
          canUnsubscribe: false,
          editLabel: "Edit",
          subscribedLabel: "Subscribed",
          viewOnlyLabel: "View only",
          pendingSyncLabel: "Pending",
          onToggleVisibility: vi.fn(),
          onSelectDefault: vi.fn(),
          onEdit: vi.fn(),
        }}
        onSetVisible={onSetVisible}
        labels={defaultCalendarLabels}
      />
    </TooltipProvider>,
  );
  return { onSetVisible };
}

describe("MyCalendarsSidebarSection", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("hides every calendar from the heading while all are shown", () => {
    const { onSetVisible } = renderSection([]);
    const all = screen.getByRole("checkbox", { name: "Hide all my calendars" });
    expect(all.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(all);
    expect(onSetVisible).toHaveBeenCalledWith(["personal", "work"], false);
  });

  it("shows every calendar while only some are shown, and says it is mixed", () => {
    const { onSetVisible } = renderSection(["work"]);
    const all = screen.getByRole("checkbox", { name: "Show all my calendars" });
    expect(all.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(all);
    expect(onSetVisible).toHaveBeenCalledWith(["personal", "work"], true);
  });

  it("folds from the title and remembers the fold", () => {
    renderSection([]);
    const fold = screen.getByRole("button", { name: "My calendars" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    const section = screen.getByRole("region", { name: "My calendars" });
    expect(within(section).queryByText("Personal")).toBeNull();
    // The All row folds away with the rows.
    expect(screen.queryByRole("checkbox", { name: "Hide all my calendars" })).toBeNull();
    cleanup();
    renderSection([]);
    expect(screen.getByRole("button", { name: "My calendars" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByText("Personal")).toBeNull();
  });
});

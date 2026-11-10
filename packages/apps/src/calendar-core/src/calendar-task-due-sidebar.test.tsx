import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { createSharedTasksLists } from "@/lib/api/mock/tasks-bootstrap";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  CalendarTaskDueSidebarRows,
  CalendarRemindersSidebarSection,
  partitionCalendarTaskDueSidebarLists,
} from "@/calendar-core/src/calendar-task-due-sidebar";

function renderRows() {
  const onToggleVisibility = vi.fn();
  const selectDefaultCalendar = vi.fn();
  const { ownedLists, sharedLists } =
    partitionCalendarTaskDueSidebarLists(createSharedTasksLists());
  render(
    <TooltipProvider delayDuration={0}>
      <ul>
        <CalendarTaskDueSidebarRows
          lists={ownedLists}
          hiddenListIds={new Set()}
          viewOnlyLabel={defaultCalendarLabels.viewOnlyCalendarBadge}
          onToggleVisibility={onToggleVisibility}
        />
        {sharedLists.length > 0 ? (
          <CalendarTaskDueSidebarRows
            lists={sharedLists}
            hiddenListIds={new Set()}
            viewOnlyLabel={defaultCalendarLabels.viewOnlyCalendarBadge}
            onToggleVisibility={onToggleVisibility}
          />
        ) : null}
      </ul>
    </TooltipProvider>,
  );
  return { onToggleVisibility, selectDefaultCalendar, ownedLists, sharedLists };
}

describe("Calendar task due sidebar", () => {
  beforeEach(() => {
    cleanup();
  });

  it("labels overlay sections Reminders, not Tasks", () => {
    expect(defaultCalendarLabels.tasksSection).toBe("Reminders");
    expect(defaultCalendarLabels.sharedTaskListsSection).toBe("Shared reminders");
  });

  it("lists owned lists separately from inbound shared lists", () => {
    const { ownedLists, sharedLists } =
      partitionCalendarTaskDueSidebarLists(createSharedTasksLists());
    expect(ownedLists.some((list) => list.isSharee)).toBe(false);
    expect(sharedLists.length).toBeGreaterThan(0);
    expect(sharedLists.every((list) => list.isSharee)).toBe(true);
  });

  it("toggles overlay visibility from the checkbox and does not select a create-target", () => {
    const { onToggleVisibility, selectDefaultCalendar, ownedLists } = renderRows();
    const work = ownedLists.find((list) => list.id === "work");
    expect(work).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: `Hide ${work!.name}` }));
    expect(onToggleVisibility).toHaveBeenCalledWith(work!.id);
    expect(selectDefaultCalendar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: work!.name }));
    expect(selectDefaultCalendar).not.toHaveBeenCalled();
    expect(screen.getByText(work!.name).closest(".calendar-sidebar-row")?.className).not.toMatch(
      /calendar-sidebar-row--selected/,
    );
    expect(
      screen
        .getByText(work!.name)
        .closest(".calendar-sidebar-row")
        ?.querySelector(".calendar-sidebar-row__edit"),
    ).toBeNull();
  });
});

describe("Calendar Reminders section", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function renderSection(hidden: string[]) {
    const { ownedLists } = partitionCalendarTaskDueSidebarLists(createSharedTasksLists());
    const onSetHiddenListIds = vi.fn();
    const view = render(
      <TooltipProvider delayDuration={0}>
        <CalendarRemindersSidebarSection
          lists={ownedLists}
          hiddenListIds={new Set(hidden)}
          onSetHiddenListIds={onSetHiddenListIds}
          onToggleVisibility={vi.fn()}
          labels={defaultCalendarLabels}
        />
      </TooltipProvider>,
    );
    return { ownedLists, onSetHiddenListIds, view };
  }

  it("shows all lists from the heading while some are hidden, keeping other hidden ids", () => {
    const { ownedLists, onSetHiddenListIds } = renderSection(["work", "elsewhere"]);
    expect(ownedLists.map((list) => list.id)).toContain("work");
    const all = screen.getByRole("checkbox", { name: "Show all reminders" });
    expect(all.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(all);
    expect([...onSetHiddenListIds.mock.calls[0]![0]]).toEqual(["elsewhere"]);
  });

  it("hides every list from the heading while all are shown", () => {
    const { ownedLists, onSetHiddenListIds } = renderSection([]);
    const all = screen.getByRole("checkbox", { name: "Hide all reminders" });
    expect(all.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(all);
    expect(new Set(onSetHiddenListIds.mock.calls[0]![0])).toEqual(
      new Set(ownedLists.map((list) => list.id)),
    );
  });

  it("folds and remembers the fold", () => {
    renderSection([]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Reminders" }));
    expect(screen.queryByText("Personal")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand Reminders" }).getAttribute("aria-expanded"),
    ).toBe("false");
    cleanup();
    renderSection([]);
    expect(screen.queryByText("Personal")).toBeNull();
  });

  it("renders nothing without lists", () => {
    const { container } = render(
      <CalendarRemindersSidebarSection
        lists={[]}
        hiddenListIds={new Set()}
        onSetHiddenListIds={vi.fn()}
        onToggleVisibility={vi.fn()}
        labels={defaultCalendarLabels}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

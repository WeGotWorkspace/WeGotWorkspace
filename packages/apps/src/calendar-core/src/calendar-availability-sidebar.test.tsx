import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarAvailabilitySidebar } from "@/calendar-core/src/calendar-availability-sidebar";
import { createTeamAvailabilityFixture } from "@/calendar-core/src/calendar-availability-fixture";
import { orderTeamMembers } from "@/calendar-core/src/use-team-availability";

function renderSidebar({
  count,
  shown = [],
  incomplete = [],
  collapsed = false,
}: {
  count: number;
  shown?: string[];
  incomplete?: string[];
  collapsed?: boolean;
}) {
  const { members } = createTeamAvailabilityFixture({ count, anchor: "2033-01-12" });
  const toggleShown = vi.fn();
  const setShown = vi.fn();
  const toggleCollapsed = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <CalendarAvailabilitySidebar
        labels={defaultCalendarLabels}
        availability={{
          members: orderTeamMembers(members),
          shownIds: new Set(shown),
          incompleteIds: new Set(incomplete),
          collapsed,
          toggleShown,
          setShown,
          toggleCollapsed,
        }}
      />
    </TooltipProvider>,
  );
  return { toggleShown, setShown, toggleCollapsed };
}

/** The per-person checkboxes, without the heading's show/hide-all dot. */
function rowBoxes(): HTMLElement[] {
  return within(screen.getByRole("list")).queryAllByRole("checkbox");
}

describe("CalendarAvailabilitySidebar", () => {
  it("lists the own row first and every row hidden by default", () => {
    renderSidebar({ count: 3 });
    const section = screen.getByRole("region", { name: "Team availability" });
    const boxes = within(within(section).getByRole("list")).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Show your own availability",
      "Show Ada Lovelace's availability",
      "Show Grace Hopper's availability",
    ]);
    expect(boxes.every((box) => box.getAttribute("aria-checked") === "false")).toBe(true);
    expect(within(section).getByText("You (as teammates see you)")).toBeTruthy();
    expect(within(section).queryByRole("searchbox")).toBeNull();
  });

  it("toggles a teammate and names the action", () => {
    const { toggleShown } = renderSidebar({ count: 3, shown: ["ada"] });
    const hide = screen.getByRole("checkbox", { name: "Hide Ada Lovelace's availability" });
    fireEvent.click(hide);
    expect(toggleShown).toHaveBeenCalledWith("ada");
  });

  it("marks a shown teammate whose busy times are incomplete", () => {
    renderSidebar({ count: 3, shown: ["ada", "grace"], incomplete: ["grace"] });
    const marks = screen.getAllByRole("img", { name: "Some busy times could not be loaded." });
    expect(marks).toHaveLength(1);
    expect(marks[0]!.closest("li")?.textContent).toContain("Grace Hopper");
  });

  it("shows a filter above eight rows", () => {
    renderSidebar({ count: 12 });
    const filter = screen.getByRole("searchbox", { name: "Filter teammates" });
    fireEvent.change(filter, { target: { value: "torv" } });
    expect(rowBoxes()).toHaveLength(1);
    fireEvent.change(filter, { target: { value: "nobody" } });
    expect(screen.getByText("No teammates match")).toBeTruthy();
  });

  it("folds the list", () => {
    const { toggleCollapsed } = renderSidebar({ count: 3, collapsed: true });
    expect(screen.getAllByRole("checkbox", { hidden: true }).map((box) => box.className)).toEqual([
      expect.stringContaining("sidebar-section__toggle-all"),
    ]);
    const expand = screen.getByRole("button", { name: "Expand Team availability" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(toggleCollapsed).toHaveBeenCalledOnce();
  });

  it("shows everyone from the heading while none are on", () => {
    const { setShown } = renderSidebar({ count: 3 });
    const all = screen.getByRole("checkbox", { name: "Show all teammates' availability" });
    expect(all.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(all);
    expect(setShown).toHaveBeenCalledWith(["me", "ada", "grace"], true);
  });

  it("shows everyone while only some are on, and says it is mixed", () => {
    const { setShown } = renderSidebar({ count: 3, shown: ["ada"] });
    const all = screen.getByRole("checkbox", { name: "Show all teammates' availability" });
    expect(all.getAttribute("aria-checked")).toBe("mixed");
    expect(all.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(all);
    expect(setShown).toHaveBeenCalledWith(["me", "ada", "grace"], true);
  });

  it("hides everyone while all are on, including rows a filter leaves out", () => {
    const { members } = createTeamAvailabilityFixture({ count: 12, anchor: "2033-01-12" });
    const ids = orderTeamMembers(members).map((member) => member.id);
    const { setShown } = renderSidebar({ count: 12, shown: ids });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "torv" } });
    const all = screen.getByRole("checkbox", { name: "Hide all teammates' availability" });
    expect(all.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(all);
    expect(setShown).toHaveBeenCalledWith(ids, false);
  });

  it("renders nothing without teammates", () => {
    const { container } = render(
      <CalendarAvailabilitySidebar
        labels={defaultCalendarLabels}
        availability={{
          members: [],
          shownIds: new Set(),
          incompleteIds: new Set(),
          collapsed: false,
          toggleShown: vi.fn(),
          setShown: vi.fn(),
          toggleCollapsed: vi.fn(),
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

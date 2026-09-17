import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { TooltipProvider } from "@/ui/tooltip";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { TaskDueOverlayMarker } from "@/calendar-core/src/calendar-task-due-overlay";
import { CalendarTaskDuePopover } from "@/calendar-core/src/calendar-task-due-popover";

const { isMobileRef } = vi.hoisted(() => ({ isMobileRef: { current: false } }));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileRef.current,
  MOBILE_BREAKPOINT_PX: 768,
  MOBILE_MEDIA_QUERY: "(max-width: 767px)",
}));

const marker: TaskDueOverlayMarker = {
  key: "task:milk",
  taskId: "milk",
  taskListId: "errands",
  listName: "Errands",
  listColor: "#6366f1",
  title: "Buy milk",
  due: "2033-01-12",
  allDay: true,
  event: {
    overlayKind: "task",
    overlayTaskListId: "errands",
    eventId: "task:milk",
    data: {
      start: Temporal.PlainDateTime.from("2033-01-12T00:00:00"),
      allDay: true,
      summary: "Buy milk",
      color: "#6366f1",
      duration: Temporal.Duration.from({ days: 1 }),
    },
  },
};

describe("CalendarTaskDuePopover", () => {
  beforeEach(() => {
    cleanup();
    isMobileRef.current = false;
  });

  it("shows title, due, list, and Open in Tasks", () => {
    const onOpenInTasks = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <CalendarTaskDuePopover
          open
          marker={marker}
          labels={defaultCalendarLabels}
          locale="en-US"
          onClose={vi.fn()}
          onOpenInTasks={onOpenInTasks}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.getByText("Errands")).toBeTruthy();
    const openInTasks = screen.getByRole("button", {
      name: defaultCalendarLabels.taskDueOpenInTasks,
    });
    expect(openInTasks.className).toContain("button--variant-outline");
    expect(openInTasks.className).not.toContain("button--variant-primary");
    fireEvent.click(openInTasks);
    expect(onOpenInTasks).toHaveBeenCalledWith("/tasks/lists/errands?task=milk");
  });

  it("opens a centered Dialog on mobile", () => {
    isMobileRef.current = true;
    render(
      <TooltipProvider delayDuration={0}>
        <CalendarTaskDuePopover
          open
          marker={marker}
          labels={defaultCalendarLabels}
          locale="en-US"
          onClose={vi.fn()}
          onOpenInTasks={vi.fn()}
        />
      </TooltipProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("ui-modal-surface--center");
    expect(dialog.className).toContain("calendar-event-details-popover--dialog");
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.taskDueOpenInTasks }).className,
    ).toContain("button--variant-outline");
  });
});

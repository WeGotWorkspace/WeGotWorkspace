import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";

const L = defaultCalendarLabels;

describe("CalendarNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("creates an event from the main control without opening a menu", () => {
    const onCreateEvent = vi.fn();
    render(
      <CalendarNewMenu
        labels={L}
        onCreateEvent={onCreateEvent}
        onCreateCalendar={vi.fn()}
        onSubscribeCalendar={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.newEvent }));

    expect(onCreateEvent).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: L.createCalendar })).toBeNull();
  });

  it("opens calendar actions from the chevron", () => {
    const onCreateCalendar = vi.fn();
    const onSubscribeCalendar = vi.fn();
    render(
      <CalendarNewMenu
        labels={L}
        onCreateEvent={vi.fn()}
        onCreateCalendar={onCreateCalendar}
        onSubscribeCalendar={onSubscribeCalendar}
      />,
    );

    const chevron = screen.getByRole("button", { name: L.newEventMenu });
    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.createCalendar }));
    expect(onCreateCalendar).toHaveBeenCalledOnce();

    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.subscribeCalendar }));
    expect(onSubscribeCalendar).toHaveBeenCalledOnce();
  });

  it("hides the chevron when there are no calendar actions", () => {
    render(<CalendarNewMenu labels={L} onCreateEvent={vi.fn()} />);

    const main = screen.getByRole("button", { name: L.newEvent });
    expect(main).toBeTruthy();
    expect(main.className).toMatch(/calendar-new-menu__main--solo/);
    expect(screen.queryByRole("button", { name: L.newEventMenu })).toBeNull();
  });

  it("joins the split halves with BEM classes", () => {
    render(
      <CalendarNewMenu
        labels={L}
        onCreateEvent={vi.fn()}
        onCreateCalendar={vi.fn()}
        onSubscribeCalendar={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: L.newEvent }).className).toMatch(
      /calendar-new-menu__main/,
    );
    expect(screen.getByRole("button", { name: L.newEventMenu }).className).toMatch(
      /calendar-new-menu__menu/,
    );
  });
});

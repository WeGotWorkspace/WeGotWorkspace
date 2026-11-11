import type { MouseEvent } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import type { AgendaDay } from "@/lib/calendar-elements/utils/agenda-days";
import type { ConfirmDialogRequest } from "@/hooks/use-confirm-dialog";
import { defaultCalendarLabels as L } from "@/calendar-core/src/calendar-labels";
import {
  calendarListRows,
  useCalendarListSelection,
} from "@/calendar-core/src/use-calendar-list-selection";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => cleanup());

const calendars = [
  { id: "work", name: "Work", color: "#00f" },
  { id: "family", name: "Family", color: "#0f0" },
  { id: "holidays", name: "US Holidays", color: "#f00", mayWrite: false },
] as unknown as CalendarInfo[];

const rows = new Map<string, string | undefined>([
  ["a", "work"],
  ["b", "work"],
  ["c", "holidays"],
]);

const click = (modifiers: Partial<MouseEvent> = {}) =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, ...modifiers }) as MouseEvent;

function renderSelection() {
  const deleteEvents = vi.fn();
  const moveEvents = vi.fn();
  const openEvent = vi.fn();
  const requestConfirm = vi.fn<(request: ConfirmDialogRequest) => void>();
  const hook = renderHook(
    ({ resetKey }) =>
      useCalendarListSelection({
        L,
        rows,
        resetKey,
        activeKey: "",
        calendars,
        openEvent,
        leaveEvent: vi.fn(),
        requestConfirm,
        deleteEvents,
        moveEvents,
      }),
    { initialProps: { resetKey: "week" } },
  );
  return { ...hook, deleteEvents, moveEvents, openEvent, requestConfirm };
}

describe("calendarListRows", () => {
  it("lists the period's rows in order with their calendars", () => {
    const event = (calendarId: string) => ({ calendarId }) as never;
    const days = [
      { date: Temporal.PlainDate.from("2033-01-10"), items: [{ id: "x", event: event("work") }] },
      { date: Temporal.PlainDate.from("2033-01-11"), items: [{ id: "y", event: event("family") }] },
    ] as unknown as AgendaDay[];
    expect([...calendarListRows(days, null)]).toEqual([
      ["x", "work"],
      ["y", "family"],
    ]);
  });

  it("lists the search hits instead while searching, past first", () => {
    const hit = (key: string, calendarId: string) => ({ key, calendarId }) as never;
    const results = {
      past: [hit("p2", "work"), hit("p1", "work")],
      upcoming: [hit("u1", "family")],
    };
    expect([...calendarListRows([], results as never).keys()]).toEqual(["p1", "p2", "u1"]);
  });
});

describe("useCalendarListSelection", () => {
  it("opens the event on a plain click; Cmd-click picks more", () => {
    const { result, openEvent } = renderSelection();
    act(() => result.current.selection.onItemClick("a", click()));
    expect(openEvent).toHaveBeenCalledWith("a");
    expect(result.current.multiSelected).toBe(false);

    act(() => result.current.selection.onItemClick("b", click({ metaKey: true })));
    expect(result.current.selectedIds).toEqual(["a", "b"]);
    expect(result.current.multiSelected).toBe(true);
  });

  it("offers Move and Delete only for events in writable calendars, then Done", () => {
    const { result } = renderSelection();
    act(() => result.current.selection.onItemClick("c", click()));
    act(() => result.current.selection.onItemClick("b", click({ metaKey: true })));
    expect(result.current.selectionBarButtons.map((button) => button.label)).toEqual([
      L.selectionMoveToCalendar,
      L.delete,
      L.selectionDone,
    ]);

    act(() => result.current.selection.onItemClick("b", click({ metaKey: true })));
    act(() => result.current.selection.onItemLongPress?.("c"));
    // Only a holiday picked: nothing to move or delete.
    expect(result.current.selectionBarButtons.map((button) => button.label)).toEqual([
      L.selectionDone,
    ]);
  });

  it("asks before deleting, then deletes the writable picks and leaves multi-select", () => {
    const { result, requestConfirm, deleteEvents } = renderSelection();
    act(() => result.current.selection.onItemClick("a", click()));
    act(() => result.current.selection.onItemClick("c", click({ shiftKey: true })));
    expect(result.current.selectedIds).toEqual(["a", "b", "c"]);

    const remove = result.current.selectionBarButtons.find((button) => button.label === L.delete);
    act(() => remove?.onClick?.());
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const request = requestConfirm.mock.calls[0]![0];
    expect(request.title).toBe(L.deleteEventsConfirmTitle(2));
    expect(deleteEvents).not.toHaveBeenCalled();

    act(() => request.onConfirm());
    expect(deleteEvents).toHaveBeenCalledWith(["a", "b"]);
    expect(result.current.multiSelected).toBe(false);
  });

  it("ends a multi-selection when the period changes", () => {
    const { result, rerender } = renderSelection();
    act(() => result.current.selection.onItemLongPress?.("a"));
    expect(result.current.multiSelected).toBe(true);
    rerender({ resetKey: "next-week" });
    expect(result.current.multiSelected).toBe(false);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("moves the picks to the calendar chosen in the dialog", () => {
    const { result, moveEvents } = renderSelection();
    act(() => result.current.selection.onItemClick("a", click()));
    act(() => result.current.selection.onItemClick("b", click({ metaKey: true })));
    const move = result.current.selectionBarButtons.find(
      (button) => button.label === L.selectionMoveToCalendar,
    );
    act(() => move?.onClick?.());

    const { rerender } = render(result.current.moveDialog);
    const confirm = screen.getByRole("button", { name: L.selectionMove });
    // Starts on their own calendar: nothing to move yet.
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(screen.getByRole("combobox", { name: L.selectionMoveField }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("option", { name: /Family/ }));
    rerender(result.current.moveDialog);
    fireEvent.click(screen.getByRole("button", { name: L.selectionMove }));
    expect(moveEvents).toHaveBeenCalledWith(["a", "b"], "family");
  });
});

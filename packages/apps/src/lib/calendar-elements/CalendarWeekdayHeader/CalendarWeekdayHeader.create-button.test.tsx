import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWeekdayHeader } from "./CalendarWeekdayHeader";
import "./CalendarWeekdayHeader";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

describe("CalendarWeekdayHeader date-mode + button", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("exposes a named + button per date column and emits day-create-requested", async () => {
    const el = document.createElement("calendar-weekday-header") as CalendarWeekdayHeader;
    el.lang = "en-US";
    el.startDate = "2026-08-17";
    el.daysPerWeek = 7;
    document.body.append(el);
    await el.updateComplete;

    const created = vi.fn();
    const selected = vi.fn();
    el.addEventListener("day-create-requested", created);
    el.addEventListener("day-selection", selected);

    const plusButtons = [
      ...(el.shadowRoot?.querySelectorAll(".weekday-create-button") ?? []),
    ] as HTMLButtonElement[];
    expect(plusButtons).toHaveLength(7);
    expect(plusButtons[0]?.ariaLabel).toMatch(/^Create event on .*August 17/);

    plusButtons[0]!.click();
    expect(selected).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<{ date?: string; dayIndex?: number }>;
    expect(event.composed).toBe(true);
    expect(event.detail.date).toBe("2026-08-17");
    expect(event.detail.dayIndex).toBe(0);
  });

  it("keeps day-number click as day-selection", async () => {
    const el = document.createElement("calendar-weekday-header") as CalendarWeekdayHeader;
    el.lang = "en-US";
    el.startDate = "2026-08-17";
    el.daysPerWeek = 1;
    document.body.append(el);
    await el.updateComplete;

    const created = vi.fn();
    const selected = vi.fn();
    el.addEventListener("day-create-requested", created);
    el.addEventListener("day-selection", selected);

    const dayButton = el.shadowRoot?.querySelector(".weekday-date-button") as HTMLButtonElement;
    expect(dayButton).toBeTruthy();
    dayButton.click();

    expect(created).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.detail.date).toBe("2026-08-17");
  });

  it("does not render + buttons in label-only weekday mode", async () => {
    const el = document.createElement("calendar-weekday-header") as CalendarWeekdayHeader;
    el.lang = "en-US";
    el.weekStart = 1;
    el.daysPerWeek = 7;
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".weekday-create-button")).toBeNull();
  });
});

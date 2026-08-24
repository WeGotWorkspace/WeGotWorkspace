import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { WgwCalendarSurface } from "@/lib/calendar-elements/wgw/wgw-calendar-surface";

function mockDomApis() {
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
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

async function echoViewChanged(host: WgwCalendarSurface, view: "day" | "week") {
  host.view = view;
  host.dispatchEvent(new CustomEvent("view-changed", { bubbles: true, composed: true }));
}

type LitHost = HTMLElement & { updateComplete?: Promise<unknown> };

/** Year grid re-forwards inner-month `day-selection`; React only hears it when composed. */
async function yearInnerMonth(host: WgwCalendarSurface): Promise<Element | null> {
  const group = host.shadowRoot?.querySelector("calendar-view-group") as LitHost | null;
  await group?.updateComplete;
  const yearView = group?.shadowRoot?.querySelector("calendar-timeline-view") as LitHost | null;
  await yearView?.updateComplete;
  return yearView?.shadowRoot?.querySelector("calendar-timeline-view") ?? null;
}

describe("CalendarSurface Lit view echo", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not bounce React when Lit echoes view-changed(day) after a dropdown week write", async () => {
    const onViewChange = vi.fn();
    const { rerender } = render(
      <CalendarSurface
        view="day"
        presentation="grid"
        startDate="2026-08-19"
        events={new Map()}
        onViewChange={onViewChange}
      />,
    );

    rerender(
      <CalendarSurface
        view="week"
        presentation="grid"
        startDate="2026-08-19"
        events={new Map()}
        onViewChange={onViewChange}
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await act(async () => {
      await host!.updateComplete;
      // Past the old 300ms ignore window — leftover echoes must still be ignored.
      await new Promise((resolve) => setTimeout(resolve, 350));
      echoViewChanged(host!, "day");
    });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("treats a user day-selection as the only Lit → React view write", async () => {
    const onViewChange = vi.fn();
    const onStartDateChange = vi.fn();
    render(
      <CalendarSurface
        view="week"
        presentation="grid"
        startDate="2026-08-19"
        events={new Map()}
        onViewChange={onViewChange}
        onStartDateChange={onStartDateChange}
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await act(async () => {
      await host!.updateComplete;
      host!.dispatchEvent(
        new CustomEvent("day-selection", {
          bubbles: true,
          composed: true,
          detail: { date: "2026-08-18" },
        }),
      );
    });

    await waitFor(() => {
      expect(onViewChange).toHaveBeenCalledWith("day");
    });
    expect(onStartDateChange).toHaveBeenCalledWith("2026-08-18");
  });

  it("navigates to day from a year inner-month day-selection", async () => {
    const onViewChange = vi.fn();
    const onStartDateChange = vi.fn();
    render(
      <CalendarSurface
        view="year"
        presentation="grid"
        startDate="2026-01-01"
        events={new Map()}
        onViewChange={onViewChange}
        onStartDateChange={onStartDateChange}
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await act(async () => {
      await host!.updateComplete;
      const innerMonth = await yearInnerMonth(host!);
      expect(innerMonth).toBeTruthy();
      innerMonth!.dispatchEvent(
        new CustomEvent("day-selection", {
          bubbles: true,
          composed: true,
          detail: { date: "2026-08-18" },
        }),
      );
    });

    await waitFor(() => {
      expect(onViewChange).toHaveBeenCalledWith("day");
    });
    expect(onStartDateChange).toHaveBeenCalledWith("2026-08-18");
  });
});

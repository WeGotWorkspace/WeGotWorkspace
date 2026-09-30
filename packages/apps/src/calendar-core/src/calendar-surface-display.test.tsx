import { cleanup, render, waitFor } from "@testing-library/react";
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

describe("CalendarSurface display prefs", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  afterEach(() => {
    cleanup();
  });

  it("mirrors locale, timezone, weekStart, and visibleHours onto the Lit host", async () => {
    render(
      <CalendarSurface
        view="week"
        presentation="grid"
        startDate="2033-01-12"
        events={new Map()}
        locale="nl-NL"
        timezone="Europe/Amsterdam"
        weekStart={1}
        visibleHours={12}
        visibleHoursStart={8}
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await waitFor(() => {
      expect(host!.lang).toBe("nl-NL");
      expect(host!.timezone).toBe("Europe/Amsterdam");
      expect(host!.weekStart).toBe(1);
      expect(host!.visibleHours).toBe(12);
      expect(host!.visibleHoursStart).toBe(8);
    });
  });

  it("leaves visibleHours unset when omitted", async () => {
    render(
      <CalendarSurface
        view="week"
        presentation="grid"
        startDate="2033-01-12"
        events={new Map()}
        locale="nl-NL"
        timezone="Europe/Amsterdam"
        weekStart={1}
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await waitFor(() => {
      expect(host!.weekStart).toBe(1);
    });
    expect(host!.visibleHours).toBeUndefined();
    expect(host!.visibleHoursStart).toBeUndefined();
  });
});

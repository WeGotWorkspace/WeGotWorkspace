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

describe("CalendarSurface selectedEventKey", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  afterEach(() => {
    cleanup();
  });

  it("mirrors the popover event key onto the Lit host and clears it when closed", async () => {
    const { rerender } = render(
      <CalendarSurface
        view="day"
        presentation="grid"
        startDate="2033-01-12"
        events={new Map()}
        selectedEventKey="dentist"
      />,
    );

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    await waitFor(() => {
      expect(host!.selectedEventKey).toBe("dentist");
    });

    rerender(
      <CalendarSurface
        view="day"
        presentation="grid"
        startDate="2033-01-12"
        events={new Map()}
        selectedEventKey=""
      />,
    );

    await waitFor(() => {
      expect(host!.selectedEventKey).toBe("");
    });
  });
});

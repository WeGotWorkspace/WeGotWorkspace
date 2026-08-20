import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeLine } from "./TimeLine";
import "./TimeLine";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

describe("TimeLine selected-event resize handles", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("activates grabbers only for the selected event key", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.events = [
      { start: 10, end: 40, key: "dentist" },
      { start: 50, end: 80, key: "standup" },
    ];
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll("resize-handle[active]")).toHaveLength(0);

    el.selectedEventKey = "dentist";
    await el.updateComplete;

    const dentist = el.shadowRoot?.querySelector('.event[data-index="0"]');
    const standup = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(dentist?.querySelectorAll("resize-handle[active]")).toHaveLength(2);
    expect(standup?.querySelectorAll("resize-handle[active]")).toHaveLength(0);

    const style = dentist instanceof HTMLElement ? (dentist.getAttribute("style") ?? "") : "";
    expect(style).toMatch(/--__start:\s*[\d.]+%/);
    expect(style).toMatch(/--__end:/);
    expect(style).not.toContain("--_lc-event-bg");
  });
});

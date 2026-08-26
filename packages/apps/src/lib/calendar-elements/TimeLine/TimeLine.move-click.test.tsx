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

function pointerOn(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  extra: PointerEventInit = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX,
      clientY,
      ...extra,
    }),
  );
}

describe("TimeLine move click-to-select", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not commit a move for a click with sub-threshold travel", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    el.events = [{ start: 570, end: 600, key: "standup", color: "#6366f1" }];
    document.body.append(el);
    await el.updateComplete;

    const moved = vi.fn();
    el.addEventListener("timeline-event-move", moved);

    const eventEl = el.shadowRoot?.querySelector(".event");
    expect(eventEl).toBeInstanceOf(HTMLElement);
    if (!(eventEl instanceof HTMLElement)) return;

    pointerOn(eventEl, "pointerdown", 40, 80);
    pointerOn(window, "pointermove", 41, 81);
    pointerOn(window, "pointerup", 41, 81);

    expect(moved).not.toHaveBeenCalled();
    expect(el.shadowRoot?.querySelector(".event--dragging")).toBeNull();
  });

  it("commits a move once travel passes the drag threshold", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    el.events = [{ start: 570, end: 600, key: "standup", color: "#6366f1" }];
    document.body.append(el);
    await el.updateComplete;

    const moved = vi.fn();
    el.addEventListener("timeline-event-move", moved);

    const eventEl = el.shadowRoot?.querySelector(".event");
    expect(eventEl).toBeInstanceOf(HTMLElement);
    if (!(eventEl instanceof HTMLElement)) return;

    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 200, height: 1440, right: 200, bottom: 1440 }),
    });
    const main = el.shadowRoot?.querySelector(".cell-main");
    if (main instanceof HTMLElement) {
      Object.defineProperty(main, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 200, height: 1440, right: 200, bottom: 1440 }),
      });
    }

    pointerOn(eventEl, "pointerdown", 40, 570);
    pointerOn(window, "pointermove", 40, 650);
    pointerOn(window, "pointerup", 40, 650);

    expect(moved).toHaveBeenCalled();
  });

  it("lifts the moved card into the top-layer overlay", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 7;
    el.columns = 7;
    el.max = 1440;
    el.step = 15;
    el.flow = "horizontal";
    el.layout = "masonry";
    el.height = "auto";
    el.events = [
      { start: 0, end: 1440, key: "early", color: "#6366f1" },
      { start: 6 * 1440, end: 7 * 1440, key: "late", color: "#0f766e" },
    ];
    document.body.append(el);
    await el.updateComplete;

    const early = el.shadowRoot?.querySelector('.event[data-index="0"]');
    const late = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(early).toBeInstanceOf(HTMLElement);
    expect(late).toBeInstanceOf(HTMLElement);
    if (!(early instanceof HTMLElement) || !(late instanceof HTMLElement)) return;

    const originCell = early.closest(".cell");
    const laterCell = late.closest(".cell");
    expect(originCell).toBeInstanceOf(HTMLElement);
    expect(laterCell).toBeInstanceOf(HTMLElement);
    if (!(originCell instanceof HTMLElement) || !(laterCell instanceof HTMLElement)) return;

    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 700, height: 200, right: 700, bottom: 200 }),
    });
    for (const main of el.shadowRoot?.querySelectorAll(".cell-main") ?? []) {
      if (!(main instanceof HTMLElement)) continue;
      Object.defineProperty(main, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200 }),
      });
    }

    pointerOn(early, "pointerdown", 20, 20);
    pointerOn(window, "pointermove", 80, 20);
    await el.updateComplete;

    expect(early.classList.contains("event--dragging")).toBe(true);
    expect(originCell.querySelector(".event--dragging")).toBe(early);
    expect(laterCell.querySelector(".event--dragging")).toBeNull();

    const overlay = el.shadowRoot?.querySelector(".event--drag-overlay");
    const layer = el.shadowRoot?.querySelector(".drag-layer");
    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(layer).toBeInstanceOf(HTMLElement);
    expect(layer?.parentElement?.classList.contains("viewport")).toBe(true);
    expect(layer?.getAttribute("popover")).toBe("manual");
    expect(overlay?.closest(".cell")).toBeNull();
    expect(early.classList.contains("event--drag-overlay")).toBe(false);
    expect(early.style.transform).not.toMatch(/translate/);
  });
});

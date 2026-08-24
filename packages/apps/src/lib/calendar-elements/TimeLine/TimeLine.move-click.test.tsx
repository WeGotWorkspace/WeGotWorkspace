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
});

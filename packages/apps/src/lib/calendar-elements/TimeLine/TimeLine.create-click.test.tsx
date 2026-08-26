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

function dblClickOn(target: EventTarget, clientX: number, clientY: number) {
  target.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      detail: 2,
      clientX,
      clientY,
    }),
  );
}

function stubCellGeometry(el: TimeLine, height = 1440) {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 200, height, right: 200, bottom: height }),
  });
  const main = el.shadowRoot?.querySelector(".cell-main");
  if (main instanceof HTMLElement) {
    Object.defineProperty(main, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 200, height, right: 200, bottom: height }),
    });
  }
}

describe("TimeLine double-click and keyboard create", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not create for a click with sub-threshold travel", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    document.body.append(el);
    await el.updateComplete;
    stubCellGeometry(el);

    const created = vi.fn();
    el.addEventListener("timeline-event-create", created);

    const main = el.shadowRoot?.querySelector(".cell-main");
    expect(main).toBeInstanceOf(HTMLElement);
    if (!(main instanceof HTMLElement)) return;

    pointerOn(main, "pointerdown", 40, 570);
    pointerOn(window, "pointerup", 41, 571);

    expect(created).not.toHaveBeenCalled();
  });

  it("commits a one-step create on double-click at the snapped pointer time", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    document.body.append(el);
    await el.updateComplete;
    stubCellGeometry(el);

    const created = vi.fn();
    el.addEventListener("timeline-event-create", created);

    const main = el.shadowRoot?.querySelector(".cell-main");
    expect(main).toBeInstanceOf(HTMLElement);
    if (!(main instanceof HTMLElement)) return;

    pointerOn(main, "pointerdown", 40, 570);
    pointerOn(window, "pointerup", 41, 571);
    dblClickOn(main, 40, 570);

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<{ start: number; end: number }>;
    expect(event.detail.start).toBe(570);
    expect(event.detail.end).toBe(585);
  });

  it("still commits a spanned create once travel passes the drag threshold", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    document.body.append(el);
    await el.updateComplete;
    stubCellGeometry(el);

    const created = vi.fn();
    el.addEventListener("timeline-event-create", created);

    const main = el.shadowRoot?.querySelector(".cell-main");
    expect(main).toBeInstanceOf(HTMLElement);
    if (!(main instanceof HTMLElement)) return;

    pointerOn(main, "pointerdown", 40, 570);
    pointerOn(window, "pointermove", 40, 700);
    pointerOn(window, "pointerup", 40, 700);

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<{ start: number; end: number }>;
    expect(event.detail.start).toBe(570);
    expect(event.detail.end).toBeGreaterThan(585);
  });

  it("commits a default 09:00 slot when Enter is pressed on a focused timed cell", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    document.body.append(el);
    await el.updateComplete;

    const created = vi.fn();
    el.addEventListener("timeline-event-create", created);

    const cell = el.shadowRoot?.querySelector(".cell");
    expect(cell).toBeInstanceOf(HTMLElement);
    if (!(cell instanceof HTMLElement)) return;

    cell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<{ start: number; end: number }>;
    expect(event.detail.start).toBe(540);
    expect(event.detail.end).toBe(555);
  });

  it("commits a one-step all-day cell when Space is pressed on a horizontal cell", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 2;
    el.columns = 2;
    el.max = 1440;
    el.step = 1440;
    el.flow = "horizontal";
    document.body.append(el);
    await el.updateComplete;

    const created = vi.fn();
    el.addEventListener("timeline-event-create", created);

    const cell = el.shadowRoot?.querySelector('.cell[data-cell="1"]');
    expect(cell).toBeInstanceOf(HTMLElement);
    if (!(cell instanceof HTMLElement)) return;

    cell.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<{ start: number; end: number }>;
    expect(event.detail.start).toBe(1440);
    expect(event.detail.end).toBe(2880);
  });
});

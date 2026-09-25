import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TimedEventInteractionController } from "./TimedEventInteractionController.js";

const DAY_COUNT = 7;
const SECTION_WIDTH = 700;
const SECTION_HEIGHT = 24 * 60;
const VIEW_START = Temporal.PlainDate.from("2026-03-02");
const ORIGINAL_START = "2026-03-02T09:00:00";
const ORIGINAL_END = "2026-03-02T10:30:00";

type Bounds = {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

class TestElement {
  tagName: string;
  parentElement: TestElement | null = null;
  clientHeight = 0;
  rect: Bounds = bounds(0, 0, 0, 0);
  #attributes = new Map<string, string>();
  #root: TestShadowRoot | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  appendChild(child: TestElement): TestElement {
    child.parentElement = this;
    return child;
  }

  getBoundingClientRect(): Bounds {
    return this.rect;
  }

  setPointerCapture(_pointerId: number): void {}

  releasePointerCapture(_pointerId: number): void {}

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  getRootNode(): TestShadowRoot | TestElement {
    return this.#root ?? this;
  }

  setRootNode(root: TestShadowRoot): void {
    this.#root = root;
  }
}

class TestShadowRoot {
  host: TestElement;

  constructor(host: TestElement) {
    this.host = host;
  }
}

type DateTimeHost = TestElement & {
  start: Temporal.PlainDateTime | string | null;
  end: Temporal.PlainDateTime | string | null;
  viewDays: Temporal.PlainDate[];
  setStartFromPlainDateTime: (value: Temporal.PlainDateTime) => void;
  setEndFromPlainDateTime: (value: Temporal.PlainDateTime) => void;
};

type ControllerHost = HTMLElement & {
  start: Temporal.PlainDateTime | string | null;
  end: Temporal.PlainDateTime | string | null;
  viewDays?: unknown;
  setStartFromPlainDateTime?: (value: Temporal.PlainDateTime) => void;
  setEndFromPlainDateTime?: (value: Temporal.PlainDateTime) => void;
};

function bounds(left: number, top: number, width: number, height: number): Bounds {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function dayCenterX(dayIndex: number): number {
  return ((dayIndex + 0.5) / DAY_COUNT) * SECTION_WIDTH;
}

function timeY(hour: number, minute: number): number {
  const seconds = hour * 3600 + minute * 60;
  return (seconds / (24 * 60 * 60)) * SECTION_HEIGHT;
}

function dateTimeText(value: Temporal.PlainDateTime | string | null): string {
  if (value == null) return "";
  return typeof value === "string" ? value : value.toString();
}

function durationSeconds(
  start: Temporal.PlainDateTime | string | null,
  end: Temporal.PlainDateTime | string | null,
): number {
  return Temporal.PlainDateTime.from(dateTimeText(start))
    .until(Temporal.PlainDateTime.from(dateTimeText(end)))
    .total({ unit: "seconds" });
}

function createHost(): DateTimeHost {
  const section = new TestElement("section");
  section.rect = bounds(0, 0, SECTION_WIDTH, SECTION_HEIGHT);

  const host = new TestElement("timed-event") as DateTimeHost;
  host.rect = bounds(0, 0, SECTION_WIDTH, SECTION_HEIGHT);
  host.clientHeight = SECTION_HEIGHT;
  host.start = Temporal.PlainDateTime.from(ORIGINAL_START);
  host.end = Temporal.PlainDateTime.from(ORIGINAL_END);
  host.viewDays = Array.from({ length: DAY_COUNT }, (_, index) => VIEW_START.add({ days: index }));
  host.setStartFromPlainDateTime = (value) => {
    host.start = value;
  };
  host.setEndFromPlainDateTime = (value) => {
    host.end = value;
  };
  section.appendChild(host);
  return host;
}

function createController(host: DateTimeHost): TimedEventInteractionController {
  return new TimedEventInteractionController(host as unknown as ControllerHost);
}

function pointerEvent(
  host: TestElement,
  target: TestElement,
  clientX: number,
  clientY: number,
  path: TestElement[] = [target, host],
): PointerEvent {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX,
    clientY,
    target,
    currentTarget: host,
    cancelable: false,
    composedPath: () => path,
    preventDefault() {},
  } as unknown as PointerEvent;
}

/** Listener target is the host; the shadow path still contains the event-card body. */
function movePointerDown(host: TestElement, clientX: number, clientY: number): PointerEvent {
  const card = new TestElement("event-card");
  const shadow = new TestShadowRoot(card);
  const body = new TestElement("div");
  body.setRootNode(shadow);
  return pointerEvent(host, host, clientX, clientY, [body, card, host]);
}

function resizeHandle(position: "start" | "end"): TestElement {
  const handle = new TestElement("resize-handle");
  handle.setAttribute("position", position);
  return handle;
}

describe("TimedEventInteractionController", () => {
  beforeAll(() => {
    vi.stubGlobal("HTMLElement", TestElement);
    vi.stubGlobal("ShadowRoot", TestShadowRoot);
    vi.stubGlobal("getComputedStyle", () => ({
      direction: "ltr",
      getPropertyValue: () => "",
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("window", {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("moves the event onto another day and time and keeps the duration", () => {
    const host = createHost();
    const controller = createController(host);
    const downX = dayCenterX(0);
    const downY = timeY(9, 0);
    const upX = dayCenterX(3);
    const upY = timeY(15, 30);

    controller.pointerDownHandler(movePointerDown(host, downX, downY));
    controller.pointerMoveHandler(pointerEvent(host, host, upX, upY));
    controller.pointerUpHandler(pointerEvent(host, host, upX, upY));

    expect(dateTimeText(host.start)).toBe("2026-03-05T15:30:00");
    expect(dateTimeText(host.end)).toBe("2026-03-05T17:00:00");
    expect(durationSeconds(host.start, host.end)).toBe(
      durationSeconds(ORIGINAL_START, ORIGINAL_END),
    );
  });

  it("changes the start when a mouse drag pulls the start resize handle", () => {
    const host = createHost();
    const controller = createController(host);
    const handle = resizeHandle("start");
    const x = dayCenterX(0);
    const downY = 200;

    controller.pointerDownHandler(pointerEvent(host, handle, x, downY));
    controller.pointerMoveHandler(pointerEvent(host, handle, x, downY - 60));
    controller.pointerUpHandler(pointerEvent(host, handle, x, downY - 60));

    expect(dateTimeText(host.start)).toBe("2026-03-02T08:00:00");
    expect(dateTimeText(host.end)).toBe(ORIGINAL_END);
  });

  it("changes the end when a mouse drag pulls the end resize handle", () => {
    const host = createHost();
    const controller = createController(host);
    const handle = resizeHandle("end");
    const x = dayCenterX(0);
    const downY = 200;

    controller.pointerDownHandler(pointerEvent(host, handle, x, downY));
    controller.pointerMoveHandler(pointerEvent(host, handle, x, downY + 120));
    controller.pointerUpHandler(pointerEvent(host, handle, x, downY + 120));

    expect(dateTimeText(host.start)).toBe(ORIGINAL_START);
    expect(dateTimeText(host.end)).toBe("2026-03-02T12:30:00");
  });
});

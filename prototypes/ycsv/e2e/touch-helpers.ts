import { expect, type CDPSession, type Page } from "@playwright/test";
import { center } from "./helpers";

/**
 * Touch gestures for both engines. Chromium gets real touch input through CDP
 * (the browser itself decides tap vs pan, so native scrolling is exercised).
 * WebKit in Playwright has no touch-drag API and no `Touch` constructor, so
 * drags there are synthetic touch-type PointerEvents: they test our gesture
 * code, not Safari's pan/zoom arbitration (that part is checked in the iOS
 * Simulator).
 */
export type Pt = { x: number; y: number };

export async function openTouch(page: Page, story = "variant-a") {
  await page.goto(`/iframe.html?id=spike-7-touch--${story}&viewMode=story`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
}

const isChromium = (page: Page) => page.context().browser()?.browserType().name() === "chromium";

let cdps = new WeakMap<Page, CDPSession>();
async function cdp(page: Page) {
  let s = cdps.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    cdps.set(page, s);
  }
  return s;
}
export function resetCdp() {
  cdps = new WeakMap();
}

async function cdpTouch(page: Page, type: "touchStart" | "touchMove" | "touchEnd", points: Pt[]) {
  await (await cdp(page)).send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : points.map((p, i) => ({ ...p, id: i })) });
}

async function synth(page: Page, type: "pointerdown" | "pointermove" | "pointerup", p: Pt) {
  await page.evaluate(
    ({ type, p }) => {
      const w = window as unknown as { __synthTarget?: Element };
      const kept = w.__synthTarget?.isConnected ? w.__synthTarget : document.querySelector('[data-testid="grid"]');
      const target = type === "pointerdown" ? document.elementFromPoint(p.x, p.y) : kept;
      if (type === "pointerdown") w.__synthTarget = target ?? undefined;
      target?.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 77, pointerType: "touch", isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: type === "pointerup" ? 0 : 1 }),
      );
    },
    { type, p },
  );
}

export async function tap(page: Page, p: Pt) {
  await page.touchscreen.tap(p.x, p.y);
}

export async function tapCell(page: Page, r: number, c: number) {
  await tap(page, await center(page, r, c));
}

/** Two taps on the same spot, quickly (our double-tap window is 350 ms). */
export async function doubleTap(page: Page, p: Pt) {
  await page.touchscreen.tap(p.x, p.y);
  await page.touchscreen.tap(p.x, p.y);
}

export async function longPress(page: Page, p: Pt, ms = 700) {
  if (isChromium(page)) {
    await cdpTouch(page, "touchStart", [p]);
    await page.waitForTimeout(ms);
    await cdpTouch(page, "touchEnd", []);
  } else {
    await synth(page, "pointerdown", p);
    await page.waitForTimeout(ms);
    await synth(page, "pointerup", p);
  }
}

/** One finger from `a` to `b`; `hold` ms at the end before lifting. */
export async function drag(page: Page, a: Pt, b: Pt, { steps = 8, hold = 0 } = {}) {
  const chromium = isChromium(page);
  if (chromium) await cdpTouch(page, "touchStart", [a]);
  else await synth(page, "pointerdown", a);
  for (let i = 1; i <= steps; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (chromium) await cdpTouch(page, "touchMove", [p]);
    else await synth(page, "pointermove", p);
  }
  if (hold) await page.waitForTimeout(hold);
  if (chromium) await cdpTouch(page, "touchEnd", []);
  else await synth(page, "pointerup", b);
}

/**
 * Variant C gesture: finger down, rest `hold` ms, then move to `b` in `steps`
 * moves `stepMs` apart, then lift. With hold < the grid's holdMs it is a pan.
 */
export async function holdDrag(page: Page, a: Pt, b: Pt, { hold = 260, steps = 8, stepMs = 16 } = {}) {
  const chromium = isChromium(page);
  if (chromium) await cdpTouch(page, "touchStart", [a]);
  else await synth(page, "pointerdown", a);
  await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (chromium) await cdpTouch(page, "touchMove", [p]);
    else await synth(page, "pointermove", p);
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  if (chromium) await cdpTouch(page, "touchEnd", []);
  else await synth(page, "pointerup", b);
}

/** Chromium only: one finger rests `hold` ms, then a second lands and the two pinch d0 → d1. */
export async function holdThenPinch(page: Page, c: Pt, hold: number, d0: number, d1: number, steps = 8) {
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y },
    { x: c.x + d / 2, y: c.y },
  ];
  const first = pts(d0)[0]!;
  await cdpTouch(page, "touchStart", [first]);
  await page.waitForTimeout(hold);
  await cdpTouch(page, "touchStart", pts(d0));
  for (let i = 1; i <= steps; i += 1) await cdpTouch(page, "touchMove", pts(d0 + ((d1 - d0) * i) / steps));
  await cdpTouch(page, "touchEnd", []);
}

/** Chromium only: a real touch pinch (two fingers) around `c`, finger distance d0 → d1. */
export async function pinch(page: Page, c: Pt, d0: number, d1: number, steps = 8) {
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y },
    { x: c.x + d / 2, y: c.y },
  ];
  await cdpTouch(page, "touchStart", pts(d0));
  for (let i = 1; i <= steps; i += 1) await cdpTouch(page, "touchMove", pts(d0 + ((d1 - d0) * i) / steps));
  await cdpTouch(page, "touchEnd", []);
}

/** Chromium only: a touch fling with momentum (CDP synthesizes the gesture and the fling). */
export async function fling(page: Page, at: Pt, dy: number, speed = 4000) {
  await (await cdp(page)).send("Input.synthesizeScrollGesture", {
    x: at.x,
    y: at.y,
    yDistance: dy,
    speed,
    gestureSourceType: "touch",
    preventFling: false,
  });
}

export async function boxOf(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Pretend the on-screen keyboard is open: shrink the visual viewport by `px`. */
export async function fakeKeyboard(page: Page, px: number) {
  await page.evaluate((px) => {
    const vv = window.visualViewport!;
    const h = window.innerHeight - px;
    Object.defineProperty(vv, "height", { configurable: true, get: () => h });
    vv.dispatchEvent(new Event("resize"));
  }, px);
}

export const phone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 600;
export { isChromium };

/** Low-level single finger, for screenshots in the middle of a gesture. */
export async function fingerDown(page: Page, p: Pt) {
  if (isChromium(page)) await cdpTouch(page, "touchStart", [p]);
  else await synth(page, "pointerdown", p);
}
export async function fingerMove(page: Page, a: Pt, b: Pt, steps = 8) {
  for (let i = 1; i <= steps; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (isChromium(page)) await cdpTouch(page, "touchMove", [p]);
    else await synth(page, "pointermove", p);
    await page.waitForTimeout(16);
  }
}
export async function fingerUp(page: Page, p: Pt) {
  if (isChromium(page)) await cdpTouch(page, "touchEnd", []);
  else await synth(page, "pointerup", p);
}

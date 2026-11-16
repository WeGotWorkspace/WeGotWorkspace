import { vi } from "vitest";

/** Marks the element that acts as the list's scrollport in a jsdom test. */
export const TEST_VIEWPORT_ATTR = "data-test-viewport";

/**
 * jsdom has no layout. This makes an element marked with `data-test-viewport`
 * report `viewportPx` of height, keeps every element's `scrollTop`, and moves an
 * element's top up by how far its scrolling ancestors have scrolled. Call in
 * `beforeEach`; `vi.restoreAllMocks()` undoes it.
 */
export function installListLayoutStubs(viewportPx: number) {
  const scrollTops = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute(TEST_VIEWPORT_ATTR) ? viewportPx : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return scrollTops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    value: number,
  ) {
    scrollTops.set(this, value);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    let top = 0;
    for (let node = this.parentElement; node; node = node.parentElement) {
      top -= scrollTops.get(node) ?? 0;
    }
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  });
}

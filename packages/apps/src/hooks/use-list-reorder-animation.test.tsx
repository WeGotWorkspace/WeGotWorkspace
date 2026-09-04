import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import {
  isListRelativeOrderPreserved,
  useListReorderAnimation,
} from "./use-list-reorder-animation";

function ListHarness({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useListReorderAnimation(ref, ids);
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          data-list-item-id={id}
          style={{ display: "block", height: 40 }}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

describe("isListRelativeOrderPreserved", () => {
  it("is true when next is a subsequence of prev (pure removal)", () => {
    expect(isListRelativeOrderPreserved(["a", "b", "c"], ["a", "c"])).toBe(true);
    expect(isListRelativeOrderPreserved(["a", "b", "c"], [])).toBe(true);
  });

  it("is true when prev is a subsequence of next (pure insertion) — callers check both ways", () => {
    expect(isListRelativeOrderPreserved(["a", "b", "c"], ["a", "c"])).toBe(true);
    expect(isListRelativeOrderPreserved(["a", "c"], ["a", "b", "c"])).toBe(false);
    expect(isListRelativeOrderPreserved(["a", "b", "c"], ["a", "c"])).toBe(true);
  });

  it("rejects true reorders", () => {
    expect(isListRelativeOrderPreserved(["a", "b", "c"], ["b", "a", "c"])).toBe(false);
    expect(isListRelativeOrderPreserved(["a", "b", "c"], ["c", "a"])).toBe(false);
  });
});

describe("useListReorderAnimation", () => {
  it("starts a transform transition when item order changes", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);

    let order = ["a", "b"];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const id = this.getAttribute("data-list-item-id");
      const index = id ? order.indexOf(id) : -1;
      const top = Math.max(index, 0) * 40;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 40,
        right: 100,
        width: 100,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { rerender, container } = render(<ListHarness ids={order} />);

    order = ["b", "a"];
    rerender(<ListHarness ids={order} />);

    const movedA = container.querySelector<HTMLElement>('[data-list-item-id="a"]')!;
    const movedB = container.querySelector<HTMLElement>('[data-list-item-id="b"]')!;
    expect(movedA.style.transition).toContain("transform");
    expect(movedB.style.transition).toContain("transform");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips FLIP when a row is only removed (swipe-archive path)", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);

    let order = ["a", "b", "c"];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const id = this.getAttribute("data-list-item-id");
      const index = id ? order.indexOf(id) : -1;
      const top = Math.max(index, 0) * 40;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 40,
        right: 100,
        width: 100,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { rerender, container } = render(<ListHarness ids={order} />);

    order = ["a", "c"];
    rerender(<ListHarness ids={order} />);

    for (const node of container.querySelectorAll<HTMLElement>("[data-list-item-id]")) {
      expect(node.style.transform).toBe("");
      expect(node.style.transition).toBe("");
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips animation when reduced motion is preferred", () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
    }));
    vi.stubGlobal("matchMedia", matchMedia);

    const { rerender, container } = render(<ListHarness ids={["a", "b"]} />);
    rerender(<ListHarness ids={["b", "a"]} />);

    for (const node of container.querySelectorAll<HTMLElement>("[data-list-item-id]")) {
      expect(node.style.transform).toBe("");
      expect(node.style.transition).toBe("");
    }

    vi.unstubAllGlobals();
  });
});

import { memo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ListItem } from "@/list-item/src/list-item";
import { WorkspaceList } from "./workspace-list";
import { workspaceListRowPropsEqual } from "./workspace-list-row-props";

type Item = { id: string; title: string };

const VIEWPORT_PX = 600;
const ROW_PX = 100;
const renders: string[] = [];

const Row = memo(function Row({ item }: { item: Item }) {
  renders.push(item.id);
  return (
    <ListItem
      id={item.id}
      title={item.title}
      subtitle=""
      date=""
      isActive={false}
      isSelected={false}
      selectionMode={false}
      isTouch={false}
      isDragging={false}
    />
  );
}, workspaceListRowPropsEqual);

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `i-${index}`,
    title: `Item ${index}`,
  }));
}

const getKey = (item: Item) => item.id;
const renderItem = (item: Item) => <Row item={item} />;
const estimateSize = () => ROW_PX;

function Scroller({ children }: { children: ReactNode }) {
  return (
    <div data-testid="scroller" data-test-viewport="" style={{ overflowY: "auto" }}>
      {children}
    </div>
  );
}

function mountedIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-list-item-id]")).map((node) =>
    node.getAttribute("data-list-item-id")!,
  );
}

let scrollTops = new WeakMap<Element, number>();

beforeEach(() => {
  renders.length = 0;
  scrollTops = new WeakMap();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  // jsdom has no layout: the scroller reports a viewport, and keeps its scrollTop.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-test-viewport") ? VIEWPORT_PX : 0;
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
  // An element's top moves up by how far its scrolling ancestors have scrolled.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    let top = 0;
    for (let node = this.parentElement; node; node = node.parentElement) {
      top -= scrollTops.get(node) ?? 0;
    }
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkspaceList", () => {
  it("renders a short list in full, with no spacers", () => {
    const { container } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(80)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>,
    );
    expect(mountedIds(container)).toHaveLength(80);
    expect(container.querySelector("[data-workspace-list-spacer]")).toBeNull();
  });

  it("renders every row when there is no scroller", () => {
    const { container } = render(
      <WorkspaceList
        items={makeItems(300)}
        getKey={getKey}
        renderItem={renderItem}
        estimateSize={estimateSize}
        isTouch={false}
      />,
    );
    expect(mountedIds(container)).toHaveLength(300);
  });

  it("mounts only the rows near the viewport of a long list", () => {
    const { container } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(1000)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>,
    );
    // 600 px of viewport plus 480 px of overscan below, at 100 px a row.
    expect(mountedIds(container)).toEqual(makeItems(11).map((item) => item.id));
    const list = container.querySelector("[data-workspace-list-rows]")!;
    expect(list.getAttribute("data-workspace-list-rows")).toBe("1000");
    expect(list.getAttribute("data-workspace-list-mounted")).toBe("11");
    // No first render of all 1000 rows before the window is known.
    expect(renders.length).toBeLessThan(60);
  });

  it("moves the window when the list scrolls", () => {
    const { container, getByTestId } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(1000)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>,
    );
    const scroller = getByTestId("scroller");
    act(() => {
      scroller.scrollTop = 50_000;
      fireEvent.scroll(scroller);
    });
    const ids = mountedIds(container);
    expect(ids).toContain("i-500");
    expect(ids).not.toContain("i-0");
    const spacers = container.querySelectorAll<HTMLElement>("[data-workspace-list-spacer]");
    expect(spacers).toHaveLength(2);
    expect(spacers[0]!.style.blockSize).toBe(`${Number(ids[0]!.slice(2)) * ROW_PX}px`);
  });

  it("keeps the active row mounted far outside the window", () => {
    const { container } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(1000)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
          activeId="i-700"
        />
      </Scroller>,
    );
    const ids = mountedIds(container);
    expect(ids).toContain("i-700");
    expect(ids).not.toContain("i-699");
    // In DOM order, at its own offset: after the window and its gap.
    expect(ids[ids.length - 1]).toBe("i-700");
  });

  it("keeps the focused row mounted after it scrolls out of the window", () => {
    const { container, getByTestId } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(1000)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>,
    );
    const row = container.querySelector<HTMLElement>('[data-list-item-id="i-3"]')!;
    act(() => row.focus());
    const scroller = getByTestId("scroller");
    act(() => {
      scroller.scrollTop = 60_000;
      fireEvent.scroll(scroller);
    });
    expect(mountedIds(container)).toContain("i-3");
    expect(document.activeElement).toBe(row);
  });

  it("keeps a dragged row mounted until its drag ends", () => {
    const { container, getByTestId } = render(
      <Scroller>
        <WorkspaceList
          items={makeItems(1000)}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>,
    );
    const row = container.querySelector<HTMLElement>('[data-list-item-id="i-2"]')!;
    act(() => {
      fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    });
    const scroller = getByTestId("scroller");
    act(() => {
      scroller.scrollTop = 60_000;
      fireEvent.scroll(scroller);
    });
    expect(mountedIds(container)).toContain("i-2");
    act(() => {
      fireEvent.dragEnd(row);
    });
    expect(mountedIds(container)).not.toContain("i-2");
  });

  it("renders only the changed row when one item changes", () => {
    const items = makeItems(1000);
    const view = (list: Item[]) => (
      <Scroller>
        <WorkspaceList
          items={list}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
          activeId="i-5"
        />
      </Scroller>
    );
    const { rerender } = render(view(items));
    renders.length = 0;
    const next = items.slice();
    next[5] = { id: "i-5", title: "Edited" };
    rerender(view(next));
    expect(renders).toEqual(["i-5"]);
  });

  it("observes the rows that replace the old ones at the same indexes", () => {
    const observed = new Set<Element>();
    class FakeResizeObserver {
      observe(target: Element) {
        observed.add(target);
      }
      unobserve(target: Element) {
        observed.delete(target);
      }
      disconnect() {
        observed.clear();
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const view = (list: Item[]) => (
      <Scroller>
        <WorkspaceList
          items={list}
          getKey={getKey}
          renderItem={renderItem}
          estimateSize={estimateSize}
          isTouch={false}
        />
      </Scroller>
    );
    const { container, rerender } = render(view(makeItems(1000)));
    const rowRoots = () => {
      const rows = container.querySelector("[data-list-item-id]")!.parentElement!;
      return Array.from(rows.children).filter(
        (child) => !child.hasAttribute("data-workspace-list-spacer"),
      );
    };
    const before = rowRoots();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => observed.has(row))).toBe(true);

    rerender(view(makeItems(1000).map((item) => ({ ...item, id: `other-${item.id}` }))));
    const after = rowRoots();
    expect(after.length).toBe(before.length);
    for (const row of after) expect(observed.has(row)).toBe(true);
    for (const row of before) expect(observed.has(row)).toBe(false);
  });
});

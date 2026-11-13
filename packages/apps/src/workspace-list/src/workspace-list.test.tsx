import { memo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ListItem } from "@/list-item/src/list-item";
import { WorkspaceList } from "./workspace-list";
import { workspaceListRowPropsEqual } from "./workspace-list-row-props";
import { installListLayoutStubs } from "./workspace-list-test-layout";

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

beforeEach(() => {
  renders.length = 0;
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  installListLayoutStubs(VIEWPORT_PX);
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

  it("keeps the focused row's neighbours mounted, so the next row in the DOM is the next item", () => {
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
    const row = container.querySelector<HTMLElement>('[data-list-item-id="i-5"]')!;
    act(() => row.focus());
    const scroller = getByTestId("scroller");
    act(() => {
      scroller.scrollTop = 60_000;
      fireEvent.scroll(scroller);
    });
    const ids = mountedIds(container);
    expect(ids.slice(0, 3)).toEqual(["i-4", "i-5", "i-6"]);
    expect(ids).not.toContain("i-7");
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
});

describe("WorkspaceList sections", () => {
  /** 300 rows with a header every 20: `h-0`, `i-1` … `i-19`, `h-20`, … */
  const items = makeItems(300).map((item, index) =>
    index % 20 === 0 ? { id: `h-${index}`, title: `Header ${index}` } : item,
  );
  const isHeader = (item: Item) => item.id.startsWith("h-");
  const renderRow = (item: Item) =>
    isHeader(item) ? <h3 id={item.id}>{item.title}</h3> : <Row item={item} />;
  const renderSection = (header: Item, content: ReactNode[]) => (
    <section aria-labelledby={header.id}>{content}</section>
  );

  beforeEach(() => {
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Element.prototype.scrollIntoView = () => undefined;
    }
  });

  function view(activeId: string) {
    return (
      <Scroller>
        <WorkspaceList
          items={items}
          getKey={getKey}
          renderItem={renderRow}
          estimateSize={estimateSize}
          isHeader={isHeader}
          renderSection={renderSection}
          revealActive
          activeId={activeId}
          isTouch={false}
        />
      </Scroller>
    );
  }

  function scrollTo(scroller: HTMLElement, top: number) {
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
    });
  }

  it("wraps each section's mounted rows in its own section, header first", () => {
    const { getByTestId } = render(view("i-250"));
    const scroller = getByTestId("scroller");
    scrollTo(scroller, ROW_PX * 110);

    const sections = Array.from(scroller.querySelectorAll("section"));
    // Rows 105–120: the window starts mid-section (its header stays), then the open row's.
    expect(sections.map((section) => section.getAttribute("aria-labelledby"))).toEqual([
      "h-100",
      "h-120",
      "h-240",
    ]);
    for (const section of sections) {
      expect(section.firstElementChild?.id).toBe(section.getAttribute("aria-labelledby"));
    }
    // Every mounted row sits in the section of its own header.
    for (const row of scroller.querySelectorAll("[data-list-item-id]")) {
      const index = Number(row.getAttribute("data-list-item-id")!.slice(2));
      const header = `h-${index - (index % 20)}`;
      expect(row.closest("section")?.getAttribute("aria-labelledby")).toBe(header);
    }
  });

  it("scrolls a newly active row into view once, not again when the list scrolls", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const { getByTestId, rerender } = render(view(""));
    const scroller = getByTestId("scroller");
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(view("i-250"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const target = scrollIntoView.mock.contexts[0] as Element;
    expect(target.closest("[data-list-item-id]")?.getAttribute("data-list-item-id")).toBe("i-250");

    scrollTo(scroller, 0);
    rerender(view("i-250"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

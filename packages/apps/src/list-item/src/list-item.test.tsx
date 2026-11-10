import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListItem } from "@/list-item/src/list-item";

const baseProps = {
  id: "item-1",
  title: "Jane Doe",
  subtitle: "Acme Corp",
  date: "",
  text: "",
  isActive: false,
  isSelected: false,
  selectionMode: false,
  isTouch: false,
  isDragging: false,
  onClick: vi.fn(),
  onLongPress: vi.fn(),
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
};

describe("ListItem", () => {
  it("renders subtitle above title by default (mail layout)", () => {
    const { container } = render(<ListItem {...baseProps} />);
    const content = container.querySelector(".list-item__content");
    expect(content).not.toBeNull();

    const subtitle = content!.querySelector(".list-item__subtitle");
    const title = content!.querySelector(".list-item__title");
    expect(subtitle).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      subtitle!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the date top right, the preview, then the meta line when metaPosition is below", () => {
    const { container } = render(
      <ListItem
        {...baseProps}
        metaPosition="below"
        date="28 Oct"
        text="First lines of the note"
        icons={[<i key="pin" />]}
      />,
    );
    const titleRow = container.querySelector(".list-item__title-row")!;
    expect(titleRow.querySelector(".list-item__title")!.textContent).toBe("Jane Doe");
    expect(titleRow.querySelector(".list-item__date")!.textContent).toBe("28 Oct");
    const preview = container.querySelector(".list-item__body--preview")!;
    const meta = container.querySelector(".list-item__meta")!;
    expect(
      titleRow.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(preview.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meta.querySelector(".list-item__meta-segment")!.textContent).toBe("Acme Corp");
    expect(meta.querySelector(".list-item__meta-trailing i")).not.toBeNull();
  });

  it("has no placeholder body in the below layout, even without a title", () => {
    const { container } = render(
      <ListItem {...baseProps} metaPosition="below" title="" text="" showEmptyText />,
    );
    expect(container.querySelector(".list-item__body")).toBeNull();
    expect(container.querySelector(".list-item__title")!.getAttribute("data-empty")).toBe("true");
  });

  it("omits the body row when text is empty and a title is present", () => {
    const { container } = render(<ListItem {...baseProps} text="" />);
    expect(container.querySelector(".list-item__body")).toBeNull();
  });

  it("keeps a muted empty-body placeholder when showEmptyText is set", () => {
    const { container } = render(<ListItem {...baseProps} title="Hello" text="" showEmptyText />);
    const body = container.querySelector(".list-item__body");
    expect(body).not.toBeNull();
    expect(body!.textContent).toBe("Empty item");
    expect(body!.getAttribute("data-empty")).toBe("true");
  });

  it("marks the empty-title body fallback as a placeholder", () => {
    const { container } = render(<ListItem {...baseProps} title="" text="" />);
    const body = container.querySelector(".list-item__body");
    expect(body!.textContent).toBe("Empty item");
    expect(body!.getAttribute("data-empty")).toBe("true");
    expect(container.querySelector(".list-item__title")!.getAttribute("data-empty")).toBe("true");
    expect(container.querySelector(".list-item__title")!.textContent).toBe("Untitled");
  });

  it("uses itemId for data-list-item-id when React id is overwritten", () => {
    const { getByRole } = render(<ListItem {...baseProps} id="listItem-0" itemId="note-1" />);
    expect(getByRole("button").getAttribute("data-list-item-id")).toBe("note-1");
  });

  it("sets data-selection-mode from the prop when there is no selection store", () => {
    const { getByRole, rerender } = render(<ListItem {...baseProps} selectionMode />);
    expect(getByRole("button").getAttribute("data-selection-mode")).toBe("true");

    rerender(<ListItem {...baseProps} selectionMode={false} />);
    expect(getByRole("button").getAttribute("data-selection-mode")).toBe("false");
  });

  it("keeps standalone click handlers when the list parent does not delegate", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<ListItem {...baseProps} onClick={onClick} />);
    getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("starts multi-select on a held touch, but not when the finger swipes sideways", () => {
    vi.useFakeTimers();
    try {
      const onLongPress = vi.fn();
      const { getByRole } = render(<ListItem {...baseProps} isTouch onLongPress={onLongPress} />);
      const row = getByRole("button");

      fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 20 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 70, clientY: 21 }] });
      vi.advanceTimersByTime(600);
      fireEvent.touchEnd(row);
      expect(onLongPress).not.toHaveBeenCalled();

      fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 20 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 103, clientY: 22 }] });
      vi.advanceTimersByTime(600);
      fireEvent.touchEnd(row);
      expect(onLongPress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders ReactNode body content such as tags", () => {
    const { container } = render(
      <ListItem
        {...baseProps}
        text={
          <span className="list-item__tags">
            <span>architecture</span>
            <span className="list-item__tags-more">+1 more</span>
          </span>
        }
      />,
    );
    const body = container.querySelector(".list-item__body");
    expect(body).not.toBeNull();
    expect(body!.querySelector(".list-item__tags")).not.toBeNull();
    expect(body!.textContent).toContain("architecture");
    expect(body!.textContent).toContain("+1 more");
  });
});

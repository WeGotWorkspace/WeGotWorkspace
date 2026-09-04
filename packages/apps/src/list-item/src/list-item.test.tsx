import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
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
  it("renders subtitle above title by default (mail/notes layout)", () => {
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

  it("renders title above subtitle when metaPosition is below (contacts layout)", () => {
    const { container } = render(<ListItem {...baseProps} metaPosition="below" />);
    const content = container.querySelector(".list-item__content");
    expect(content).not.toBeNull();

    const subtitle = content!.querySelector(".list-item__subtitle");
    const title = content!.querySelector(".list-item__title");
    expect(subtitle).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      title!.compareDocumentPosition(subtitle!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("omits the body row when text is empty and a title is present", () => {
    const { container } = render(<ListItem {...baseProps} text="" />);
    expect(container.querySelector(".list-item__body")).toBeNull();
  });

  it("uses itemId for data-list-item-id when React id is overwritten", () => {
    const { getByRole } = render(<ListItem {...baseProps} id="listItem-0" itemId="note-1" />);
    expect(getByRole("button").getAttribute("data-list-item-id")).toBe("note-1");
  });

  it("keeps standalone click handlers when the list parent does not delegate", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<ListItem {...baseProps} onClick={onClick} />);
    getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
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

  it("does not read a swipe onClick event (library calls onClick with no args)", () => {
    // react-swipeable-list full-swipe path: setTimeout(() => onClick(), delay)
    // with zero arguments. Reading event.stopPropagation throws and aborts archive.
    const source = readFileSync(
      path.join(process.cwd(), "src/list-item/src/list-item.tsx"),
      "utf8",
    );
    expect(source).toMatch(/onClick=\{\(\) => swipeLeftAction\.onActivate\(\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => swipeRightAction\.onActivate\(\)\}/);
    expect(source).not.toMatch(/event\.?stopPropagation/);
  });
});

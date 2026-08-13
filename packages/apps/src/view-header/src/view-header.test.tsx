import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewHeader } from "@/view-header/src/view-header";

const baseProps = {
  title: "All Items",
  hideSidebarToggle: true,
};

describe("ViewHeader titleSize", () => {
  it("does not apply the small title modifier by default", () => {
    const { container } = render(<ViewHeader {...baseProps} />);
    const title = container.querySelector(".view-header__title");
    expect(title).not.toBeNull();
    expect(title!.classList.contains("view-header__title--sm")).toBe(false);
  });

  it("applies the small title modifier when titleSize is 'sm'", () => {
    const { container } = render(<ViewHeader {...baseProps} titleSize="sm" />);
    const title = container.querySelector(".view-header__title");
    expect(title).not.toBeNull();
    expect(title!.classList.contains("view-header__title--sm")).toBe(true);
  });
});

describe("ViewHeader titleLeading", () => {
  it("renders leading controls before the title in the title cluster", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        titleLeading={
          <button type="button" className="nav-prev">
            Prev
          </button>
        }
      />,
    );
    const cluster = container.querySelector(".view-header__title-cluster");
    expect(cluster).not.toBeNull();
    const leading = cluster!.querySelector(".nav-prev");
    const title = cluster!.querySelector(".view-header__title");
    expect(leading).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      Boolean(leading!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

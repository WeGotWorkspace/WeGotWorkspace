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
    const leadingSlot = cluster!.querySelector(".view-header__title-leading");
    expect(leadingSlot).not.toBeNull();
    const leading = leadingSlot!.querySelector(".nav-prev");
    const title = cluster!.querySelector(".view-header__title");
    expect(leading).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      Boolean(leading!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

describe("ViewHeader layout", () => {
  it("keeps the title row inline by default", () => {
    const { container } = render(
      <ViewHeader {...baseProps} actions={<button type="button">Today</button>} />,
    );
    const row = container.querySelector(".view-header__title-row");
    expect(row).not.toBeNull();
    expect(row!.classList.contains("view-header__title-row--stacked")).toBe(false);
    expect(row!.classList.contains("view-header__title-row--responsive")).toBe(false);
  });

  it("stacks the title cluster above actions when layout is stacked", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        layout="stacked"
        titleLeading={
          <button type="button" className="nav-prev">
            Prev
          </button>
        }
        actions={<button type="button">Today</button>}
      />,
    );
    const row = container.querySelector(".view-header__title-row");
    expect(row).not.toBeNull();
    expect(row!.classList.contains("view-header__title-row--stacked")).toBe(true);
    const cluster = row!.querySelector(".view-header__title-cluster");
    const actions = row!.querySelector(".view-header__actions");
    expect(cluster).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(
      Boolean(cluster!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("opts the title row into container-query stacking when layout is responsive", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        layout="responsive"
        actions={<button type="button">Today</button>}
      />,
    );
    const row = container.querySelector(".view-header__title-row");
    expect(row).not.toBeNull();
    expect(row!.classList.contains("view-header__title-row--responsive")).toBe(true);
    expect(row!.classList.contains("view-header__title-row--stacked")).toBe(false);
  });

  it("keeps a long date-range title in the document for stacked and responsive layouts", () => {
    const title = "31 Aug – 6 Sep 2026";
    const { rerender, container } = render(
      <ViewHeader
        {...baseProps}
        title={title}
        layout="stacked"
        titleLeading={<button type="button">Prev</button>}
        actions={<button type="button">Today</button>}
      />,
    );
    expect(container.querySelector(".view-header__title")?.textContent).toBe(title);

    rerender(
      <ViewHeader
        {...baseProps}
        title={title}
        layout="responsive"
        titleLeading={<button type="button">Prev</button>}
        actions={<button type="button">Today</button>}
      />,
    );
    expect(container.querySelector(".view-header__title")?.textContent).toBe(title);
    expect(
      container
        .querySelector(".view-header__title-row")
        ?.classList.contains("view-header__title-row--responsive"),
    ).toBe(true);
  });

  it("keeps titleLeading before the title when stacked", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        layout="stacked"
        titleLeading={
          <button type="button" className="nav-prev">
            Prev
          </button>
        }
        actions={<button type="button">Today</button>}
      />,
    );
    const cluster = container.querySelector(".view-header__title-cluster");
    const leading = cluster!.querySelector(".nav-prev");
    const title = cluster!.querySelector(".view-header__title");
    expect(leading).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      Boolean(leading!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("renders titleTrailing after actions so stacked CSS can pin it to row 1", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        layout="stacked"
        titleLeading={<button type="button">Prev</button>}
        titleTrailing={
          <button type="button" className="inbox-trigger">
            Inbox
          </button>
        }
        actions={<button type="button">Today</button>}
      />,
    );
    const row = container.querySelector(".view-header__title-row");
    const actions = row!.querySelector(".view-header__actions");
    const trailing = row!.querySelector(".view-header__title-trailing");
    const inbox = trailing!.querySelector(".inbox-trigger");
    expect(actions).not.toBeNull();
    expect(inbox).not.toBeNull();
    expect(
      Boolean(actions!.compareDocumentPosition(trailing!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("keeps a compact title available for narrow headers", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        title="August 20, 2026"
        compactTitle="Aug 20, 2026"
        layout="responsive"
      />,
    );
    expect(container.querySelector(".view-header__title-full")?.textContent).toBe(
      "August 20, 2026",
    );
    expect(container.querySelector(".view-header__title-compact")?.textContent).toBe(
      "Aug 20, 2026",
    );
  });
});

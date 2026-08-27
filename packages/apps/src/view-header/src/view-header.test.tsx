import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
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

describe("ViewHeader titlePrefix", () => {
  it("renders prefix controls immediately before the title", () => {
    const { container } = render(
      <ViewHeader
        {...baseProps}
        titlePrefix={
          <button type="button" className="today-icon">
            Today
          </button>
        }
      />,
    );
    const block = container.querySelector(".view-header__title-block");
    expect(block).not.toBeNull();
    const prefix = block!.querySelector(".today-icon");
    const title = block!.querySelector(".view-header__title");
    expect(prefix).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      Boolean(prefix!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
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

  it("renders the sidebar toggle in a dedicated slot", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ViewHeader title="All Items" sidebarOpen={false} onToggleSidebar={() => {}} />
      </TooltipProvider>,
    );
    expect(container.querySelector(".view-header__sidebar-toggle")).not.toBeNull();
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

describe("ViewHeader search debounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderSearch(
    onSearchInput: (query: string) => void,
    searchDebounceMs?: number,
    searchMinLength?: number,
  ) {
    return render(
      <ViewHeader
        {...baseProps}
        searchPlaceholder="Search"
        onSearchInput={onSearchInput}
        {...(searchDebounceMs !== undefined ? { searchDebounceMs } : {})}
        {...(searchMinLength !== undefined ? { searchMinLength } : {})}
      />,
    );
  }

  it("does not call onSearchInput on mount when searchValue is empty", () => {
    vi.useFakeTimers();
    const onSearchInput = vi.fn();
    renderSearch(onSearchInput);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearchInput).not.toHaveBeenCalled();
  });

  it("debounces non-empty typing at 180ms", () => {
    vi.useFakeTimers();
    const onSearchInput = vi.fn();
    renderSearch(onSearchInput);
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "ab" } });
    expect(onSearchInput).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(onSearchInput).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSearchInput).toHaveBeenCalledTimes(1);
    expect(onSearchInput).toHaveBeenCalledWith("ab");
  });

  it("flushes empty immediately on X and does not resurrect a pending query", () => {
    vi.useFakeTimers();
    const onSearchInput = vi.fn();
    renderSearch(onSearchInput);
    const input = screen.getByPlaceholderText("Search");
    fireEvent.change(input, { target: { value: "verg" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onSearchInput).toHaveBeenCalledTimes(1);
    expect(onSearchInput).toHaveBeenCalledWith("");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearchInput).toHaveBeenCalledTimes(1);
    expect(onSearchInput).not.toHaveBeenCalledWith("verg");
  });

  it("flushes empty immediately even when searchDebounceMs is longer", () => {
    vi.useFakeTimers();
    const onSearchInput = vi.fn();
    renderSearch(onSearchInput, 5000);
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onSearchInput).toHaveBeenCalledWith("");
    expect(onSearchInput).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearchInput).not.toHaveBeenCalledWith("x");
  });

  it("does not emit 1–2 character queries when searchMinLength is 3", () => {
    vi.useFakeTimers();
    const onSearchInput = vi.fn();
    renderSearch(onSearchInput, undefined, 3);
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "ab" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearchInput).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "abc" } });
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(onSearchInput).toHaveBeenCalledTimes(1);
    expect(onSearchInput).toHaveBeenCalledWith("abc");
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "ab" } });
    expect(onSearchInput).toHaveBeenCalledTimes(2);
    expect(onSearchInput).toHaveBeenLastCalledWith("");
  });
});

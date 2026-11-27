import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagSidebarSection } from "@/tag/src/tag-sidebar-section";

afterEach(cleanup);

describe("TagSidebarSection", () => {
  it("lists the tags, marks the selected one and reports a pick", () => {
    const onSelect = vi.fn();
    render(
      <TagSidebarSection
        title="Tags"
        tags={[
          { tag: "client-a", selected: true, onSelect: vi.fn() },
          { tag: "review", selected: false, onSelect },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "client-a" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "review" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without tags", () => {
    const { container } = render(<TagSidebarSection title="Tags" tags={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

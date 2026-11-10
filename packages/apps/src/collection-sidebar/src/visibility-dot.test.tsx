import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisibilityDot } from "@/collection-sidebar/src/visibility-dot";
import { sectionToggleAll, visibilityOfAll } from "@/sidebar-section/src/section-toggle-all";

describe("VisibilityDot", () => {
  it("is a checkbox with a mixed state", () => {
    const onToggle = vi.fn();
    render(<VisibilityDot checked="mixed" label="Show all" onToggle={onToggle} />);
    const box = screen.getByRole("checkbox", { name: "Show all" });
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect(box.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("reads all, none or some", () => {
    const on = new Set(["a", "b"]);
    const isOn = (id: string) => on.has(id);
    expect(visibilityOfAll(["a", "b"], isOn)).toBe(true);
    expect(visibilityOfAll(["c"], isOn)).toBe(false);
    expect(visibilityOfAll(["a", "c"], isOn)).toBe("mixed");
    expect(visibilityOfAll([], isOn)).toBe(false);
  });
});

describe("sectionToggleAll", () => {
  const labels = { showLabel: "Show all", hideLabel: "Hide all" };

  it("turns everything on unless everything is on", () => {
    const onSetAll = vi.fn();
    const some = sectionToggleAll({
      ids: ["a", "b"],
      isOn: (id) => id === "a",
      onSetAll,
      ...labels,
    });
    expect(some).toMatchObject({ checked: "mixed", label: "Show all" });
    some!.onToggle();
    expect(onSetAll).toHaveBeenLastCalledWith(true);

    const all = sectionToggleAll({ ids: ["a", "b"], isOn: () => true, onSetAll, ...labels });
    expect(all).toMatchObject({ checked: true, label: "Hide all" });
    all!.onToggle();
    expect(onSetAll).toHaveBeenLastCalledWith(false);
  });

  it("has no dot without rows", () => {
    expect(sectionToggleAll({ ids: [], isOn: () => true, onSetAll: vi.fn(), ...labels })).toBe(
      undefined,
    );
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";

const swatches = ["#6366f1", "#22c55e"] as const;

afterEach(() => {
  cleanup();
});

describe("SwatchColorPicker", () => {
  it("lets a custom color well change without a hidden programmatic click", () => {
    const onChange = vi.fn();
    render(
      <SwatchColorPicker value="#6366f1" onChange={onChange} colorLabel="Color" swatches={swatches}>
        <button type="button">Open colors</button>
      </SwatchColorPicker>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open colors" }));
    expect(document.querySelector(".swatch-color-picker__swatch--custom")).toBeTruthy();
    const well = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(well).toBeTruthy();
    expect(well.getAttribute("type")).toBe("color");
    expect(well.classList.contains("swatch-color-picker__native-color")).toBe(true);
    expect(well.getAttribute("aria-hidden")).toBeNull();
    expect(well.tabIndex).not.toBe(-1);
    expect(well.dataset.open).toBe("true");

    fireEvent.change(well, { target: { value: "#31c75c" } });
    expect(onChange).toHaveBeenCalledWith("#31c75c");
  });

  it("still selects a preset swatch", () => {
    const onChange = vi.fn();
    render(
      <SwatchColorPicker value="#6366f1" onChange={onChange} colorLabel="Color" swatches={swatches}>
        <button type="button">Open colors</button>
      </SwatchColorPicker>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open colors" }));
    fireEvent.click(screen.getByRole("radio", { name: "#22c55e" }));
    expect(onChange).toHaveBeenCalledWith("#22c55e");
  });
});

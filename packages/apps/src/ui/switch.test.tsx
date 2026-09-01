import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "@/ui/switch";

describe("Switch", () => {
  it("exposes role=switch and stays compact (not a full-width track)", () => {
    const { container } = render(<Switch aria-label="Company contact" />);
    const control = screen.getByRole("switch", { name: "Company contact" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.classList.contains("switch")).toBe(true);
    expect(control.classList.contains("switch--size-md")).toBe(false);
    expect(container.querySelector(".switch__thumb")).not.toBeNull();
  });

  it("toggles on click and applies the md size class", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="All day" checked={false} size="md" onCheckedChange={onCheckedChange} />,
    );
    const control = screen.getByRole("switch", { name: "All day" });
    expect(control.classList.contains("switch--size-md")).toBe(true);
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not toggle when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Offline" checked disabled onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Offline" });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

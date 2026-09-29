import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleDatePicker } from "@/ui/locale-date-picker";

describe("LocaleDatePicker", () => {
  it("renders a labeled trigger with the locale-formatted date", () => {
    render(
      <LocaleDatePicker value="2033-01-12" locale="en-US" label="Starts" onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: /Starts:/ });
    expect(trigger.classList.contains("control-surface")).toBe(true);
    expect(trigger.classList.contains("control-surface--size-md")).toBe(true);
    expect(trigger.classList.contains("locale-date-picker")).toBe(true);
    expect(trigger.getAttribute("lang")).toBe("en-US");
  });
});

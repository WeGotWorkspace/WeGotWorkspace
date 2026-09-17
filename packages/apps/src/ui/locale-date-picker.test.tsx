import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleDatePicker } from "@/ui/locale-date-picker";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "locale-date-picker.css"), "utf8");
const tsx = readFileSync(join(here, "locale-date-picker.tsx"), "utf8");

describe("LocaleDatePicker", () => {
  it("uses the shared control-surface chrome (not one-off borders)", () => {
    expect(tsx).toMatch(/"control-surface locale-date-picker"/);
    expect(tsx).toMatch(/controlSizeClassName\("control-surface"/);
    expect(css).not.toMatch(/border-radius:/);
    expect(css).not.toMatch(/border:\s*1px/);
    expect(css).not.toMatch(/background:/);
  });

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

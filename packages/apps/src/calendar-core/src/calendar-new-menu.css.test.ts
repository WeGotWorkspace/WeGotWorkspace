import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-new-menu.css"), "utf8");

describe("calendar new menu CSS", () => {
  it("joins the primary and chevron halves into one pill", () => {
    expect(css).toMatch(/\.calendar-new-menu \{[^}]*gap-0/);
    expect(css).toMatch(/\.calendar-new-menu__main--solo \{[^}]*w-full/);
    expect(css).toMatch(
      /\.calendar-new-menu \.calendar-new-menu__main\.button\.button--pill \{[^}]*rounded-e-none/,
    );
    expect(css).toMatch(
      /\.calendar-new-menu \.calendar-new-menu__menu\.button \{[^}]*rounded-s-none/,
    );
    expect(css).toMatch(/rounded-e-\[var\(--control-radius-button-pill\)\]/);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "brand-lockup.css"), "utf8");
const tsx = readFileSync(join(here, "brand-lockup.tsx"), "utf8");

const appSwitchCss = readFileSync(
  join(here, "../../app-switch-button/src/app-switch-button.css"),
  "utf8",
);

describe("brand-lockup CSS", () => {
  it("loads app-switch-button lockup styles from the component entry", () => {
    expect(tsx).toMatch(/@\/app-switch-button\/src\/app-switch-button\.css/);
  });

  it("reuses app-switch label leading instead of duplicating lockup metrics", () => {
    expect(appSwitchCss).toMatch(
      /\.app-switch-button__label \{[\s\S]*?line-height:\s*var\(--app-switch-lockup-leading/,
    );
    expect(appSwitchCss).toMatch(/--app-switch-lockup-leading:\s*0\.85/);
    expect(css).not.toMatch(/leading-\[/);
    expect(css).not.toMatch(/line-height/);
    expect(tsx).toMatch(/app-switch-button__label-top/);
    expect(tsx).toMatch(/app-switch-button__label-name/);
  });

  it("disables interactive hover wash on the static lockup", () => {
    expect(css).toMatch(/\.brand-lockup\.app-switch-button__trigger \{[\s\S]*?pointer-events-none/);
    expect(css).toMatch(
      /\.brand-lockup\.app-switch-button__trigger:hover \{[\s\S]*?background-color:\s*transparent/,
    );
  });
});

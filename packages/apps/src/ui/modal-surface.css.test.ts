import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "modal-surface.css"),
  "utf8",
);

describe("ui-modal-surface viewport clamp", () => {
  it("clamps centered dialogs to the visual viewport", () => {
    expect(css).toMatch(/--modal-max-width:\s*32rem/);
    expect(css).toMatch(/--modal-max-height:\s*100dvh/);
    expect(css).toMatch(
      /\.ui-modal-surface--center \{[\s\S]*max-width:\s*min\(var\(--modal-max-width\),\s*100svw\)/,
    );
    expect(css).toMatch(
      /\.ui-modal-surface--center \{[\s\S]*max-height:\s*min\(var\(--modal-max-height\),\s*100dvh\)/,
    );
    expect(css).toMatch(/\.ui-modal-surface--center \{[\s\S]*@apply flex flex-col/);
    expect(css).toMatch(/\.ui-modal-surface--center \{[\s\S]*overflow:\s*hidden/);
  });

  it("fills the viewport as a sheet below 768px and resets enter transform", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.ui-modal-surface\.ui-modal-surface--center/,
    );
    expect(css).toMatch(
      /\.ui-modal-surface\.ui-modal-surface--center \{[\s\S]*inset:\s*0[\s\S]*transform:\s*none[\s\S]*animation:\s*none/,
    );
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).toMatch(/safe-area-inset-bottom/);
  });

  it("pins header and footer and scrolls the body", () => {
    expect(css).toMatch(/\.ui-modal-header \{[\s\S]*shrink-0/);
    expect(css).toMatch(/\.ui-modal-body \{[\s\S]*flex-1[\s\S]*overflow-y-auto/);
    expect(css).toMatch(/\.ui-modal-form \{[\s\S]*flex-1[\s\S]*overflow-hidden/);
    expect(css).toMatch(/\.ui-modal-footer \{[\s\S]*shrink-0/);
    expect(css).not.toMatch(/\.ui-modal-footer \{[\s\S]*sticky/);
  });

  it("remaps md control height to sm on centered dialogs only (sheets keep true md)", () => {
    expect(css).toMatch(
      /\.ui-modal-surface--center \{[\s\S]*?--control-height-md:\s*var\(--control-height-sm,\s*2rem\)/,
    );
    expect(css).toMatch(
      /\.ui-modal-surface--center \{[\s\S]*?--input-height:\s*var\(--control-height-sm,\s*2rem\)/,
    );
    // Sheet / SideDrawer use `.ui-modal-surface` without `--center` — do not
    // shrink ViewHeader-matching IconButton / SegmentedControl chrome to 32px.
    expect(css).not.toMatch(
      /\.ui-modal-surface \{[^}]*--control-height-md:\s*var\(--control-height-sm/,
    );
  });
});

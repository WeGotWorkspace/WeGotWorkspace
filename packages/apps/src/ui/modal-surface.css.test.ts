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
    expect(css).toMatch(/\.ui-modal-surface--center \{[\s\S]*overflow-y:\s*auto/);
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

  it("keeps action rows sticky to the dialog scrollport", () => {
    expect(css).toMatch(/\.ui-modal-footer \{[\s\S]*sticky[\s\S]*bottom-0/);
  });
});

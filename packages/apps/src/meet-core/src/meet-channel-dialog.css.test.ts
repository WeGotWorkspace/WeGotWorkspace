import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "meet-channel-dialog.css"), "utf8");
const tsx = readFileSync(join(here, "meet-channel-dialog.tsx"), "utf8");
const workspaceCss = readFileSync(join(here, "meet-workspace.css"), "utf8");

describe("meet channel dialog surface", () => {
  it("uses the light product class, not leftover lobby/call dark tokens", () => {
    expect(tsx).toMatch(/contentClassName = "meet-channel-dialog"/);
    expect(tsx).not.toMatch(/contentClassName = "meet-dialog-surface"/);
    expect(css).toMatch(/\.meet-channel-dialog \{/);
    expect(css).toMatch(/--modal-title-foreground:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--field-label-color:\s*color-mix\(in oklab,\s*var\(--color-ink\) 60%/);
    expect(css).toMatch(/background-color:\s*var\(--color-cream/);
    expect(css).not.toMatch(/--meet-panel:\s*#171826/);
  });

  it("scopes share-ui tokens under the product dialog, not a dark island", () => {
    expect(css).toMatch(/\.meet-channel-dialog \.share-access-card \{/);
    expect(css).toMatch(/--share-dialog-accent:\s*var\(--meet-accent\)/);
    expect(css).toMatch(/--card-title-color:\s*var\(--color-ink\)/);
  });

  it("leaves lobby/in-call dialogs on the dark surface class", () => {
    expect(workspaceCss).toMatch(/\.meet-dialog-surface,\s*\.meet-call-dialog/);
    expect(workspaceCss).toMatch(/--meet-panel:\s*#171826/);
    expect(workspaceCss).toMatch(/uses `\.meet-channel-dialog`/);
  });
});

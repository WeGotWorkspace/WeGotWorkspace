import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const popover = readFileSync(join(here, "meet-device-popover.tsx"), "utf8");
const form = readFileSync(join(here, "meet-device-form.tsx"), "utf8");

describe("MeetDevicePopover", () => {
  it("uses the light paper sheet, not the lobby dark popover surface", () => {
    expect(popover).toMatch(/className="meet-device-popover"/);
    expect(popover).toMatch(/menuClassName="meet-device-popover"/);
    expect(popover).not.toMatch(/meet-popover-surface/);
    expect(popover).not.toMatch(/--meet-call-surface/);
    expect(popover).toMatch(/active=\{open\}/);
    expect(popover).toMatch(/size="sm"/);
    expect(popover).toMatch(/variant="subtle"/);
  });

  it("keeps Settings on the trigger and Volume2 on the speaker row", () => {
    expect(popover).toMatch(/Settings as SettingsIcon/);
    expect(popover).toMatch(/icon=\{<SettingsIcon \/>\}/);
    expect(form).toMatch(/Volume2/);
    expect(form).toMatch(/icon=\{<Volume2 \/>\}/);
    expect(form).not.toMatch(/Settings/);
  });
});

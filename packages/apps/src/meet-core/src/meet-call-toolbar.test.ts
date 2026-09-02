import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const toolbar = readFileSync(join(here, "meet-call-toolbar.tsx"), "utf8");

describe("MeetCallToolbar", () => {
  it("keeps settings with media controls and leave last after the divider", () => {
    expect(toolbar).toMatch(/MeetDevicePopover/);
    expect(toolbar).not.toMatch(/hideDevices/);
    expect(toolbar.indexOf("icon={<MonitorUp />}")).toBeLessThan(
      toolbar.indexOf("<MeetDevicePopover"),
    );
    expect(toolbar.indexOf("<MeetDevicePopover")).toBeLessThan(
      toolbar.indexOf("meet-workspace__toolbar-divider"),
    );
    expect(toolbar.indexOf("meet-workspace__toolbar-divider")).toBeLessThan(
      toolbar.indexOf("icon={<PhoneOff />}"),
    );
  });

  it("exposes the device popover trigger as a sm subtle IconButton", () => {
    expect(toolbar).toMatch(/from "@\/meet-core\/src\/meet-device-popover"/);
    expect(toolbar).toMatch(/size="sm"/);
    expect(toolbar).toMatch(/variant="subtle"/);
    expect(toolbar).toMatch(/variant="destructive"/);
  });
});

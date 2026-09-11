import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const toolbar = readFileSync(join(here, "meet-call-toolbar.tsx"), "utf8");

describe("MeetCallToolbar", () => {
  it("keeps settings with media controls and leave last after the divider", () => {
    expect(toolbar).toMatch(/MeetDevicePopover/);
    expect(toolbar).toMatch(/MeetKnockBadge/);
    expect(toolbar).not.toMatch(/hideDevices/);
    expect(toolbar.indexOf("icon={<MonitorUp />}")).toBeLessThan(
      toolbar.indexOf("<MeetDevicePopover"),
    );
    expect(toolbar.indexOf("<MeetDevicePopover")).toBeLessThan(
      toolbar.indexOf("meet-workspace__toolbar-divider"),
    );
    expect(toolbar.indexOf("<MeetKnockBadge")).toBeLessThan(
      toolbar.indexOf("meet-workspace__toolbar-divider"),
    );
    expect(toolbar.indexOf("meet-workspace__toolbar-divider")).toBeLessThan(
      toolbar.indexOf("icon={<PhoneOff />}"),
    );
  });

  it("omits Share screen when display capture is unavailable", () => {
    expect(toolbar).toMatch(/isDisplayCaptureSupported/);
    expect(toolbar).toMatch(/shareAvailable \|\| screenOn/);
    expect(toolbar).toMatch(/meetLabels\.shareScreen/);
  });

  it("exposes the device popover trigger as a sm outline IconButton", () => {
    expect(toolbar).toMatch(/from "@\/meet-core\/src\/meet-device-popover"/);
    expect(toolbar).toMatch(/size="sm"/);
    expect(toolbar).toMatch(/variant="outline"/);
    expect(toolbar).toMatch(/variant="destructive"/);
  });

  it("opens leave/end confirm on the cream call dialog, not lobby dark", () => {
    expect(toolbar).toMatch(/className="meet-call-dialog"/);
    expect(toolbar).toMatch(/meet-call-dialog__header/);
    expect(toolbar).toMatch(/meet-call-dialog__footer/);
    expect(toolbar).toMatch(/meet-call-dialog__cancel/);
    expect(toolbar).toMatch(/meet-call-dialog__confirm/);
    expect(toolbar).toMatch(/variant="outline"/);
    expect(toolbar).toMatch(/meetLabels\.cancel/);
    expect(toolbar).not.toMatch(/meet-dialog-surface/);
    expect(toolbar).not.toMatch(/meet-popover-surface/);
  });
});

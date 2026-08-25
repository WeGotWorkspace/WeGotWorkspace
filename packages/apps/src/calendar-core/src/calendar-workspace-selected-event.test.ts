import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("CalendarWorkspace popover → resize selection", () => {
  it("passes the open details-popover event key into CalendarSurface", () => {
    const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
    expect(workspace).toContain("eventPreviewOccurrenceKey");
    expect(workspace).toContain("selectedEventKey=");
    expect(workspace).toContain("previewCanResize");
    expect(workspace).toContain("canWriteCalendarCollection");
    expect(workspace).toContain("previewCanEdit");
    expect(workspace).toContain("eventPreview && previewCanResize");
  });
});

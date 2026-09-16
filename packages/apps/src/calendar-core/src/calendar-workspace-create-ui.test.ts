import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
const controller = readFileSync(join(here, "use-calendar-controller.ts"), "utf8");
const popover = readFileSync(join(here, "calendar-event-details-popover.tsx"), "utf8");

describe("CalendarWorkspace create UI routing", () => {
  it("tags surface create as pointer and menu create as menu", () => {
    expect(controller).toMatch(/source:\s*"pointer"/);
    expect(controller).toMatch(/source:\s*"menu"/);
    expect(controller).toMatch(/openCreateFromSurface/);
    expect(controller).toMatch(/openCreateEvent/);
  });

  it("opens the details popover for pointer create and the dialog for menu create", () => {
    expect(workspace).toContain('editor.source === "pointer"');
    expect(workspace).toContain('editor.source === "menu"');
    expect(workspace).toContain("pointerCreateOpen");
    expect(workspace).toContain("menuCreateOpen");
    expect(workspace).toMatch(/mode:\s*"create"/);
    expect(workspace).toContain("CalendarEventDetailsPopover");
    expect(workspace).toContain("CalendarEventDialog");
    // Dialog only when menu create — not for every create editor.
    expect(workspace).toMatch(/menuCreateOpen && editor\?\.mode === "create"/);
    expect(workspace).not.toMatch(/\{editor\?\.mode === "create" \? \(/);
    // Pointer create must anchor beside the ghost card, not viewport-center fallback.
    expect(workspace).toContain('pointerCreateOpen && editor?.mode === "create"');
    expect(workspace).toContain("editor.origin");
  });

  it("lets the details popover host create-mode CalendarEventForm", () => {
    expect(popover).toContain("editMode");
    expect(popover).toMatch(/mode=\{editMode\}/);
    expect(popover).toMatch(/autoFocusTitle=\{editMode === "create"\}/);
  });

  it("switches the shared details surface to Dialog below 768px (iPad portrait keeps popover)", () => {
    expect(popover).toContain("useIsMobile");
    expect(popover).toContain("DialogContent");
    expect(popover).toMatch(/controlSize="sm"/);
    expect(popover).toContain("calendar-event-details-popover--dialog");
  });
});

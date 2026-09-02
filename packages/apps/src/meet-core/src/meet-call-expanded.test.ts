import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const expanded = readFileSync(join(here, "meet-call-expanded.tsx"), "utf8");
const stage = readFileSync(join(here, "meet-call-stage.tsx"), "utf8");
const workspace = readFileSync(join(here, "meet-workspace.tsx"), "utf8");
const circleToggle = readFileSync(join(here, "meet-circle-toggle.tsx"), "utf8");
const callBar = readFileSync(join(here, "meet-call-bar.tsx"), "utf8");
const toolbar = readFileSync(join(here, "meet-call-toolbar.tsx"), "utf8");
const peerTile = readFileSync(join(here, "meet-peer-tile.tsx"), "utf8");
const pip = readFileSync(join(here, "meet-self-preview-pip.tsx"), "utf8");

describe("MeetCallExpanded", () => {
  it("owns the light stage, peer strip, and chat rail — not the old room split", () => {
    expect(expanded).toMatch(/meet-call-stage--expanded/);
    expect(expanded).toMatch(/meet-call-expanded/);
    expect(expanded).toMatch(/meet-call-stage__spotlight/);
    expect(expanded).toMatch(/meet-call-stage__strip/);
    expect(expanded).toMatch(/MeetCallToolbar/);
    expect(expanded).not.toMatch(/hideDevices/);
    expect(expanded).toMatch(/MeetPeerTile/);
    expect(expanded).not.toMatch(/leaveLabeled/);
    expect(expanded).toMatch(/meet-workspace__header-kind-icon/);
    expect(expanded).not.toMatch(/WorkspaceAppIcon/);
    expect(expanded).not.toMatch(/workspace-app-icon--switch-trigger/);
    expect(expanded).not.toMatch(/MeetRoomPane/);
    expect(expanded).not.toMatch(/ResizablePanel/);
    expect(stage).toMatch(/MeetCallExpanded/);
    expect(stage).toMatch(/meet-call-stage-host/);
    expect(stage).toMatch(/meet-workspace__surface--parked/);
    expect(stage).toMatch(/import type \{ MeetRoomPaneProps \}/);
    expect(stage).not.toMatch(/<MeetRoomPane/);
  });

  it("toggles the shared workspace rail — it does not own a second chat drawer", () => {
    expect(expanded).not.toMatch(/WorkspacePanelScrim/);
    expect(expanded).not.toMatch(/DocsCollabSidebarPanel/);
    expect(expanded).not.toMatch(/workspace-app-layout__panel/);
    expect(workspace).toMatch(/MeetWorkspaceRail/);
    expect(workspace).not.toMatch(/SideDrawer/);
    expect(expanded).toMatch(/aria-pressed=\{open\}/);
    expect(expanded).toMatch(/MessageSquare/);
    expect(expanded).toMatch(/meetLabels\.toggleChatHide/);
    expect(expanded).toMatch(/meetLabels\.toggleChatShow/);
    expect(expanded).toMatch(/meet-call-stage__header-actions/);
    expect(expanded.indexOf("{collapseButton}")).toBeLessThan(
      expanded.indexOf("<MeetCallChatToggle"),
    );
    expect(expanded).not.toMatch(/extraActions/);
    expect(expanded).not.toMatch(/Maximize2/);
    expect(expanded).not.toMatch(/meetLabels\.devices/);
  });

  it("keeps the ViewHeader-slot sidebar toggle on the expanded header", () => {
    expect(expanded).toMatch(/WorkspaceSidebarToggle/);
    expect(expanded).toMatch(/meet-call-stage__sidebar-toggle/);
    expect(expanded).toMatch(/onToggleSidebar/);
    expect(stage).toMatch(/sidebarOpen/);
    expect(stage).toMatch(/onToggleSidebar/);
  });
});

describe("Meet call/chat IconButton chrome", () => {
  it("uses the same sm IconButton square, with leave as the destructive exception", () => {
    expect(circleToggle).toMatch(/size="sm"/);
    expect(circleToggle).toMatch(/variant="subtle"/);
    expect(circleToggle).toMatch(/active=\{on\}/);
    expect(circleToggle).toMatch(/aria-pressed=\{on\}/);
    expect(circleToggle).not.toMatch(/destructive/);
    expect(callBar).toMatch(/size="sm"/);
    expect(callBar).toMatch(/variant="subtle"/);
    expect(callBar).toMatch(/variant="destructive"/);
    expect(callBar).toMatch(/meet-call-bar__invite-button/);
    expect(callBar).toMatch(/meet-workspace__header-kind-icon/);
    expect(toolbar).not.toMatch(/MeetCircleToggle/);
    expect(toolbar).not.toMatch(/leaveLabeled/);
    expect(toolbar).toMatch(/size="sm"/);
    expect(toolbar).toMatch(/variant="subtle"/);
    expect(toolbar).toMatch(/variant="destructive"/);
    expect(toolbar).not.toMatch(/size="lg"/);
    expect(peerTile).toMatch(/variant="subtle"/);
    expect(peerTile).not.toMatch(/variant="ghost"/);
    expect(peerTile).toMatch(/meet-peer-tile__mute/);
    expect(peerTile).toMatch(/onToggleMic/);
    expect(peerTile).not.toMatch(/DropdownMenu/);
    expect(peerTile).not.toMatch(/MoreVertical/);
    expect(pip).toMatch(/variant="subtle"/);
    expect(pip).not.toMatch(/variant="ghost"/);
    expect(expanded).toMatch(/size="sm"/);
    expect(expanded).toMatch(/variant="subtle"/);
    expect(expanded).not.toMatch(/variant="ghost"/);
  });
});

describe("MeetWorkspace expanded chrome", () => {
  it("auto-closes the app sidebar when entering the expanded stage", () => {
    expect(workspace).toMatch(/handleCallLayoutChange/);
    expect(workspace).toMatch(/requestAnimationFrame/);
    expect(workspace).toMatch(/setSidebarOpen\(false\)/);
    expect(workspace).toMatch(/onExpand=\{\(\) => handleCallLayoutChange\("fullscreen"\)\}/);
    expect(workspace).toMatch(/sidebarOpen=\{sidebarOpen\}/);
    expect(workspace).toMatch(/onToggleSidebar=\{\(\) => setSidebarOpen/);
  });
});

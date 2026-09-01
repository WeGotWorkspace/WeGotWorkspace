import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "meet-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "meet-workspace.css"), "utf8");

describe("meet workspace sidebar chrome", () => {
  it("uses the Meet lockup and segmented New menu, not section + or sidebar search", () => {
    expect(tsx).toMatch(/appSwitchSubtitle=\{meetLabels\.productName\}/);
    expect(tsx).toMatch(/<SidebarSegmentedNewMenu/);
    expect(tsx).toMatch(/mainLabel=\{meetLabels\.newChannel\}/);
    expect(tsx).toMatch(/label: meetLabels\.newMeeting/);
    expect(tsx).toMatch(/title=\{meetLabels\.sidebarDirectMessages\}/);
    expect(tsx.indexOf("title={meetLabels.sidebarChannels}")).toBeLessThan(
      tsx.indexOf("title={meetLabels.sidebarSharedWithMe}"),
    );
    expect(tsx.indexOf("title={meetLabels.sidebarSharedWithMe}")).toBeLessThan(
      tsx.indexOf("title={meetLabels.sidebarMeetings}"),
    );
    expect(tsx.indexOf("title={meetLabels.sidebarMeetings}")).toBeLessThan(
      tsx.indexOf("title={meetLabels.sidebarDirectMessages}"),
    );
    expect(tsx).toMatch(/<MeetDirectMessageRows/);
    expect(tsx).toMatch(/UserPresenceDot/);
    expect(tsx).toMatch(/meet-workspace__sidebar-kind-icon/);
    expect(tsx).not.toMatch(/<UserAvatar/);
    expect(tsx).not.toMatch(/showColorDot=\{channel\.kind === "meeting"\}/);
    expect(tsx).not.toMatch(/CollectionSearchInput/);
    expect(tsx).not.toMatch(/onAdd=\{/);
    expect(tsx).not.toMatch(/addLabel=\{meetLabels\.(addChannel|addMeeting)\}/);
    expect(css).not.toMatch(/meet-workspace__sidebar-search/);
  });

  it("washes Meet accent onto cream like Notes/Tasks/Calendar, not a solid teal slab", () => {
    expect(css).toMatch(
      /--meet-sidebar:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 12%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--app-sidebar-bg:\s*var\(--meet-sidebar\)/);
    expect(css).toMatch(/--app-sidebar-color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--meet-sidebar:\s*var\(--meet-accent-strong\)/);
    expect(css).not.toMatch(/--collection-sidebar-row-radius:\s*999px/);
  });

  it("keeps unread badges and ink-on-tint footer tokens", () => {
    expect(tsx).toMatch(/meet-workspace__unread/);
    expect(css).toMatch(/--workspace-user-footer-text-color:/);
    expect(css).toMatch(/--workspace-user-footer-subtitle-color:/);
  });

  it("uses ink SidebarSection titles and an ink Meet glyph on the cyan lockup", () => {
    expect(css).toMatch(
      /\.meet-workspace--split[\s\S]*--field-label-color:\s*color-mix\(in oklab,\s*var\(--color-ink\) 60%/,
    );
    expect(css).toMatch(/--app-switch-icon-fg:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--wai-fg:\s*var\(--app-switch-icon-fg\)/);
    expect(css).toMatch(
      /\.meet-workspace--split \.app-sidebar[\s\S]*--user-avatar-presence-ring:\s*var\(--meet-sidebar\)/,
    );
    expect(css).toMatch(/\.meet-workspace__sidebar-kind-icon[\s\S]*size-3\.5/);
  });

  it("styles unread counts as trailing accent pills, not red coins", () => {
    expect(tsx).toMatch(/trailing=\{/);
    expect(css).toMatch(/\.meet-workspace \.collection-sidebar-row__title/);
    expect(css).toMatch(/--meet-unread-bg:\s*color-mix\(in oklab,\s*var\(--meet-accent\)/);
    expect(css).toMatch(/--meet-unread-fg:\s*var\(--meet-accent-strong\)/);
    expect(css).toMatch(/\.meet-workspace__unread[\s\S]*min-w-6/);
    expect(css).not.toMatch(/\.meet-workspace__unread[\s\S]*--destructive/);
  });
});

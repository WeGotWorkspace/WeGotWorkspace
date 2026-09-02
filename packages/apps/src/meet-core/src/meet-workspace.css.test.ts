import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "meet-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "meet-workspace.css"), "utf8");
const layoutCss = readFileSync(
  join(here, "../../workspace-shell/src/workspace-app-layout.css"),
  "utf8",
);

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
    expect(tsx).toMatch(/CalendarDays className="meet-workspace__sidebar-kind-icon"/);
    expect(tsx).not.toMatch(/Video className="meet-workspace__sidebar-kind-icon"/);
    expect(tsx).toMatch(/meet-workspace__live/);
    expect(tsx).toMatch(/meet-workspace__live-icon/);
    expect(tsx).toMatch(/meetLabels\.liveCall/);
    expect(tsx).toMatch(/role="img"/);
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

  it("uses ViewHeader for the channel main header, not a custom title bar", () => {
    expect(tsx).toMatch(/import \{ ViewHeader \} from "@\/view-header\/src\/view-header"/);
    expect(tsx).toMatch(/<ViewHeader/);
    expect(tsx).toMatch(/title=\{headerTitle\}/);
    expect(tsx).not.toMatch(/titleSize=/);
    expect(tsx).toMatch(/meetChannelTopicSubtitle\(selected\?\.topic\)/);
    expect(tsx).toMatch(/sidebarOpen=\{sidebarOpen\}/);
    expect(tsx).toMatch(/onToggleSidebar=/);
    expect(tsx).not.toMatch(/meet-workspace__main-header/);
    expect(tsx).not.toMatch(/<header/);
    expect(css).toMatch(/--workspace-main-header-border-color:/);
    expect(css).toMatch(/\.meet-workspace \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/\.meet-workspace__title \{[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(css).not.toMatch(/\.meet-workspace \.view-header__subtitle/);
    expect(css).not.toMatch(
      /\.meet-workspace \.workspace-app-layout__main-header\s*\{[^}]*@apply[^}]*z-30/,
    );
    expect(css).toMatch(/\.meet-workspace \.workspace-app-layout__main\s*\{[\s\S]*?isolate/);
    expect(tsx).not.toMatch(/WorkspaceSidebarScrim/);
  });

  it("uses a labeled Start Button and a compact in-call bar instead of opening the stage", () => {
    expect(tsx).toMatch(/import \{ IconButton \} from "@\/button\/src\/button"/);
    expect(tsx).not.toMatch(/import \{ Button, IconButton \} from "@\/button\/src\/button"/);
    expect(tsx).toMatch(/import \{ MeetCallBar \} from "@\/meet-core\/src\/meet-call-bar"/);
    expect(tsx).toMatch(/meetCallInviteAction\(/);
    expect(tsx).toMatch(/invite=\{callInvite\}/);
    expect(tsx).toMatch(/onInvite=\{onCallInvite\}/);
    expect(tsx).not.toMatch(/meetHeaderCallAction\(/);
    expect(tsx).not.toMatch(/headerCallLabel/);
    expect(tsx).not.toMatch(/onHeaderCallClick/);
    expect(tsx).not.toMatch(/meetLabels\.joined/);
    expect(tsx).not.toMatch(/resolvedCallActive \? null : \(/);
    expect(tsx).not.toMatch(/"meet-workspace__header-call"/);
    expect(tsx).toMatch(/meetCallBarVisible\(/);
    expect(tsx).toMatch(/meetCallChromeVisible\(/);
    expect(tsx).toMatch(/joined=\{showCallChrome\}/);
    expect(tsx).toMatch(/keepCallChrome = Boolean\(resolvedStage && showCallChrome\)/);
    expect(tsx).toMatch(/meetCallStageShowsStage\(resolvedStageLayout\)/);
    expect(tsx).toMatch(/onExpand=\{\(\) => handleCallLayoutChange\("fullscreen"\)\}/);
    expect(tsx).toMatch(
      /meetCallStageShowsStage\(layout\) && !meetCallIsActive\(call\.callLayout\)/,
    );
    expect(tsx).toMatch(/channelTitle=\{headerTitle\}/);
    expect(tsx).toMatch(/MeetWorkspaceRail/);
    expect(tsx).toMatch(/meet-workspace__rail-chat/);
    expect(tsx).toMatch(/keepCallChrome/);
    expect(tsx).not.toMatch(/SideDrawer/);
    expect(tsx).toMatch(/callChannelId/);
    expect(tsx).toMatch(/meet-workspace__surfaces/);
    expect(tsx).toMatch(/meet-workspace__surface--parked/);
    expect(tsx).not.toMatch(/showExpandedStage \? undefined : \(/);
    expect(tsx).not.toMatch(/showExpandedStage \? \(\s*<div className="meet-workspace__call-main"/);
    expect(tsx).toMatch(/<MeetCallBar/);
    expect(css).toMatch(/\.meet-call-stage--expanded/);
    expect(css).toMatch(/\.meet-call-expanded/);
    expect(css).toMatch(/container:\s*meet-call-expanded \/ inline-size/);
    expect(css).toMatch(/\.meet-call-stage__spotlight/);
    expect(css).toMatch(/\.meet-call-stage__strip/);
    expect(css).toMatch(/\.meet-call-stage__mark[\s\S]*--meet-accent/);
    expect(css).toMatch(/\.meet-call-bar__mark[\s\S]*--meet-accent/);
    expect(css).toMatch(/\.meet-call-stage__chat-panel/);
    expect(css).not.toMatch(/meet-call-split__/);
    expect(css).toMatch(
      /:is\(\.meet-call-bar,\s*\.meet-call-stage--expanded,\s*\.meet-call-expanded\)\s*\{[\s\S]*--meet-call-surface:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 12%/,
    );
    expect(css).not.toMatch(/--meet-call-surface:\s*#1a1a1a/);
    expect(css).not.toMatch(/#1a1a1a/);
    expect(css).not.toMatch(/#2a2a2e/);
    expect(css).toMatch(
      /:is\(\.meet-call-bar,\s*\.meet-call-stage,\s*\.meet-call-expanded\)\s*\{[\s\S]*--button-subtle-color:\s*color-mix\(in oklab,\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(/\.meet-call-bar__title[\s\S]*var\(--color-ink\)/);
    expect(css).toMatch(/\.meet-call-bar__meta[\s\S]*--meet-call-ink-muted/);
    expect(css).toMatch(/\.meet-call-bar\s*\{[\s\S]*--meet-call-border/);
    expect(css).not.toMatch(/\.meet-call-bar__row[\s\S]*--meet-accent\) 12%/);
    expect(css).not.toMatch(/meet-workspace__header-call/);
    expect(css).not.toMatch(
      /:is\(\.meet-workspace__header-call,\s*\.meet-call-bar \.button--variant-subtle\)/,
    );
    expect(css).toMatch(/container:\s*meet-call-bar \/ inline-size/);
    expect(css).toMatch(/@container meet-call-bar \(max-width: 40rem\)/);
    expect(css).toMatch(
      /@container meet-call-bar \(max-width: 40rem\)[\s\S]*\.meet-call-bar__avatars[\s\S]*hidden/,
    );
    expect(css).not.toMatch(
      /@container meet-call-bar \(max-width: 40rem\)[\s\S]*\.meet-call-bar__actions[\s\S]*hidden/,
    );
    expect(css).toMatch(/\.meet-call-bar__divider/);
    expect(css).not.toMatch(/\.meet-call-bar__leave/);
    expect(css).toMatch(/\.meet-workspace__toolbar-inner[\s\S]*gap-1\.5/);
    expect(css).not.toMatch(/\.meet-call-stage__mark \{[\s\S]*size-9/);
    expect(css).not.toMatch(/\.meet-call-bar__mark \{[\s\S]*size-9/);
    expect(css).toMatch(/\.meet-call-bar__tiles[\s\S]*--meet-call-surface/);
    expect(css).not.toMatch(/\.meet-call-bar__tiles[\s\S]*--meet-screen-bg/);
    expect(css).toMatch(
      /:is\(\.meet-call-bar,\s*\.meet-call-stage,\s*\.meet-call-expanded\) \.meet-peer-tile__fill[\s\S]*--meet-call-empty/,
    );
    expect(css).toMatch(/\.meet-peer-tile__stream/);
    expect(css).toMatch(
      /\.meet-peer-tile--speaking \{[\s\S]*box-shadow:\s*inset 0 0 0 2px var\(--meet-live\)/,
    );
    expect(css).not.toMatch(
      /\.meet-peer-tile--speaking \{[\s\S]*box-shadow:\s*0 0 0 1px var\(--meet-live\)/,
    );
    expect(css).toMatch(/--meet-screen-bg:\s*#000000/);
  });

  it("docks the expanded chat rail flush like Calendar inbox — no overlay card", () => {
    expect(css).toMatch(/--meet-chat-panel-width:\s*22rem/);
    expect(css).toMatch(/workspace-app-layout__panel/);
    expect(layoutCss).toMatch(/\.workspace-app-layout__panel-scrim/);
    expect(layoutCss).toMatch(/bg-black\/30 sidebar:hidden animate-in fade-in duration-300/);
    expect(css).toMatch(/workspace-app-layout__panel-scrim/);
    expect(css).toMatch(/sidebar:static sidebar:shadow-none/);
    expect(css).toMatch(/\.meet-workspace__surface--parked[\s\S]*content-visibility:\s*hidden/);
    expect(css).toMatch(/\.meet-device-popover \{[\s\S]*?--popover:\s*var\(--color-cream/);
    expect(css).toMatch(/\.meet-device-popover \{[\s\S]*?background-color:\s*var\(--color-cream/);
    expect(css).toMatch(/\.meet-device-popover \{[\s\S]*?--meet-accent:\s*#06b6d4/);
    expect(css.match(/\.meet-device-popover \{[\s\S]*?\n\}/)?.[0] ?? "").not.toMatch(
      /#171826|--meet-call-surface/,
    );
    expect(css).toMatch(
      /\.meet-workspace--call-active \.workspace-app-layout__main-header[\s\S]*hidden/,
    );
    expect(css).toMatch(/sidebar:static/);
    expect(css).toMatch(/inset-y-0 end-0/);
    expect(css).toMatch(/docs-collab-sidebar-panel/);
    expect(css).toMatch(/@container workspace-columns \(max-width: 72\.49rem\)/);
    expect(css).toMatch(/@container workspace-columns \(min-width: 72\.5rem\)/);
    expect(css).toMatch(/@container meet-call-expanded \(max-width: 40rem\)/);
    expect(css).toMatch(/--meet-call-dock-safe/);
    expect(css).toMatch(/\.meet-call-stage__spotlight[\s\S]*min-w-\[min\(100%,12rem\)\]/);
    expect(css).toMatch(
      /@container meet-call-expanded \(max-width: 40rem\)[\s\S]*\.meet-call-stage__strip[\s\S]*flex-row/,
    );
    expect(css).not.toMatch(/inset-block-start:\s*0\.75rem/);
    expect(css).not.toMatch(/\.meet-call-stage--expanded[\s\S]*gap-3 overflow-hidden p-3/);
    expect(css).toMatch(/\.meet-call-stage__chat \{[\s\S]*?rounded-none/);
    expect(css).toMatch(/\.meet-call-stage__chat \{[\s\S]*?background-color:\s*var\(--color-cream/);
    expect(css).not.toMatch(/\.meet-call-stage__chat \{[^}]*--meet-call-surface/);
    expect(css).not.toMatch(/\.meet-call-stage__chat \{[^}]*rounded-2xl/);
    expect(css).toMatch(
      /\.meet-call-stage__dock \.meet-workspace__toolbar-inner[\s\S]*--meet-call-surface/,
    );
    expect(css).not.toMatch(/\.meet-call-stage--expanded[\s\S]*--meet-screen-bg/);
  });

  it("styles unread counts as trailing accent pills, not red coins", () => {
    expect(tsx).toMatch(/trailing=\{/);
    expect(css).toMatch(/\.meet-workspace \.collection-sidebar-row__title/);
    expect(css).toMatch(/--meet-unread-bg:\s*color-mix\(in oklab,\s*var\(--meet-accent\)/);
    expect(css).toMatch(/--meet-unread-fg:\s*var\(--meet-accent-strong\)/);
    expect(css).toMatch(/\.meet-workspace__unread[\s\S]*min-w-6/);
    expect(css).toMatch(/\.meet-workspace__live \{[\s\S]*?color:\s*var\(--meet-accent\)/);
    expect(css).toMatch(/\.meet-workspace__live-icon[\s\S]*size-3\.5/);
    expect(css.match(/\.meet-workspace__live \{[\s\S]*?\n\}/)?.[0] ?? "").not.toMatch(
      /min-w-6|"Live"/,
    );
    expect(css).not.toMatch(/\.meet-workspace__unread[\s\S]*--destructive/);
    expect(tsx).toMatch(/meetThreadRailShowsBack/);
    expect(tsx).toMatch(/onBack=\{railShowsBack \? closeResolvedThread/);
    expect(tsx).toMatch(/backLabel=\{meetLabels\.threadBack\}/);
    expect(tsx).toMatch(/meet-workspace__rail-surfaces/);
    expect(tsx).toMatch(/meet-workspace__rail-thread/);
    expect(tsx).not.toMatch(/\{railShowsThread \? threadContent : null\}/);
    expect(tsx).toMatch(/headerActions=/);
    expect(tsx).toMatch(/meetThreadPeopleCount/);
    expect(tsx).toMatch(/meetLabels\.threadPeopleCount/);
    expect(tsx).toMatch(/icon=\{<Pencil \/>\}/);
    expect(tsx).toMatch(/className="meet-workspace__header-edit"/);
    expect(tsx).not.toMatch(/icon=\{<Trash2 \/>\}/);
    expect(tsx).not.toMatch(/onEdit=\{\(\) => onEdit\(channel\)\}/);
    expect(tsx).not.toMatch(/onEdit=\{openEdit\}/);
    expect(tsx).toMatch(/parentEditing/);
    // Thread rail: people indicator before edit; DocsCollab Close stays outermost.
    const railActions = tsx.match(
      /headerActions=\{\s*railShowsThread \? \([\s\S]*?\) : undefined\s*\}/,
    )?.[0];
    expect(railActions).toBeTruthy();
    expect(railActions!.indexOf("meet-workspace__members")).toBeLessThan(
      railActions!.indexOf("chatUiLabels.edit"),
    );
    // Channel ViewHeader: members before edit.
    const mainActions = tsx.match(
      /className="meet-workspace__header-actions"[\s\S]*?<\/div>\s*\) : null/,
    )?.[0];
    expect(mainActions).toBeTruthy();
    expect(mainActions!.indexOf("meet-workspace__members")).toBeLessThan(
      mainActions!.indexOf("meet-workspace__header-edit"),
    );
    expect(css).toMatch(/\.meet-workspace__rail-surfaces[\s\S]*grid-template:\s*1fr \/ 1fr/);
    expect(css).toMatch(/\.meet-workspace__rail-surfaces[\s\S]*min-w-0/);
    expect(css).toMatch(/\.meet-workspace__rail-thread[\s\S]*min-w-0/);
    expect(css).toMatch(/\.meet-workspace__rail-panel[\s\S]*max-w-full/);
    expect(css).toMatch(/\.meet-workspace__chat-column[\s\S]*min-w-0/);
    expect(css).toMatch(/\.meet-workspace__chat-column[\s\S]*max-w-full/);
    expect(css).toMatch(/\.meet-workspace__chat-composer[\s\S]*min-w-0/);
    expect(css).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--meet-live\)/);
    expect(css).not.toMatch(/box-shadow:\s*0 0 0 1px var\(--meet-live\)/);
    expect(css).toMatch(/\.meet-call-stage__strip[\s\S]*w-44/);
    expect(css).toMatch(/\.meet-call-stage__strip \.meet-peer-tile--compact[\s\S]*min-h-36/);
    expect(css).toMatch(/\.meet-peer-tile__mute/);
  });
});

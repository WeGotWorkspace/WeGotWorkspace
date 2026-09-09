import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "meet-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "meet-workspace.css"), "utf8");
const guestChannel = readFileSync(join(here, "meet-guest-channel.tsx"), "utf8");
const guestLobby = readFileSync(join(here, "meet-guest-lobby.tsx"), "utf8");
const guestLobbyCard = readFileSync(join(here, "meet-guest-lobby-card.tsx"), "utf8");
const guestLobbyCss = readFileSync(join(here, "meet-guest-lobby.css"), "utf8");
const inviteGate = readFileSync(join(here, "meet-invite-gate.tsx"), "utf8");
const meetApp = readFileSync(join(here, "meet-app.tsx"), "utf8");
const knockBadge = readFileSync(join(here, "meet-knock-badge.tsx"), "utf8");
const indexExports = readFileSync(join(here, "index.ts"), "utf8");
const routes = readFileSync(
  join(here, "../../wegotworkspace/src/wegotworkspace-routes.tsx"),
  "utf8",
);
const layoutCss = readFileSync(
  join(here, "../../workspace-shell/src/workspace-app-layout.css"),
  "utf8",
);

describe("meet workspace sidebar chrome", () => {
  it("uses the Meet lockup and segmented New menu, not section + or sidebar search", () => {
    expect(tsx).toMatch(/appSwitchSubtitle=\{meetLabels\.productName\}/);
    expect(tsx).toMatch(/<SidebarSegmentedNewMenu/);
    expect(tsx).toMatch(/mainLabel=\{meetLabels\.newMeeting\}/);
    expect(tsx).toMatch(/onMainAction=\{\(\) => setCreateMeetingOpen\(true\)\}/);
    expect(tsx).toMatch(/setEditMeeting/);
    expect(tsx).not.toMatch(/openCreate\("meeting"\)/);
    expect(tsx).toMatch(/channels=\{todayMeetings\}/);
    expect(tsx).toMatch(/leftoverUpcoming/);
    expect(tsx).toMatch(/label: meetLabels\.newChannel/);
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
    expect(tsx).toMatch(/CalendarDays className="meet-workspace__header-kind-icon"/);
    expect(tsx).not.toMatch(/Video className="meet-workspace__header-kind-icon"/);
    expect(tsx).toMatch(/meet-workspace__live/);
    expect(tsx).toMatch(/meet-workspace__live-icon/);
    expect(tsx).toMatch(/meetCallLiveIcon\(Boolean\(audioOnly\)\)/);
    expect(tsx).toMatch(/audioOnly=\{channelCallAudioOnly/);
    expect(tsx).toMatch(/meetCallLiveAudioOnly\(selectedId, callAudioOnlyByChannel\)/);
    expect(tsx).not.toMatch(/<Video className="meet-workspace__live-icon"/);
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
      /--meet-sidebar:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 20%,\s*var\(--color-cream/,
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

  it("uses ink SidebarSection titles and a cream Meet glyph on the dark purple lockup", () => {
    expect(css).toMatch(/\.meet-workspace--split \{[\s\S]*--meet-text:\s*var\(--color-ink\)/);
    expect(css).toMatch(/\.meet-workspace--split \{[\s\S]*--user-avatar-fg:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /\.meet-guest-lobby__camera-off \{[\s\S]*color-mix\(in oklab,\s*var\(--color-ink\) 80%/,
    );
    expect(css).toMatch(
      /\.meet-workspace--split[\s\S]*--field-label-color:\s*color-mix\(in oklab,\s*var\(--color-ink\) 72%/,
    );
    expect(css).toMatch(/--app-switch-icon-fg:\s*var\(--color-cream/);
    expect(css).toMatch(/--wai-fg:\s*var\(--app-switch-icon-fg\)/);
    expect(css).toMatch(
      /\.meet-workspace--split \.app-sidebar[\s\S]*--user-avatar-presence-ring:\s*var\(--meet-sidebar\)/,
    );
    expect(css).toMatch(
      /\.meet-workspace--split \.chat-ui \{[\s\S]*--chat-muted:\s*color-mix\(in oklab,\s*var\(--color-ink\) 72%/,
    );
  });

  it("uses ViewHeader for the channel main header, not a custom title bar", () => {
    expect(tsx).toMatch(/import \{ ViewHeader \} from "@\/view-header\/src\/view-header"/);
    expect(tsx).toMatch(/<ViewHeader/);
    expect(tsx).toMatch(/title=\{headerTitle\}/);
    expect(tsx).not.toMatch(/titleSize=/);
    expect(tsx).toMatch(/meetMeetingHeaderSubtitle\(/);
    expect(tsx).toMatch(/relativeLabelForCalendarEvent\(selectedMeetingEvent, nowTick\)/);
    expect(tsx).toMatch(/clockLabelForMeetingChannel/);
    expect(tsx).toMatch(/todaySidebarMeetingChannels/);
    expect(tsx).toMatch(/leftoverBelongsInTodaySidebar/);
    expect(tsx).toMatch(/shouldAutoJoinScheduledMeeting/);
    expect(tsx).toMatch(/useMeetNowClock/);
    expect(tsx).toMatch(/startLabelForChannel=\{meetingStartLabel\}/);
    expect(tsx).toMatch(/leftoverMeetingStartLabel/);
    expect(tsx).not.toMatch(/meetLabels\.upcomingStarted/);
    expect(tsx).not.toMatch(/upcomingNow/);
    expect(tsx).toMatch(/scheduledWindowLive/);
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

  it("uses a labeled Start Button in ViewHeader and Join on the compact bar when live", () => {
    expect(tsx).toMatch(/import \{ IconButton \} from "@\/button\/src\/button"/);
    expect(tsx).toMatch(/import \{ MeetCallBar \} from "@\/meet-core\/src\/meet-call-bar"/);
    expect(tsx).toMatch(/meetCallInviteAction\(/);
    expect(tsx).toMatch(/meetCallHeaderStartVisible\(/);
    expect(tsx).toMatch(/invite=\{callInvite\}/);
    expect(tsx).toMatch(/audioOnly=\{callAudioOnly\}/);
    expect(tsx).toMatch(/meetCallInviteStartOptions\(callAudioOnly\)/);
    expect(tsx).toMatch(/callAudioOnlyByChannel/);
    expect(tsx).toMatch(/"meet-workspace__header-start"/);
    expect(tsx).toMatch(/mainLabel=\{meetLabels\.meet\}/);
    expect(tsx).toMatch(/meetLabels\.startAudioOnly/);
    expect(tsx).toMatch(/stretch=\{false\}/);
    expect(tsx).not.toMatch(/label=\{meetLabels\.start\}/);
    expect(tsx).not.toMatch(/meetHeaderCallAction\(/);
    expect(tsx).not.toMatch(/headerCallLabel/);
    expect(tsx).not.toMatch(/onHeaderCallClick/);
    expect(tsx).not.toMatch(/meetLabels\.joined/);
    expect(tsx).not.toMatch(/"meet-workspace__header-call"/);
    expect(tsx).toMatch(/meetCallBarVisible\(/);
    expect(tsx).toMatch(/meetCallBarVisible\(resolvedStageLayout, meetingLive\)/);
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
    expect(css.match(/\.meet-call-bar__row \{[\s\S]*?\n\}/)?.[0] ?? "").not.toMatch(
      /--meet-accent\) 12%/,
    );
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
    expect(css).toMatch(/\.meet-device-popover \{[\s\S]*?--meet-accent:\s*#2a1644/);
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
    expect(css).toMatch(/--meet-unread-bg:\s*var\(--meet-accent-strong\)/);
    expect(css).toMatch(/--meet-unread-fg:\s*#ffffff/);
    expect(css).toMatch(/\.meet-workspace__unread[\s\S]*min-w-6/);
    expect(css).toMatch(/\.meet-workspace__live \{[\s\S]*?color:\s*var\(--meet-accent-strong\)/);
    expect(css).not.toMatch(/--meet-live-badge-/);
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
    expect(tsx).toMatch(/dialog\.mayDelete/);
    expect(tsx).toMatch(/void deleteChannel\(dialog\.channelId\)/);
    expect(tsx).toMatch(/upcomingEventIdsForChannel/);
    expect(tsx).toMatch(/leftoverUpcomingMeetings/);
    expect(tsx).toMatch(/pendingUpcomingDelete/);
    expect(tsx).toMatch(/MeetDeleteConfirmDialog/);
    expect(tsx).toMatch(/calendar\?\.deleteEvent/);
    expect(tsx).toMatch(
      /onEdit=\{calendar \? \(meeting\) => openEditLeftover\(meeting\) : undefined\}/,
    );
    expect(tsx).toMatch(/mode=\{editMeeting \? "edit" : "create"\}/);
    expect(tsx).toMatch(/calendarEventsForMeetingChannel/);
    expect(tsx).toMatch(/editLabel=\{meetLabels\.editMeeting\}/);
    expect(tsx).toMatch(/parentEditing/);
    // Thread rail: people indicator before edit; DocsCollab Close stays outermost.
    const railActions = tsx.match(
      /headerActions=\{\s*railShowsThread \? \([\s\S]*?\) : undefined\s*\}/,
    )?.[0];
    expect(railActions).toBeTruthy();
    expect(railActions!.indexOf("meet-workspace__members")).toBeLessThan(
      railActions!.indexOf("chatUiLabels.edit"),
    );
    // Channel ViewHeader: members, then Meet segmented, then edit.
    const mainActions = tsx.match(
      /className="meet-workspace__header-actions"[\s\S]*?<\/div>\s*\) : null/,
    )?.[0];
    expect(mainActions).toBeTruthy();
    expect(mainActions!).toMatch(/meet-workspace__header-start/);
    expect(mainActions!.indexOf("meet-workspace__members")).toBeLessThan(
      mainActions!.indexOf("meet-workspace__header-start"),
    );
    expect(mainActions!.indexOf("meet-workspace__header-start")).toBeLessThan(
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

describe("meet guest invite lobby chrome", () => {
  it("lets the guest lobby scroll on short iOS viewports and keeps Knock on-screen", () => {
    expect(css).toMatch(
      /\.workspace-columns\.meet-guest-channel:not\(\.meet-workspace--call-active\) \{[\s\S]*max-height:\s*100svh/,
    );
    expect(css).toMatch(/\.meet-guest-channel__lobby \{[\s\S]*@apply[^;]*overflow-y-auto/);
    expect(css).toMatch(/\.meet-guest-channel__lobby \{[\s\S]*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.meet-guest-lobby__card \{[\s\S]*@apply[^;]*my-auto/);
    const lobbyRule = css.match(/\.meet-guest-channel__lobby \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(lobbyRule).not.toMatch(/items-center justify-center/);
    expect(lobbyRule).toMatch(/overflow-y-auto/);
    expect(css).toMatch(
      /@container workspace-columns \(max-width: 767px\)[\s\S]*overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /@container workspace-columns \(max-width: 767px\)[\s\S]*meet-guest-lobby__invite[\s\S]*shrink-0/,
    );
    expect(css).toMatch(
      /@container workspace-columns \(max-width: 767px\)[\s\S]*safe-area-inset-bottom/,
    );
    expect(css).toMatch(
      /@container workspace-columns \(min-width: 768px\)[\s\S]*"media heading"[\s\S]*"media invite"/,
    );
    expect(guestChannel).toMatch(/aria-label=\{meetLabels\.guestLobbyRegion\}/);
    expect(guestLobbyCard).toMatch(/aria-label=\{meetLabels\.guestLobbyMediaRegion\}/);
    expect(guestLobbyCard).toMatch(/tabIndex=\{0\}/);
  });

  it("paints cream/dusk product tokens, not the navy waiting slab", () => {
    const lobby = css.match(/\.meet-guest-channel__lobby \{[\s\S]*?\n\}/)?.[0] ?? "";
    const title =
      css.match(/\.meet-guest-channel__lobby \.meet-workspace__title \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(lobby).toMatch(/--meet-text:\s*var\(--color-ink\)/);
    expect(lobby).toMatch(/background-color:\s*var\(--meet-surface\)/);
    expect(lobby).not.toMatch(/#1b1d3a/);
    expect(title).toMatch(/font-family:\s*var\(--font-serif\)/);
    expect(title).toMatch(/color:\s*var\(--color-ink\)/);
    expect(title).not.toMatch(/#ffffff/);
    expect(lobby).toMatch(/--button-primary-bg:\s*var\(--meet-accent\)/);
  });

  it("retired the navy MeetCallWorkspace / lobby / room / flat chat panes", () => {
    expect(existsSync(join(here, "meet-call-workspace.tsx"))).toBe(false);
    expect(existsSync(join(here, "meet-lobby-pane.tsx"))).toBe(false);
    expect(existsSync(join(here, "meet-lobby-status-card.tsx"))).toBe(false);
    expect(existsSync(join(here, "meet-room-pane.tsx"))).toBe(false);
    expect(existsSync(join(here, "meet-room-status-bar.tsx"))).toBe(false);
    expect(existsSync(join(here, "meet-chat-pane.tsx"))).toBe(false);
    expect(indexExports).not.toMatch(/MeetCallWorkspace/);
    expect(indexExports).not.toMatch(/MeetLobbyPane[^P]/);
    expect(indexExports).not.toMatch(/MeetRoomPane/);
    expect(indexExports).not.toMatch(/MeetChatPane/);
    expect(indexExports).not.toMatch(/MeetLobbyStatusCard/);
    expect(indexExports).not.toMatch(/MeetRoomStatusBar/);
    expect(routes).toMatch(/<MeetWorkspace/);
    expect(routes).not.toMatch(/MeetCallWorkspace/);
    expect(css).not.toMatch(/\.meet-workspace__lobby/);
    expect(css).not.toMatch(/\.meet-chat \{/);
    expect(guestChannel).not.toMatch(/import \{ MeetLobbyPane /);
    expect(guestChannel).not.toMatch(/<MeetCallKnockWaiting/);
    expect(guestChannel).toMatch(
      /if \(input\.waitingForAdmission\) return "knocking";\s*if \(input\.inCall\) return "in-channel";/,
    );
    expect(guestChannel).toMatch(/MeetGuestChannelFrame/);
    expect(guestChannel).toMatch(/MeetGuestLobby/);
    expect(guestLobby).not.toMatch(/MeetCallKnockWaiting/);
    expect(guestLobby).toMatch(/meet-guest-lobby__knock--waiting/);
    expect(guestLobby).toMatch(/meetLabels.cancelKnock/);
    expect(guestLobby).toMatch(/MeetGuestLobbyStatus/);
    expect(guestLobby).not.toMatch(/MeetLobbyStatusCard/);
    expect(inviteGate).toMatch(/MeetGuestChannelFrame/);
    expect(inviteGate).toMatch(/MeetGuestLobbyStatus/);
    expect(inviteGate).not.toMatch(/MeetLobbyStatusCard/);
    expect(inviteGate).toMatch(/sessionHint \|\| !channelId \|\| access === "member"/);
    expect(inviteGate).toContain("meetNavigateTargetFromSelection");
    expect(inviteGate).not.toMatch(/to: MEET_CHANNELS_ROUTE/);
    expect(inviteGate).not.toMatch(/className="meet-workspace meet-guest-channel"/);
    expect(meetApp).toMatch(/MeetGuestChannel/);
    expect(meetApp).toMatch(/meetGuestChannelPhase/);
    expect(meetApp).not.toMatch(/<MeetCallWorkspace/);
    expect(meetApp).toMatch(/MeetChatColumn/);
    expect(meetApp).not.toMatch(/MeetChatPane/);
    expect(meetApp).not.toMatch(/onLayoutChange=\{setCallLayout\}/);
    expect(guestChannel).toMatch(/meetGuestChannelStageLayout/);
    expect(guestChannel).not.toMatch(/onLayoutChange=\{onLayoutChange\}/);
    expect(guestChannel).not.toMatch(/titlePrefix=\{<Video/);
  });

  it("reuses call-tile camera-off surface, bordered device selects, and no invite ViewHeader", () => {
    const preview = css.match(/\.meet-guest-lobby__preview \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(preview).toMatch(/background-color:\s*var\(--meet-call-empty\)/);
    expect(preview).not.toMatch(/#000000/);
    expect(css).toMatch(
      /\.meet-guest-channel__lobby \{[\s\S]*--meet-call-empty:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 6%/,
    );
    expect(guestLobby).not.toMatch(/presence=/);
    expect(css).toMatch(
      /\.meet-guest-channel__lobby \.meet-guest-lobby__devices \.meet-device-row__trigger \{[\s\S]*@apply h-9 min-h-9 border px-3/,
    );
    const frameStart = guestChannel.indexOf("export function MeetGuestChannelFrame");
    const nextFn = guestChannel.indexOf("export function MeetGuestChannel(", frameStart + 1);
    const frame = guestChannel.slice(frameStart, nextFn);
    expect(frame).not.toMatch(/ViewHeader/);
    expect(frame).not.toMatch(/mainHeader/);
    expect(inviteGate).not.toMatch(/channelName=\{meetLabels\.productName\}/);
    expect(css).not.toMatch(
      /\.meet-guest-lobby__preview \.icon-button:not\(\.icon-button--active\)/,
    );
    expect(css).toMatch(
      /:is\(\.meet-call-bar,\s*\.meet-call-stage,\s*\.meet-call-expanded,\s*\.meet-guest-lobby__preview\)[\s\S]*icon-button--active/,
    );
    expect(guestLobbyCard).toMatch(/meet-workspace__title meet-workspace__title--lg/);
    expect(guestLobbyCard).toMatch(/variant="switch-trigger"/);
    expect(guestLobbyCard).toMatch(/variant === "status"/);
    expect(guestLobbyCard).toMatch(/meet-guest-lobby__card--status/);
    expect(guestLobbyCard).toMatch(/meet-guest-lobby__status-body/);
    expect(css).toMatch(/\.meet-guest-lobby__preview-idle \{[\s\S]*@apply[\s\S]*pb-16/);
    expect(css).toMatch(/grid-template-areas:[\s\S]*"heading"[\s\S]*"media"[\s\S]*"invite"/);
    expect(css).toMatch(
      /\.meet-guest-lobby__card--status \{[\s\S]*grid-template-areas:[\s\S]*"heading"[\s\S]*"invite"/,
    );
    expect(guestLobbyCard).toMatch(/meet-guest-lobby__heading/);
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-channel__lobby \.meet-guest-lobby__mark\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-bg:\s*var\(--meet-accent\)/,
    );
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-channel__lobby \.meet-guest-lobby__knock\.button--variant-primary \{[\s\S]*--button-icon-size:\s*1rem/,
    );
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-channel__lobby \.meet-guest-lobby__knock\.button--variant-primary \{[\s\S]*--button-primary-bg:\s*var\(--meet-accent\)/,
    );
    const knockIcon =
      guestLobbyCss.match(
        /\.meet-guest-channel__lobby \.meet-guest-lobby__knock \.button__icon > svg \{[\s\S]*?\n\}/,
      )?.[0] ?? "";
    expect(knockIcon).toMatch(/width:\s*var\(--button-icon-size, 1rem\)\s*!important/);
    expect(knockIcon).toMatch(/height:\s*var\(--button-icon-size, 1rem\)\s*!important/);
    expect(knockIcon).not.toMatch(/size-8|size-12|size-full/);
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-channel__lobby \.meet-guest-lobby__mark\.workspace-app-icon--switch-trigger \{[\s\S]*@apply mb-4 size-8/,
    );
    expect(guestLobbyCss).not.toMatch(/\.meet-guest-lobby__knock[^{]*\{[^}]*size-8/);
    expect(guestLobbyCss).not.toMatch(
      /\.meet-guest-lobby(?!__mark)[^\n{]* svg[^\n{]*\{[\s\S]*?size-8/,
    );
    expect(guestLobbyCss).toMatch(/font-family:\s*var\(--font-serif\)/);
    expect(guestLobbyCss).toMatch(/meet-guest-lobby-knock/);
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-lobby__after-knock \{[\s\S]*min-height:\s*var\(--control-height-md/,
    );
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-lobby__after-knock > \* \{[\s\S]*grid-area:\s*1 \/ 1/,
    );
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-lobby__footer\[aria-hidden="true"\] \{[\s\S]*@apply invisible pointer-events-none/,
    );
    expect(guestLobbyCss).toMatch(/\.meet-guest-lobby__cancel \{[\s\S]*@apply h-full w-full/);
    expect(guestLobbyCss).toMatch(
      /\.meet-guest-lobby__status-body \{[\s\S]*@apply text-sm text-balance/,
    );
    expect(guestLobby).toMatch(/meet-guest-lobby__after-knock/);
    expect(css).not.toMatch(/meet-call-knock-wait--guest/);
    const micFill = css.match(/\.meet-guest-lobby__mic-level-fill \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(micFill).toMatch(/background-color:\s*var\(--meet-accent\)/);
    expect(micFill).not.toMatch(/--meet-live/);
    expect(css).toMatch(
      /prefers-reduced-motion: no-preference[\s\S]*\.meet-guest-lobby__mic-level-fill \{[\s\S]*transition-\[width\]/,
    );
  });
});

describe("meet host admit knock popover", () => {
  it("paints cream/dusk call chrome, not the lobby dark island", () => {
    const popover = css.match(/\.meet-knock-badge__popover \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(knockBadge).toMatch(/className="meet-knock-badge__popover"/);
    expect(knockBadge).not.toMatch(/meet-popover-surface/);
    expect(popover).toMatch(/--meet-accent:\s*#2a1644/);
    expect(popover).toMatch(
      /--meet-call-surface:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 12%/,
    );
    expect(popover).toMatch(/--popover:\s*var\(--meet-call-surface\)/);
    expect(popover).toMatch(/--button-subtle-color:\s*color-mix\(in oklab,\s*var\(--color-ink\)/);
    expect(popover).toMatch(/--button-primary-bg:\s*var\(--meet-accent\)/);
    expect(popover).toMatch(/background-color:\s*var\(--meet-call-surface\)/);
    expect(popover).toMatch(/color:\s*var\(--color-ink\)/);
    expect(popover).not.toMatch(/#171826/);
    expect(css).toMatch(/\.meet-knock-row \{[\s\S]*background-color:\s*var\(--meet-call-empty\)/);
    expect(css).toMatch(/\.meet-knock-row__name \{[\s\S]*color:\s*var\(--color-ink\)/);
    expect(css).toMatch(/\.meet-knock-row__hint \{[\s\S]*color:\s*var\(--meet-call-ink-muted\)/);
    expect(css).not.toMatch(/meet-knock-row__deny[\s\S]{0,280}rgba\(255,\s*255,\s*255,\s*0\.06\)/);
    expect(css).not.toMatch(
      /:is\(\.meet-workspace,\s*\.meet-dialog-surface,\s*\.meet-popover-surface\) \.meet-knock-badge__popover/,
    );
  });
});

describe("meet in-call overlay resume", () => {
  it("selects the live call on bare /meet and keeps the mini-player parked on unmount", () => {
    expect(tsx).toContain("meetShouldSelectLiveCallOnBareMeet");
    expect(tsx).toContain("meetCallUiParkedOnWorkspaceUnmount");
    expect(tsx).toContain("meetCallStatusEngaged");
    expect(tsx).toContain("meetResumeCallLayout");
    expect(tsx).toContain("setCallUiLayout");
    expect(tsx).not.toMatch(/suiteCallStore\?\.setCallUiParked\(false\)/);
  });

  it("uses tabular nums for in-call timer copy", () => {
    expect(css).toMatch(/\.meet-call-bar__meta[\s\S]*tabular-nums/);
    expect(css).toMatch(/\.meet-call-stage__meta[\s\S]*tabular-nums/);
  });
});

describe("meet leave/end call dialog", () => {
  it("paints cream/dusk call chrome, not the lobby dark island", () => {
    const dialog = css.match(/\.meet-call-dialog \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(dialog).toMatch(/--meet-accent:\s*#2a1644/);
    expect(dialog).toMatch(
      /--meet-call-surface:\s*color-mix\(in oklab,\s*var\(--meet-accent\) 12%/,
    );
    expect(dialog).toMatch(/--modal-title-foreground:\s*var\(--color-ink\)/);
    expect(dialog).toMatch(/--muted-foreground:\s*var\(--meet-muted\)/);
    expect(dialog).toMatch(/--button-outline-color:\s*var\(--color-ink\)/);
    expect(dialog).toMatch(/--button-destructive-bg:\s*var\(--color-red-500/);
    expect(dialog).toMatch(/background-color:\s*var\(--meet-call-surface\)/);
    expect(dialog).toMatch(/color:\s*var\(--color-ink\)/);
    expect(dialog).not.toMatch(/#171826/);
    expect(dialog).not.toMatch(/background-color:\s*var\(--meet-panel\)\s*!important/);
    expect(css).toMatch(
      /\.meet-call-dialog \.ui-modal-title \{[\s\S]*var\(--modal-title-foreground\)/,
    );
    expect(css).toMatch(/\.meet-call-dialog \.meet-call-dialog__cancel/);
    expect(css).not.toMatch(/\.meet-dialog-surface,\s*\.meet-call-dialog,/);
  });
});

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/notes" } }),
}));

vi.mock("@/app-switch-button/src/use-show-admin-app", () => ({
  useShowAdminApp: () => false,
}));

const inboxBase = {
  items: [] as const,
  onOpenItem: () => undefined,
  onMarkAllRead: () => undefined,
  markReadWhere: async () => undefined,
  onEnablePush: () => undefined,
  pushEnabled: true,
  soundMuted: false,
  onToggleSoundMute: () => undefined,
  unreadArrivalNonce: 0,
};

describe("AppSidebar switch-trigger icon stability", () => {
  beforeEach(() => {
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the switch-trigger icon DOM node across unread badge updates", () => {
    function Harness({ unreadCount }: { unreadCount: number }) {
      return (
        <NotificationsInboxValueProvider value={{ ...inboxBase, unreadCount }}>
          <AppSidebar open onCloseMobile={() => undefined}>
            <div>nav</div>
          </AppSidebar>
        </NotificationsInboxValueProvider>
      );
    }

    const { container, rerender } = render(<Harness unreadCount={1} />);
    const icon = container.querySelector(
      ".workspace-app-icon--switch-trigger.app-switch-button__icon",
    );
    expect(icon).toBeTruthy();

    rerender(<Harness unreadCount={7} />);
    expect(
      container.querySelector(".workspace-app-icon--switch-trigger.app-switch-button__icon"),
    ).toBe(icon);
  });
});

describe("WorkspaceAppIcon switch-trigger memo", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the same span across parent re-renders with stable props", () => {
    function Parent({ tick }: { tick: number }) {
      return (
        <div data-tick={tick}>
          <WorkspaceAppIcon
            appId="notes"
            variant="switch-trigger"
            className="app-switch-button__icon"
          />
        </div>
      );
    }

    const { container, rerender } = render(<Parent tick={0} />);
    const icon = container.querySelector(".workspace-app-icon--switch-trigger");
    expect(icon).toBeTruthy();

    rerender(<Parent tick={1} />);
    rerender(<Parent tick={2} />);
    expect(container.querySelector(".workspace-app-icon--switch-trigger")).toBe(icon);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { MenuItem } from "@/menu-item/src/menu-item";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { TooltipProvider } from "@/ui/tooltip";

function stubMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
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

describe("AppSidebar overlay dismiss", () => {
  afterEach(() => {
    cleanup();
  });

  function renderSidebar(onCloseMobile: () => void) {
    return render(
      <TooltipProvider>
        <AppSidebar open onCloseMobile={onCloseMobile}>
          <ul>
            <li>
              <MenuItem label="All items" onClick={() => undefined} />
            </li>
            <CollectionSidebarRow
              name="Work"
              color="#0ea5e9"
              visible
              onSelect={() => undefined}
              onToggleVisibility={() => undefined}
              onEdit={() => undefined}
              editLabel="Edit Work"
            />
            <CollectionSidebarRow
              name="Due"
              color="#0ea5e9"
              visible
              onToggleVisibility={() => undefined}
            />
          </ul>
          <button type="button">New note</button>
        </AppSidebar>
      </TooltipProvider>,
    );
  }

  it("closes the overlay when a nav or collection row is tapped", () => {
    stubMatchMedia(true);
    const onCloseMobile = vi.fn();
    renderSidebar(onCloseMobile);

    fireEvent.click(screen.getByRole("button", { name: "All items" }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(onCloseMobile).toHaveBeenCalledTimes(2);
  });

  it("does not close the overlay for edit, visibility, unlabeled rows, or the new button", () => {
    stubMatchMedia(true);
    const onCloseMobile = vi.fn();
    renderSidebar(onCloseMobile);

    fireEvent.click(screen.getByRole("button", { name: "Edit Work" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Due" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    expect(onCloseMobile).not.toHaveBeenCalled();
  });

  it("keeps the docked sidebar open when a row is clicked", () => {
    stubMatchMedia(false);
    const onCloseMobile = vi.fn();
    renderSidebar(onCloseMobile);

    fireEvent.click(screen.getByRole("button", { name: "All items" }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(onCloseMobile).not.toHaveBeenCalled();
  });
});

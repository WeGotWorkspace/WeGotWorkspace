import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";

const inboxValue = {
  items: [] as const,
  unreadCount: 3,
  onOpenItem: () => undefined,
  onMarkAllRead: () => undefined,
  markReadWhere: async () => undefined,
  onEnablePush: () => undefined,
  pushEnabled: true,
};

function renderToggle(open: boolean, unreadCount = inboxValue.unreadCount) {
  return render(
    <TooltipProvider delayDuration={0}>
      <NotificationsInboxValueProvider value={{ ...inboxValue, unreadCount }}>
        <WorkspaceSidebarToggle open={open} onToggle={vi.fn()} />
      </NotificationsInboxValueProvider>
    </TooltipProvider>,
  );
}

describe("WorkspaceSidebarToggle unread badge", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the unread count on the rail/hamburger when the sidebar is closed", () => {
    renderToggle(false);
    const toggle = screen.getByRole("button", { name: "Show sidebar (3 unread)" });
    expect(toggle.getAttribute("data-count")).toBe("3");
    expect(toggle.classList.contains("notification-inbox-tray__trigger")).toBe(true);
  });

  it("hides the rail/hamburger badge when the sidebar is open", () => {
    renderToggle(true);
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(toggle.getAttribute("data-count")).toBeNull();
  });

  it("omits the badge when there are no unread notifications", () => {
    renderToggle(false, 0);
    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    expect(toggle.getAttribute("data-count")).toBeNull();
  });
});

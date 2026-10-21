import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectivity } from "@/hooks/use-connectivity";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { WorkspaceShellHeaderUserMenu } from "@/workspace-shell/src/workspace-shell-header-user-menu";

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: vi.fn(() => ({ online: true })),
}));

function setOnline(online: boolean): void {
  vi.mocked(useConnectivity).mockReturnValue({ online });
}

function renderFooter(onLogoutClick = vi.fn()) {
  render(
    <TooltipProvider delayDuration={0}>
      <WorkspaceUserFooter name="Alice" initials="A" onLogoutClick={onLogoutClick} />
    </TooltipProvider>,
  );
  return onLogoutClick;
}

function openHeaderMenu(onLogout = vi.fn()) {
  render(<WorkspaceShellHeaderUserMenu displayName="Alice" onLogout={onLogout} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  return onLogout;
}

// Signing out offline cannot revoke the refresh token and discards unsynced changes.
describe("logout while offline", () => {
  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  it("enables the sidebar logout button online", () => {
    const onLogout = renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("disables the sidebar logout button offline", () => {
    setOnline(false);
    const onLogout = renderFooter();
    const button = screen.getByRole("button", { name: "Log out is unavailable offline" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("enables the header sign-out item online", () => {
    openHeaderMenu();
    const item = screen.getByRole("menuitem", { name: "Sign out" });
    expect(item.getAttribute("aria-disabled")).toBeNull();
  });

  it("disables the header sign-out item offline", () => {
    setOnline(false);
    const onLogout = openHeaderMenu();
    const item = screen.getByRole("menuitem", { name: "Sign out is unavailable offline" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(onLogout).not.toHaveBeenCalled();
  });
});

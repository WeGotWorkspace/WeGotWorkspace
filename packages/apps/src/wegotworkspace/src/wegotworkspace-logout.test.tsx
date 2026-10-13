import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-logout";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

describe("WeGotWorkspaceLogout", () => {
  afterEach(() => {
    cleanup();
    navigate.mockReset();
    vi.restoreAllMocks();
  });

  it("signs out immediately when nothing is unsynced", async () => {
    const completeLogout = vi.fn().mockResolvedValue("member_login");

    render(
      <WeGotWorkspaceLogout
        countUnsyncedChanges={async () => 0}
        isGuestSession={() => false}
        completeLogout={completeLogout}
      />,
    );

    await waitFor(() => expect(completeLogout).toHaveBeenCalledOnce());
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Signing out...")).toBeTruthy();
  });

  it("asks before discarding unsynced changes", async () => {
    const completeLogout = vi.fn().mockResolvedValue("member_login");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    render(
      <WeGotWorkspaceLogout
        countUnsyncedChanges={async () => 2}
        isGuestSession={() => false}
        completeLogout={completeLogout}
      />,
    );

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("You have 2 unsynced changes. They will be discarded.")).toBeTruthy();
    expect(completeLogout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(back).toHaveBeenCalledOnce();
    expect(completeLogout).not.toHaveBeenCalled();
  });

  it("discards unsynced changes after confirmation", async () => {
    const completeLogout = vi.fn().mockResolvedValue("member_login");

    render(
      <WeGotWorkspaceLogout
        countUnsyncedChanges={async () => 1}
        isGuestSession={() => false}
        completeLogout={completeLogout}
      />,
    );

    expect(
      await screen.findByText("You have 1 unsynced change. It will be discarded."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(completeLogout).toHaveBeenCalledOnce());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/login" }));
  });

  it("warns when the outbox count cannot be read", async () => {
    const completeLogout = vi.fn().mockResolvedValue("member_login");

    render(
      <WeGotWorkspaceLogout
        countUnsyncedChanges={async () => {
          throw new Error("indexedDB blocked");
        }}
        isGuestSession={() => false}
        completeLogout={completeLogout}
      />,
    );

    expect(
      await screen.findByText("Unsynced changes on this device will be discarded."),
    ).toBeTruthy();
    expect(completeLogout).not.toHaveBeenCalled();
  });

  it("does not ask a guest share viewer to discard the member cache", async () => {
    const completeLogout = vi.fn().mockResolvedValue("guest_share");
    const countUnsyncedChanges = vi.fn(async () => 4);

    render(
      <WeGotWorkspaceLogout
        countUnsyncedChanges={countUnsyncedChanges}
        isGuestSession={() => true}
        completeLogout={completeLogout}
      />,
    );

    await waitFor(() => expect(completeLogout).toHaveBeenCalledOnce());
    expect(countUnsyncedChanges).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";

function footer(online: boolean) {
  return (
    <TooltipProvider delayDuration={0}>
      <WorkspaceUserFooter name="Ada Lovelace" initials="AL" detailLine="ada" online={online} />
    </TooltipProvider>
  );
}

describe("WorkspaceUserFooter connectivity pip", () => {
  afterEach(() => {
    cleanup();
  });

  it("puts a green pip on the avatar and keeps the username line while online", async () => {
    const { container } = render(footer(true));

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar, online" })).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence--online")).not.toBeNull();
    expect(screen.getByText("ada")).toBeTruthy();

    const trigger = container.querySelector('[data-connectivity="online"]');
    if (!trigger) throw new Error("missing online tooltip trigger");
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe("Online");
    });
  });

  it("puts an amber pip on the avatar and shows an italic Offline line while offline", () => {
    const { container } = render(footer(false));

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar, offline" })).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence--away")).not.toBeNull();
    expect(screen.getByText("Offline").classList.contains("italic")).toBe(true);
    expect(screen.queryByText("ada")).toBeNull();
  });

  it("adds no extra tab stop before Log out", () => {
    const { container } = render(footer(false));

    expect(container.querySelector("[tabindex]")).toBeNull();
  });

  it("announces connectivity flips, not the initial state", () => {
    const { rerender } = render(footer(true));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    act(() => rerender(footer(false)));
    expect(status.textContent).toBe("Offline");

    act(() => rerender(footer(true)));
    expect(status.textContent).toBe("Back online");
  });
});

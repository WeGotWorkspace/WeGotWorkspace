import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectivityHubForTests } from "@/lib/offline/browser-online";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";

function footer(online?: boolean) {
  return (
    <TooltipProvider delayDuration={0}>
      <WorkspaceUserFooter name="Ada Lovelace" initials="AL" detailLine="ada" online={online} />
    </TooltipProvider>
  );
}

function renderFooter(online?: boolean) {
  return render(footer(online));
}

describe("WorkspaceUserFooter connectivity pip", () => {
  beforeEach(() => {
    resetConnectivityHubForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    cleanup();
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("puts a green pip on the avatar and an Online tooltip while online", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = renderFooter();

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar, online" })).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence--online")).not.toBeNull();

    const trigger = container.querySelector('[data-connectivity="online"]');
    if (!trigger) throw new Error("missing online tooltip trigger");
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe("Online");
    });
  });

  it("puts an amber pip on the avatar and an Offline tooltip while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { container } = renderFooter();

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar, offline" })).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence--away")).not.toBeNull();

    const trigger = container.querySelector('[data-connectivity="offline"]');
    if (!trigger) throw new Error("missing offline tooltip trigger");
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe("Offline");
    });
  });

  it("keeps the tooltip trigger in the tab order", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = renderFooter();

    expect(container.querySelector('[data-connectivity="online"]')?.getAttribute("tabindex")).toBe(
      "0",
    );
  });

  it("announces connectivity flips, not the initial state", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { rerender } = renderFooter(true);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    act(() => rerender(footer(false)));
    expect(status.textContent).toBe("Offline");

    act(() => rerender(footer(true)));
    expect(status.textContent).toBe("Back online");
  });
});

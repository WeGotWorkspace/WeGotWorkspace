import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectivityHubForTests } from "@/lib/offline/browser-online";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";

function renderFooter() {
  return render(
    <TooltipProvider delayDuration={0}>
      <WorkspaceUserFooter name="Ada Lovelace" initials="AL" detailLine="ada" />
    </TooltipProvider>,
  );
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

  it("shows no pip while online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = renderFooter();

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar" })).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence")).toBeNull();
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
});

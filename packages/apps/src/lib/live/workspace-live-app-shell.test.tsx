/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wgwHasAuthenticatedSession } from "@/lib/api/wgw/http";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: vi.fn(() => true),
  wgwIsGuestSession: vi.fn(() => false),
  wgwRedirectGuestShareReauth: vi.fn(() => false),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);
});

function renderBootstrapError(message: string) {
  return render(
    <WorkspaceLiveAppShell
      phase="error"
      error={new Error(message)}
      retry={() => undefined}
      errorTitle="Could not load admin"
      successVersion={0}
      render={() => <div>should not render</div>}
    />,
  );
}

describe("WorkspaceLiveAppShell", () => {
  it("mounts workspace UI during loading without a full-page spinner", () => {
    render(
      <WorkspaceLiveAppShell
        phase="loading"
        error={null}
        retry={() => undefined}
        errorTitle="Could not load"
        successVersion={0}
        render={() => <div>workspace chrome</div>}
      />,
    );

    expect(screen.getByText("workspace chrome")).toBeTruthy();
    expect(screen.queryByText(/Loading workspace/i)).toBeNull();
  });

  it("mounts workspace UI when ready", () => {
    render(
      <WorkspaceLiveAppShell
        phase="ready"
        error={null}
        retry={() => undefined}
        errorTitle="Could not load"
        successVersion={1}
        render={(version) => <div>ready v{version}</div>}
      />,
    );

    expect(screen.getByText("ready v1")).toBeTruthy();
  });

  it("shows the bootstrap error panel on non-auth errors", () => {
    const retry = vi.fn();
    render(
      <WorkspaceLiveAppShell
        phase="error"
        error={new Error("network down")}
        retry={retry}
        errorTitle="Could not load live notes"
        successVersion={0}
        render={() => <div>should not render</div>}
      />,
    );

    expect(screen.getByText("Could not load live notes")).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();
    expect(screen.queryByText("should not render")).toBeNull();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Request failed (401)",
    "Request failed (403)",
    "Missing auth session. Sign in to continue.",
  ])("keeps the session and stays on the page for %j while a session is stored", (message) => {
    vi.stubEnv("DEV", false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/admin", assign });

    renderBootstrapError(message);

    expect(screen.getByText("Could not load admin")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("redirects to login once the stored session is gone", () => {
    vi.stubEnv("DEV", false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/admin", assign });
    const shell = (phase: "loading" | "error") => (
      <WorkspaceLiveAppShell
        phase={phase}
        error={phase === "error" ? new Error("Request failed (401)") : null}
        retry={() => undefined}
        errorTitle="Could not load admin"
        successVersion={0}
        render={() => <div>workspace chrome</div>}
      />
    );

    const { rerender } = render(shell("loading"));
    // http.ts cleared the session after the server rejected the refresh.
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    rerender(shell("error"));

    expect(screen.queryByText("Could not load admin")).toBeNull();
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("/login"));
  });

  it("keeps the error panel on a page that loads without a session", () => {
    // /install is public: no session is the normal state there.
    vi.stubEnv("DEV", false);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/install", assign });

    render(
      <WorkspaceLiveAppShell
        phase="error"
        error={new Error("GET /installer/bootstrap failed (503)")}
        retry={() => undefined}
        errorTitle="Could not load installer"
        successVersion={0}
        render={() => <div>should not render</div>}
      />,
    );

    expect(screen.getByText("Could not load installer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});

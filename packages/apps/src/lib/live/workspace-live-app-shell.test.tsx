/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";

vi.mock("@/lib/api/wgw/http", () => ({
  clearWgwSession: vi.fn(),
  wgwIsGuestSession: vi.fn(() => false),
  wgwRedirectGuestShareReauth: vi.fn(() => false),
}));

afterEach(() => {
  cleanup();
});

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
});

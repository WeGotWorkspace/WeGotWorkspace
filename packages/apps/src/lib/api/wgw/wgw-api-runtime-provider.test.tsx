/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwEnsureSession: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/wgw/session-keeper", () => ({
  startWgwSessionKeeper: vi.fn(() => vi.fn()),
}));

import { wgwEnsureSession } from "@/lib/api/wgw/http";
import { startWgwSessionKeeper } from "@/lib/api/wgw/session-keeper";
import { WgwApiRuntimeProvider } from "@/lib/api/wgw/wgw-api-runtime-provider";
import { activeWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";

afterEach(() => {
  cleanup();
});

describe("WgwApiRuntimeProvider", () => {
  beforeEach(() => {
    vi.mocked(wgwEnsureSession).mockReset();
    vi.mocked(wgwEnsureSession).mockResolvedValue(undefined);
    vi.mocked(startWgwSessionKeeper).mockReset();
    vi.mocked(startWgwSessionKeeper).mockReturnValue(vi.fn());
  });

  it("renders children immediately without a restoring-session gate", async () => {
    let resolveEnsure!: () => void;
    vi.mocked(wgwEnsureSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnsure = () => resolve(undefined);
        }),
    );

    render(
      <WgwApiRuntimeProvider apiBaseUrl="/api/v1">
        <div>app shell</div>
      </WgwApiRuntimeProvider>,
    );

    expect(screen.getByText("app shell")).toBeTruthy();
    expect(screen.queryByText(/Restoring session/i)).toBeNull();
    expect(activeWgwApiRuntime()).toMatchObject({
      baseUrl: "/api/v1",
      useLiveApi: true,
    });

    resolveEnsure();
    await waitFor(() => {
      expect(startWgwSessionKeeper).toHaveBeenCalled();
    });
  });

  it("starts the session keeper after ensure settles", async () => {
    render(
      <WgwApiRuntimeProvider apiBaseUrl="/api/v1">
        <div>ready</div>
      </WgwApiRuntimeProvider>,
    );

    await waitFor(() => {
      expect(wgwEnsureSession).toHaveBeenCalledTimes(1);
      expect(startWgwSessionKeeper).toHaveBeenCalledTimes(1);
    });
  });

  it("starts the session keeper even when ensure soft-fails", async () => {
    vi.mocked(wgwEnsureSession).mockRejectedValue(new Error("Missing auth session"));

    render(
      <WgwApiRuntimeProvider apiBaseUrl="/api/v1">
        <div>ready</div>
      </WgwApiRuntimeProvider>,
    );

    await waitFor(() => {
      expect(startWgwSessionKeeper).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("ready")).toBeTruthy();
  });
});

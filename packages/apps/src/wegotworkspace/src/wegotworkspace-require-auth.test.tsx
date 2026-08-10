/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let mockPathname = "/mail";
let mockSearchStr = "";
let mockHash = "";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
      select({
        location: {
          pathname: mockPathname,
          searchStr: mockSearchStr,
          hash: mockHash,
        },
      }),
  };
});

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: vi.fn(() => true),
  wgwHasAuthenticatedSession: vi.fn(() => false),
  wgwSessionAvailable: vi.fn(() => false),
  wgwEnsureSession: vi.fn(async () => undefined),
}));

import {
  wgwEnsureSession,
  wgwHasAuthenticatedSession,
  wgwLiveApiEnabled,
  wgwSessionAvailable,
} from "@/lib/api/wgw/http";
import { withWeGotWorkspaceAuth } from "@/wegotworkspace/src/wegotworkspace-require-auth";

function Protected() {
  return <div>protected content</div>;
}

const Authenticated = withWeGotWorkspaceAuth(Protected);

afterEach(() => {
  cleanup();
});

describe("WeGotWorkspaceRequireAuth", () => {
  beforeEach(() => {
    navigate.mockReset();
    mockPathname = "/mail";
    mockSearchStr = "";
    mockHash = "";
    vi.mocked(wgwLiveApiEnabled).mockReset();
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReset();
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    vi.mocked(wgwSessionAvailable).mockReset();
    vi.mocked(wgwSessionAvailable).mockReturnValue(false);
    vi.mocked(wgwEnsureSession).mockReset();
    vi.mocked(wgwEnsureSession).mockResolvedValue(undefined);
  });

  it("renders children and does not redirect when tokens are present", async () => {
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);

    render(<Authenticated />);

    expect(screen.getByText("protected content")).toBeTruthy();
    await waitFor(() => {
      expect(navigate).not.toHaveBeenCalled();
    });
    expect(wgwEnsureSession).not.toHaveBeenCalled();
  });

  it("redirects immediately when no session can restore", async () => {
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    vi.mocked(wgwSessionAvailable).mockReturnValue(false);

    render(<Authenticated />);

    expect(screen.getByText("protected content")).toBeTruthy();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { return: "/mail" },
      });
    });
    expect(wgwEnsureSession).not.toHaveBeenCalled();
  });

  it("awaits ensure when session may still restore, then allows", async () => {
    let resolveEnsure!: () => void;
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    vi.mocked(wgwSessionAvailable).mockReturnValue(true);
    vi.mocked(wgwEnsureSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnsure = () => resolve(undefined);
        }),
    );

    render(<Authenticated />);

    expect(screen.getByText("protected content")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(wgwEnsureSession).toHaveBeenCalledTimes(1);
    });

    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);
    resolveEnsure();

    await waitFor(() => {
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  it("awaits ensure when session may still restore, then redirects if still unauthenticated", async () => {
    let resolveEnsure!: () => void;
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    vi.mocked(wgwSessionAvailable).mockReturnValue(true);
    vi.mocked(wgwEnsureSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnsure = () => resolve(undefined);
        }),
    );

    render(<Authenticated />);

    await waitFor(() => {
      expect(wgwEnsureSession).toHaveBeenCalledTimes(1);
    });
    expect(navigate).not.toHaveBeenCalled();

    resolveEnsure();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { return: "/mail" },
      });
    });
  });
});

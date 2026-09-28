import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveShareSessionResponse } from "@wgw/openapi-types/drive-types";
import { resetWgwSessionStateForTests } from "@/lib/api/wgw/http";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePublicRoute } from "@/share-ui/share-public-route";

const originalFetch = globalThis.fetch;

const harness = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  params: { token: "public-share-token" as string | undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => harness.navigate,
  useParams: () => ({ token: harness.params.token }),
}));

const MARKDOWN_PATH = "/users/demo.user/Projects/report.md";
const DOWNLOAD_PATH = "/users/bob/contacts.vcf";

function sessionBody(path: string): DriveShareSessionResponse {
  return {
    access_token: "guest-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    role: "guest",
    username: "share:session-key",
    share: {
      id: "11111111-1111-4111-8111-111111111111",
      path,
      defaultAccess: "view",
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

describe("SharePublicRoute", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
    harness.navigate.mockClear();
    harness.params.token = "public-share-token";
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetWgwSessionStateForTests();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:share-file");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetWgwSessionStateForTests();
  });

  it("navigates to the share destination after a valid session", async () => {
    installFetch((url) => {
      if (url.endsWith("/files/share-sessions")) {
        return jsonResponse(200, sessionBody(MARKDOWN_PATH));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<SharePublicRoute />);

    await waitFor(() => {
      expect(harness.navigate).toHaveBeenCalledWith({
        to: "/docs",
        search: { file: "users/demo.user/Projects/report.md" },
      });
    });
    expect(screen.queryByRole("heading", { name: shareLabels.publicLinkErrorTitle })).toBeNull();
    expect(screen.queryByRole("heading", { name: shareLabels.publicLinkPasswordTitle })).toBeNull();
  });

  it("shows the downloaded phase for a download destination", async () => {
    installFetch((url) => {
      if (url.endsWith("/files/share-sessions")) {
        return jsonResponse(200, sessionBody(DOWNLOAD_PATH));
      }
      if (url.includes("/files/content?")) {
        return new Response("BEGIN:VCARD", { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<SharePublicRoute />);

    expect(
      await screen.findByRole("heading", { name: shareLabels.publicLinkDownloadTitle }),
    ).toBeTruthy();
    expect(screen.getByText(shareLabels.publicLinkDownloadHint)).toBeTruthy();
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "share_password_required",
      error: "Password is required to open this link.",
      alert: null,
    },
    {
      code: "share_password_invalid",
      error: "Incorrect password.",
      alert: "Incorrect password.",
    },
  ])("stays on the password phase for $code", async ({ code, error, alert }) => {
    installFetch(() => jsonResponse(401, { error, code }));

    render(<SharePublicRoute />);

    expect(
      await screen.findByRole("heading", { name: shareLabels.publicLinkPasswordTitle }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: shareLabels.publicLinkContinue })).toBeTruthy();
    if (alert) {
      expect(screen.getByRole("alert").textContent).toBe(alert);
    } else {
      expect(screen.queryByRole("alert")).toBeNull();
    }
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: shareLabels.publicLinkErrorTitle })).toBeNull();
  });

  it.each([
    {
      label: "invalid",
      status: 404,
      error: "This share link is invalid or has expired.",
    },
    {
      label: "expired",
      status: 410,
      error: "This share link has expired.",
    },
    {
      label: "revoked",
      status: 410,
      error: "This share link is no longer available.",
    },
  ])("sets the error phase when the share is $label", async ({ status, error }) => {
    installFetch(() => jsonResponse(status, { error, code: "share_unavailable" }));

    render(<SharePublicRoute />);

    expect(
      await screen.findByRole("heading", { name: shareLabels.publicLinkErrorTitle }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.queryByRole("heading", { name: shareLabels.publicLinkPasswordTitle })).toBeNull();
    expect(harness.navigate).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveShareSessionResponse } from "@wgw/openapi-types/drive-types";
import { createDriveShareSession, ShareSessionError } from "@/lib/api/wgw/drive-share-sessions";

const originalFetch = globalThis.fetch;
const shareSessionsUrl = "http://wgw.test/api/v1/files/share-sessions";

const session: DriveShareSessionResponse = {
  access_token: "guest-access-token",
  token_type: "Bearer",
  expires_in: 3600,
  role: "guest",
  username: "share:session-key",
  share: {
    id: "11111111-1111-4111-8111-111111111111",
    path: "/users/demo.user/Projects/report.md",
    defaultAccess: "view",
  },
};

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createDriveShareSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("throws ShareSessionError with status and code when the response is not OK", async () => {
    vi.stubEnv("VITE_WGW_API_BASE_URL", "http://wgw.test/api/v1");
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        401,
        { error: "Incorrect password.", code: "share_password_invalid" },
        "Unauthorized",
      ),
    ) as typeof fetch;

    const pending = createDriveShareSession("share-token", "wrong");

    await expect(pending).rejects.toBeInstanceOf(ShareSessionError);
    await expect(pending).rejects.toMatchObject({
      status: 401,
      code: "share_password_invalid",
      message: "Incorrect password.",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(shareSessionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "share-token", password: "wrong" }),
      signal: undefined,
    });
  });

  it("parses an OK body as DriveShareSessionResponse", async () => {
    vi.stubEnv("VITE_WGW_API_BASE_URL", "http://wgw.test/api/v1");
    globalThis.fetch = vi.fn(async () => jsonResponse(200, session)) as typeof fetch;

    await expect(createDriveShareSession("share-token")).resolves.toEqual(session);
    expect(globalThis.fetch).toHaveBeenCalledWith(shareSessionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "share-token" }),
      signal: undefined,
    });
  });
});

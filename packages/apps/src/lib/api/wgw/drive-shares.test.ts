import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDriveShare,
  createDriveShareInvite,
  deleteDriveShare,
  deleteDriveShareInvite,
  fetchDriveShareAtPath,
  fetchDriveShareByPrincipal,
  patchDriveShare,
  revokeAllDrivePublicShares,
  searchDriveSharePrincipals,
} from "@/lib/api/wgw/drive-shares";

const { wgwFetch, wgwReadJson } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch,
  wgwReadJson,
  wgwErrorMessageFromBody: (_body: string, status: number, statusText: string) =>
    `${status} ${statusText}`,
}));

function mockOkJson(payload: unknown): void {
  wgwFetch.mockResolvedValueOnce({ ok: true, status: 200 });
  wgwReadJson.mockResolvedValueOnce(payload);
}

describe("drive-shares client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET at-path encodes the normalized virtual path", async () => {
    mockOkJson({ data: { path: "/users/demo.user/report.md" } });

    await fetchDriveShareAtPath("users/demo.user/report.md/");

    expect(wgwFetch).toHaveBeenCalledWith(
      "/files/shares/at-path?path=%2Fusers%2Fdemo.user%2Freport.md",
      { signal: undefined },
    );
  });

  it("GET by-principal includes principal and optional scope", async () => {
    mockOkJson({ data: { principal: "alice", queriedPrincipalType: "user", entries: [] } });

    await fetchDriveShareByPrincipal("alice", "/users/demo.user");

    expect(wgwFetch).toHaveBeenCalledWith(
      "/files/shares/by-principal?principal=alice&scope=%2Fusers%2Fdemo.user",
      { signal: undefined },
    );
  });

  it("GET principals omits query when search is empty", async () => {
    mockOkJson({ data: [] });

    await searchDriveSharePrincipals("   ");

    expect(wgwFetch).toHaveBeenCalledWith("/files/shares/principals", { signal: undefined });
  });

  it("POST create share sends JSON body", async () => {
    mockOkJson({
      data: {
        id: "share-1",
        path: "/users/demo.user/report.md",
        kind: "member",
        defaultAccess: "edit",
        hasPassword: false,
        myRights: {
          mayView: true,
          mayComment: true,
          mayReview: true,
          mayEditContent: true,
          mayManageStructure: true,
          mayShare: true,
        },
      },
    });

    await createDriveShare({
      path: "/users/demo.user/report.md",
      kind: "member",
      defaultAccess: "edit",
    });

    expect(wgwFetch).toHaveBeenCalledWith("/files/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/users/demo.user/report.md",
        kind: "member",
        defaultAccess: "edit",
      }),
      signal: undefined,
    });
  });

  it("PATCH share targets the share id path", async () => {
    mockOkJson({
      data: {
        id: "share-1",
        path: "/users/demo.user/report.md",
        kind: "member",
        defaultAccess: "view",
        hasPassword: false,
        myRights: {
          mayView: true,
          mayComment: true,
          mayReview: true,
          mayEditContent: true,
          mayManageStructure: true,
          mayShare: true,
        },
      },
    });

    await patchDriveShare("share-1", {
      updatedAt: "2026-07-01T10:00:00.000Z",
      defaultAccess: "view",
    });

    expect(wgwFetch).toHaveBeenCalledWith("/files/shares/share-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updatedAt: "2026-07-01T10:00:00.000Z",
        defaultAccess: "view",
      }),
      signal: undefined,
    });
  });

  it("DELETE share and invite use encoded path segments", async () => {
    wgwFetch.mockResolvedValue({ ok: true, status: 200 });

    await deleteDriveShare("share-1");
    await deleteDriveShareInvite("share-1", "invite-1");

    expect(wgwFetch).toHaveBeenNthCalledWith(1, "/files/shares/share-1", {
      method: "DELETE",
      signal: undefined,
    });
    expect(wgwFetch).toHaveBeenNthCalledWith(2, "/files/shares/share-1/invites/invite-1", {
      method: "DELETE",
      signal: undefined,
    });
  });

  it("POST revoke-all public shares encodes the scope path", async () => {
    mockOkJson({ data: { revokedCount: 2, shareIds: ["a", "b"] } });

    await revokeAllDrivePublicShares("/users/demo.user/Projects");

    expect(wgwFetch).toHaveBeenCalledWith(
      "/files/shares/public/revoke-all?path=%2Fusers%2Fdemo.user%2FProjects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: undefined,
      },
    );
  });

  it("POST invite sends email and access in the body", async () => {
    mockOkJson({
      data: {
        id: "invite-1",
        email: "guest@example.com",
        access: "view",
        inviteToken: "token",
      },
    });

    await createDriveShareInvite("share-1", {
      email: "guest@example.com",
      access: "view",
    });

    expect(wgwFetch).toHaveBeenCalledWith("/files/shares/share-1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "guest@example.com",
        access: "view",
      }),
      signal: undefined,
    });
  });
});

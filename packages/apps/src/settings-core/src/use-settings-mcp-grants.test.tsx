import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSettingsMcpGrants } from "@/settings-core/src/use-settings-mcp-grants";

describe("useSettingsMcpGrants", () => {
  it("loads grants from listMcpGrants", async () => {
    const listMcpGrants = vi.fn().mockResolvedValue([
      {
        clientId: "abc",
        clientName: "Claude",
        clientOrigin: "https://claude.ai",
        connectedAt: "2026-09-08T10:00:00Z",
        scopes: ["drive"],
        lastUsedAt: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSettingsMcpGrants({
        saveProfile: vi.fn(),
        saveMail: vi.fn(),
        listMcpGrants,
        revokeMcpGrant: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.grants).toHaveLength(1);
    });
    expect(listMcpGrants).toHaveBeenCalled();
    expect(result.current.grants[0]?.clientOrigin).toBe("https://claude.ai");
  });

  it("revokes a grant and drops it from the list", async () => {
    const listMcpGrants = vi.fn().mockResolvedValue([
      {
        clientId: "abc",
        clientName: "Claude",
        clientOrigin: "https://claude.ai",
        connectedAt: "2026-09-08T10:00:00Z",
        scopes: ["drive"],
        lastUsedAt: null,
      },
    ]);
    const revokeMcpGrant = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSettingsMcpGrants({
        saveProfile: vi.fn(),
        saveMail: vi.fn(),
        listMcpGrants,
        revokeMcpGrant,
      }),
    );

    await waitFor(() => {
      expect(result.current.grants).toHaveLength(1);
    });

    await act(async () => {
      await result.current.revoke("abc");
    });

    expect(revokeMcpGrant).toHaveBeenCalledWith("abc");
    expect(result.current.grants).toEqual([]);
  });
});

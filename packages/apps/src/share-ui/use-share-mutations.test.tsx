import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { useShareMutations } from "@/share-ui/use-share-mutations";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/share-ui/generate-friendly-share-password", () => ({
  generateFriendlySharePassword: vi.fn(() => "river-maple-42"),
}));

const PUBLIC_SHARE_ID = "b2222222-2222-4222-8222-222222222222";

function renderShareMutations(
  operations: DriveShareOperations,
  atPath: DriveShareAtPath = mockDriveShareAtPath,
) {
  const refetch = vi.fn(async () => atPath);
  const { result } = renderHook(() =>
    useShareMutations({
      path: atPath.path,
      operations,
      atPath,
      refetch,
    }),
  );
  return { result, refetch };
}

describe("useShareMutations updatePublicPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("patches a generated password when enabling with an empty draft", async () => {
    const patchShare = vi.fn(async () => ({
      ...mockDriveShareAtPath.directShares[1]!.share,
      hasPassword: true,
      updatedAt: "2026-07-01T11:00:00.000Z",
    }));
    const operations = { patchShare } as unknown as DriveShareOperations;
    const { result, refetch } = renderShareMutations(operations);

    let password: string | undefined;
    await act(async () => {
      password = await result.current.updatePublicPassword(true, "");
    });

    expect(password).toBe("river-maple-42");
    expect(patchShare).toHaveBeenCalledWith(PUBLIC_SHARE_ID, {
      updatedAt: mockDriveShareAtPath.directShares[1]!.share.updatedAt,
      password: "river-maple-42",
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("patches the provided password without generating a new one", async () => {
    const patchShare = vi.fn(async () => ({
      ...mockDriveShareAtPath.directShares[1]!.share,
      hasPassword: true,
      updatedAt: "2026-07-01T11:00:00.000Z",
    }));
    const operations = { patchShare } as unknown as DriveShareOperations;
    const { result } = renderShareMutations(operations);

    let password: string | undefined;
    await act(async () => {
      password = await result.current.updatePublicPassword(true, " custom-pass ");
    });

    expect(password).toBe("custom-pass");
    expect(patchShare).toHaveBeenCalledWith(PUBLIC_SHARE_ID, {
      updatedAt: mockDriveShareAtPath.directShares[1]!.share.updatedAt,
      password: "custom-pass",
    });
  });

  it("clears the password when disabling", async () => {
    const patchShare = vi.fn(async () => ({
      ...mockDriveShareAtPath.directShares[1]!.share,
      hasPassword: false,
      updatedAt: "2026-07-01T11:00:00.000Z",
    }));
    const operations = { patchShare } as unknown as DriveShareOperations;
    const { result } = renderShareMutations(operations);

    let password: string | undefined;
    await act(async () => {
      password = await result.current.updatePublicPassword(false, "ignored");
    });

    expect(password).toBeUndefined();
    expect(patchShare).toHaveBeenCalledWith(PUBLIC_SHARE_ID, {
      updatedAt: mockDriveShareAtPath.directShares[1]!.share.updatedAt,
      password: null,
    });
  });
});

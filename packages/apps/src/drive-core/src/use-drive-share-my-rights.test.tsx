import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { useDriveShareMyRights } from "./use-drive-share-my-rights";

const viewRights = {
  mayView: true,
  mayComment: false,
  mayReview: false,
  mayEditContent: false,
  mayManageStructure: false,
  mayShare: false,
};

function mockAtPath(myRights: DriveShareAtPath["myRights"]): DriveShareOperations {
  return {
    getAtPath: vi.fn(
      async () =>
        ({
          path: "/users/bob/docs/plan.md",
          myRights,
          shares: [],
          effectiveGrants: [],
        }) as DriveShareAtPath,
    ),
  } as DriveShareOperations;
}

describe("useDriveShareMyRights", () => {
  it("returns view-only myRights from at-path", async () => {
    const operations = mockAtPath(viewRights);
    const { result } = renderHook(() =>
      useDriveShareMyRights({
        path: "/users/bob/docs/plan.md",
        operations,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.myRights).toEqual(viewRights);
    });
    expect(result.current.mayShare).toBe(false);
    expect(operations.getAtPath).toHaveBeenCalled();
  });

  it("stays null when disabled", () => {
    const operations = mockAtPath(viewRights);
    const { result } = renderHook(() =>
      useDriveShareMyRights({
        path: "/users/bob/docs/plan.md",
        operations,
        enabled: false,
      }),
    );

    expect(result.current.myRights).toBeNull();
    expect(result.current.mayShare).toBeUndefined();
    expect(operations.getAtPath).not.toHaveBeenCalled();
  });
});

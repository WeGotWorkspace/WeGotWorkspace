import { describe, expect, it, vi } from "vitest";
import {
  fetchDriveTrashListing,
  isDriveTrashNotFoundError,
} from "@/drive-core/src/drive-trash-listing";

describe("isDriveTrashNotFoundError", () => {
  it("recognizes missing trash folder errors", () => {
    expect(isDriveTrashNotFoundError(new Error("404 Not Found"))).toBe(true);
    expect(isDriveTrashNotFoundError(new Error("Directory does not exist"))).toBe(true);
    expect(isDriveTrashNotFoundError(new Error("permission denied"))).toBe(false);
  });
});

describe("fetchDriveTrashListing", () => {
  it("returns an empty list when trash is missing", async () => {
    const listDirectory = vi.fn().mockRejectedValue(new Error("404 not found"));
    await expect(fetchDriveTrashListing({ listDirectory }, "alice")).resolves.toEqual([]);
  });

  it("rethrows non-404 errors", async () => {
    const listDirectory = vi.fn().mockRejectedValue(new Error("permission denied"));
    await expect(fetchDriveTrashListing({ listDirectory }, "alice")).rejects.toThrow(
      "permission denied",
    );
  });
});

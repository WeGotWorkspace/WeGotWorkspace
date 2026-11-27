/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/lib/offline/docs/docs-schema";
import { writeDocsAvailability } from "@/lib/offline/docs/docs-availability-store";
import { useDocsHomeOpenGuard } from "@/docs-core/src/use-docs-home-offline-availability";
import type { DriveFile } from "@/lib/files/drive-models";

const username = "guard-user";

function file(path: string): DriveFile {
  return {
    id: `/${path}`,
    apiPath: `/${path}`,
    name: path.split("/").pop(),
  } as unknown as DriveFile;
}

function guard(available: ReadonlySet<string>, onUnavailable = vi.fn()) {
  const { result } = renderHook(() =>
    useDocsHomeOpenGuard({
      isOfflineListing: true,
      offlineAvailableIds: available,
      username,
      onUnavailable,
    }),
  );
  return { canOpen: result.current, onUnavailable };
}

// The resolved set can lag background body sync (#2063 C4).
describe("useDocsHomeOpenGuard", () => {
  it("opens a row the set has not caught up with when its body is on the device", async () => {
    await writeDocsAvailability(username, { id: "users/guard-user/landed.md", location: "" });
    const { canOpen, onUnavailable } = guard(new Set());

    expect(await canOpen(file("users/guard-user/landed.md"))).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("refuses a row whose body is not on the device", async () => {
    const { canOpen, onUnavailable } = guard(new Set());

    expect(await canOpen(file("users/guard-user/never.md"))).toBe(false);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("opens a row in the set without reading the device", async () => {
    const { canOpen } = guard(new Set(["/users/guard-user/known.md"]));
    expect(await canOpen(file("users/guard-user/known.md"))).toBe(true);
  });
});

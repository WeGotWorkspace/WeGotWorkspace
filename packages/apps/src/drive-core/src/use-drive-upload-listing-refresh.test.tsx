import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { useDriveUploadListingRefresh } from "@/drive-core/src/use-drive-upload-listing-refresh";

const user = "ada";

function entry(name: string, upload?: WgwDriveDirectoryEntry["upload"]): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path: upload ? `/users/ada/\u0000upload:${upload.id}` : `/users/ada/${name}`,
    name,
    size: 3,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
    ...(upload ? { upload } : {}),
  };
}

function cached(files: WgwDriveDirectoryEntry[]): DriveUIData {
  return {
    user: { username: user, name: user, role: "user", roots: [] },
    cwd: "/users/ada",
    directory: { location: "/users/ada", files },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(cleanup);

describe("useDriveUploadListingRefresh", () => {
  it("applies only the newest cache read when an older one finishes last", async () => {
    const first = deferred<DriveUIData | null>();
    const second = deferred<DriveUIData | null>();
    const readCachedDirectory = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let notify: () => void = () => {};
    const operations = {
      readCachedDirectory,
      subscribeUploadQueue: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
    } as unknown as DriveAPIOperations;
    const groupRootNamesRef = { current: new Set<string>() };
    const { result } = renderHook(() => {
      const [files, setFiles] = useState<DriveFile[]>([]);
      useDriveUploadListingRefresh({
        operations,
        folderViewPath: "My Drive",
        currentUsername: user,
        groupRootNamesRef,
        setFiles,
        listing: null,
      });
      return files;
    });
    await waitFor(() => expect(readCachedDirectory).toHaveBeenCalledTimes(1));
    act(() => notify());
    await waitFor(() => expect(readCachedDirectory).toHaveBeenCalledTimes(2));

    // The newer read saw the finished file; the older one still saw the placeholder.
    await act(async () => {
      second.resolve(cached([entry("a.txt")]));
    });
    await waitFor(() => expect(result.current.map((file) => file.title)).toEqual(["a.txt"]));
    await act(async () => {
      first.resolve(cached([entry("a.txt", { id: "u1", batchId: "b", status: "queued" })]));
    });

    expect(result.current.map((file) => [file.title, file.upload?.status])).toEqual([
      ["a.txt", undefined],
    ]);
  });
});

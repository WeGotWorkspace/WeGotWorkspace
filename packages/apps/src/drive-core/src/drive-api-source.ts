import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { createWgwDriveOperations, fetchDriveLiveBootstrap } from "@/lib/api/wgw/drive";
import { createWgwDriveShareOperations } from "@/lib/api/wgw/drive-shares";
import type {
  DriveAPIOperations,
  DriveAppBootstrap,
  DriveShareOperations,
} from "@/drive-core/src/drive-types";

export type DriveApiSource = {
  loadBootstrap: () => Promise<DriveAppBootstrap>;
  createOperations: (bootstrap?: DriveAppBootstrap) => DriveAPIOperations | undefined;
  createShareOperations: (bootstrap?: DriveAppBootstrap) => DriveShareOperations;
};

export function createWgwDriveApiSource(): DriveApiSource {
  return {
    loadBootstrap: fetchDriveLiveBootstrap,
    createOperations: (bootstrap) =>
      createWgwDriveOperations(bootstrap?.data.cwd ?? "/", bootstrap?.data.plugins ?? []),
    createShareOperations: () => createWgwDriveShareOperations(),
  };
}

export function createDefaultDriveApiSource(): DriveApiSource {
  return createWorkspaceSource<DriveApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createDriveAppBootstrap()),
      createOperations: () => undefined,
      createShareOperations: () => createMockDriveShareOperations(),
    }),
    createLiveSource: createWgwDriveApiSource,
  });
}

import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { wgwFetchPrincipal, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { createWgwDocsDriveOperations } from "@/lib/offline/docs/docs-drive-operations";
import type { DocsAPIOperations, DocsAppBootstrap } from "@/docs-core/src/docs-types";

export type DocsApiSource = {
  loadBootstrap: () => Promise<DocsAppBootstrap>;
  createNetworkOperations: () => DocsAPIOperations;
  createOperations: (bootstrap?: DocsAppBootstrap) => DocsAPIOperations | undefined;
};

export function createHybridDocsApiSource(): DocsApiSource {
  return {
    loadBootstrap: async () => {
      const session = await wgwFetchPrincipal();
      return { session, data: { document: null } };
    },
    createNetworkOperations: () => createWgwDocsDriveOperations(),
    createOperations: () => createWgwDocsDriveOperations(),
  };
}

export function createDefaultDocsApiSource(): DocsApiSource {
  return createWorkspaceSource<DocsApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: mocksInBuild
      ? () => ({
          loadBootstrap: () => Promise.resolve(createDocsAppBootstrap()),
          createNetworkOperations: () => createWgwDocsDriveOperations(),
          createOperations: () => createWgwDocsDriveOperations(),
        })
      : mocksNotInBuild,
    createLiveSource: createHybridDocsApiSource,
  });
}

import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import {
  createInstallerAppBootstrap,
  type InstallerAppBootstrap,
} from "@/lib/api/mock/installer-bootstrap";
import { createMockInstallerOperations } from "@/lib/api/mock/installer-mock-operations";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { fetchInstallerBootstrap } from "@/lib/api/wgw/installer";
import type { InstallerAPIOperations } from "@/installer-core/src/installer-types";
import { wgwInstallerOperations } from "@/installer-core/src/installer-wgw-operations";

export type InstallerApiSource = {
  loadBootstrap: () => Promise<InstallerAppBootstrap>;
  createOperations: (
    _source: InstallerApiSource,
    bootstrap: InstallerAppBootstrap | null | undefined,
  ) => InstallerAPIOperations | undefined;
};

async function loadLiveInstallerBootstrap(): Promise<InstallerAppBootstrap> {
  const response = await fetchInstallerBootstrap();
  return {
    data: { state: response.state ?? null },
    session: mockWorkspaceSession,
  };
}

export function createWgwInstallerApiSource(): InstallerApiSource {
  return {
    loadBootstrap: loadLiveInstallerBootstrap,
    createOperations: () => wgwInstallerOperations,
  };
}

export function createDefaultInstallerApiSource(): InstallerApiSource {
  return createWorkspaceSource<InstallerApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createInstallerAppBootstrap()),
      createOperations: (_source, bootstrap) => {
        const seed = bootstrap?.data.state ?? createInstallerAppBootstrap().data.state;
        return seed ? createMockInstallerOperations(seed) : undefined;
      },
    }),
    createLiveSource: createWgwInstallerApiSource,
  });
}

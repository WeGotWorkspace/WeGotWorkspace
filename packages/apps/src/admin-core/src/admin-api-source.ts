import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { createAdminAppBootstrap, type AdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createWgwAdminOperations, fetchAdminLiveBootstrap } from "@/lib/api/wgw/admin";
import { createMockAdminOperations } from "@/admin-core/src/admin-mock-operations";
import type { AdminAPIOperations } from "@/lib/models/admin-types";

export type AdminApiSource = {
  loadBootstrap: () => Promise<AdminAppBootstrap>;
  createOperations: (
    _source: AdminApiSource,
    bootstrap: AdminAppBootstrap | null | undefined,
  ) => AdminAPIOperations | undefined;
};

export function createWgwAdminApiSource(): AdminApiSource {
  return {
    loadBootstrap: fetchAdminLiveBootstrap,
    createOperations: () => createWgwAdminOperations(),
  };
}

export function createDefaultAdminApiSource(): AdminApiSource {
  return createWorkspaceSource<AdminApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createAdminAppBootstrap()),
      createOperations: (_source, bootstrap) =>
        bootstrap?.data ? createMockAdminOperations(bootstrap.data) : undefined,
    }),
    createLiveSource: createWgwAdminApiSource,
  });
}

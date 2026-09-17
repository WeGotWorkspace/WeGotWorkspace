import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import {
  createSettingsAppBootstrap,
  type SettingsAppBootstrap,
} from "@/lib/api/mock/settings-bootstrap";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  fetchSettingsLiveBootstrap,
  listSettingsMcpGrants,
  revokeSettingsMcpGrant,
  saveSettingsMail,
  saveSettingsProfile,
} from "@/lib/api/wgw/settings";
import type { SettingsAPIOperations } from "@/settings-core/src/settings-types";

export type SettingsApiSource = {
  loadBootstrap: () => Promise<SettingsAppBootstrap>;
  createOperations: () => SettingsAPIOperations | undefined;
};

function createWgwOperations(): SettingsAPIOperations {
  return {
    saveProfile: (input, opts) => saveSettingsProfile(input, opts),
    saveMail: (input, opts) => saveSettingsMail(input, opts),
    listMcpGrants: (opts) => listSettingsMcpGrants(opts),
    revokeMcpGrant: (clientId, opts) => revokeSettingsMcpGrant(clientId, opts),
  };
}

export function createWgwSettingsApiSource(): SettingsApiSource {
  return {
    loadBootstrap: fetchSettingsLiveBootstrap,
    createOperations: () => createWgwOperations(),
  };
}

export function createDefaultSettingsApiSource(): SettingsApiSource {
  return createWorkspaceSource<SettingsApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createSettingsAppBootstrap()),
      createOperations: () => undefined,
    }),
    createLiveSource: createWgwSettingsApiSource,
  });
}

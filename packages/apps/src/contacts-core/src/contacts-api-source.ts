import {
  createContactsAppBootstrap,
  type ContactsAppBootstrap,
} from "@/lib/api/mock/contacts-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type { ContactsAPIOperations } from "@/lib/models/contacts-types";
import {
  createHybridContactsOperations,
  loadContactsBootstrapHybrid,
} from "@/lib/offline/contacts/contacts-hybrid-operations";
import { resolveContactsOfflineUsername } from "@/lib/offline/core/offline-session";

export type ContactsApiSource = {
  loadBootstrap: () => Promise<ContactsAppBootstrap>;
  createOperations: (bootstrap?: ContactsAppBootstrap) => ContactsAPIOperations | undefined;
};

export function createHybridContactsApiSource(): ContactsApiSource {
  return {
    loadBootstrap: loadContactsBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveContactsOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      return createHybridContactsOperations(username);
    },
  };
}

export function createDefaultContactsApiSource(): ContactsApiSource {
  return createWorkspaceSource<ContactsApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createContactsAppBootstrap()),
      createOperations: (bootstrap) => {
        const username = resolveContactsOfflineUsername(bootstrap?.session.user.username);
        if (!username) return undefined;
        return createHybridContactsOperations(username);
      },
    }),
    createLiveSource: createHybridContactsApiSource,
  });
}

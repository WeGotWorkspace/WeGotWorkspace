import { createNotesAppBootstrap, type NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createHybridNotesOperations,
  loadNotesBootstrapHybrid,
} from "@/lib/offline/notes-hybrid-operations";
import { resolveNotesOfflineUsername } from "@/lib/offline/core/offline-session";
import type { NotesAPIOperations } from "@/lib/models/notes-types";
import { createWgwNotesMarkdownImport } from "@/notes-core/src/notes-markdown-import-wgw";

export type NotesApiSource = {
  loadBootstrap: () => Promise<NotesAppBootstrap>;
  createOperations: (bootstrap?: NotesAppBootstrap) => NotesAPIOperations | undefined;
};

export function createHybridNotesApiSource(): NotesApiSource {
  return {
    loadBootstrap: loadNotesBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveNotesOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      // Markdown import (#1623) writes straight to the API, so only the live source has it.
      return {
        ...createHybridNotesOperations(username),
        markdownImport: createWgwNotesMarkdownImport(username),
      };
    },
  };
}

export function createDefaultNotesApiSource(): NotesApiSource {
  return createWorkspaceSource<NotesApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createNotesAppBootstrap()),
      createOperations: (bootstrap) => {
        const username = resolveNotesOfflineUsername(bootstrap?.session.user.username);
        if (!username) return undefined;
        return createHybridNotesOperations(username);
      },
    }),
    createLiveSource: createHybridNotesApiSource,
  });
}

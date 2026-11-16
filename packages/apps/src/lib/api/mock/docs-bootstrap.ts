import { DOCS_DEMO_MARKDOWN, DOCS_DEMO_TEXT } from "@/lib/api/mock/docs-demo-content";
import type { DocsAppBootstrap } from "@/lib/models/docs-types";
import { mockWorkspaceSession } from "./workspace-session-mock";

export function createDocsAppBootstrap(overrides?: Partial<DocsAppBootstrap>): DocsAppBootstrap {
  return {
    session: overrides?.session ?? mockWorkspaceSession,
    data: overrides?.data ?? {
      document: {
        apiPath: "/users/demo/readme.md",
        fileName: "readme.md",
        content: DOCS_DEMO_MARKDOWN,
      },
    },
  };
}

export function createDocsTxtBootstrap(overrides?: Partial<DocsAppBootstrap>): DocsAppBootstrap {
  return createDocsAppBootstrap({
    ...overrides,
    data: {
      document: {
        apiPath: "/users/demo/meeting-notes.txt",
        fileName: "meeting-notes.txt",
        content: DOCS_DEMO_TEXT,
      },
    },
  });
}

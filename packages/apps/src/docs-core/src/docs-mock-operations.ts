import { parentAndName } from "@/lib/files/api-path";
import { DOCS_DEMO_MARKDOWN, DOCS_DEMO_TEXT } from "@/lib/api/mock/docs-demo-content";
import type { DocsAPIOperations } from "@/lib/models/docs-types";

const MOCK_FILES: Record<string, string> = {
  "/users/demo/readme.md": DOCS_DEMO_MARKDOWN,
  "/users/demo/Project Brief.md": DOCS_DEMO_MARKDOWN,
  "/users/demo/meeting-notes.txt": DOCS_DEMO_TEXT,
};

function mockContentForPath(apiPath: string): string {
  if (apiPath.toLowerCase().endsWith(".txt")) {
    return MOCK_FILES[apiPath] ?? DOCS_DEMO_TEXT;
  }
  return MOCK_FILES[apiPath] ?? DOCS_DEMO_MARKDOWN;
}

/** Storybook / mock shell: in-memory rename without Drive API. */
export function createMockDocsOperations(): DocsAPIOperations {
  return {
    async loadFile(apiPath) {
      return mockContentForPath(apiPath);
    },
    async saveFile() {},
    async renameFile(apiPath, newName) {
      const { destination } = parentAndName(apiPath);
      return destination === "/" ? `/${newName}` : `${destination}/${newName}`;
    },
  };
}

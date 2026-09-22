import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { createMockDocsOperations } from "@/docs-core/src/docs-mock-operations";
import { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import {
  createDocsHomePaginatedFetcher,
  createMockDocsHomeOperations,
  DOCS_HOME_STORY_FIXTURES,
  docsHomeStorySession,
} from "@/docs-core/stories/docs-home-story-shared";
import "@/docs-core/src/docs-workspace.css";
import "@/docs-core/src/docs-home-workspace.css";

const mockShareOperations = createMockDriveShareOperations();
const bootstrap = createDocsAppBootstrap();
const mockDocument = bootstrap.data.document!;
const mockOperations = createMockDocsOperations();

const brandingMeta = createBrandingStoryMeta({
  appId: "docs",
  workspaceClass: "docs-workspace",
  accentToken: "workspace-accent",
  fullAccentSidebar: true,
  component: DocsHomeWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Docs",
  tags: ["vitest-ci"],
} satisfies Meta<typeof DocsHomeWorkspace>;

export default meta;
type Story = StoryObj<typeof DocsHomeWorkspace>;

/** Docs list / home chrome (sidebar My Docs, Shared with me, drives) — not inside a document. */
export const Default: Story = {
  name: "Home",
  args: {
    session: docsHomeStorySession,
    fetcher: createDocsHomePaginatedFetcher(DOCS_HOME_STORY_FIXTURES),
    operations: createMockDocsHomeOperations(["/users/alice/Roadmap 2026.md"]),
    shareOperations: mockShareOperations,
    onOpenFile: () => {},
    onCreateDocument: () => {},
    onLogout: () => {},
  },
};

/** Open document: outline / editor chrome with the same branding knobs. */
export const InDoc: Story = {
  name: "In document",
  render: () => (
    <DocsWorkspace
      {...bootstrap}
      filePath={mockDocument.apiPath}
      operations={mockOperations}
      shareOperations={mockShareOperations}
      onFileRenamed={() => {}}
      onLogout={() => {}}
    />
  ),
};

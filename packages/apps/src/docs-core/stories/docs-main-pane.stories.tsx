import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { TooltipProvider } from "@/ui/tooltip";
import { createDocsAppBootstrap, createDocsTxtBootstrap } from "@/lib/api/mock/docs-bootstrap";
import type { DocsAppBootstrap } from "@/docs-core/src/docs-types";
import { createMockDocsOperations } from "@/docs-core/src/docs-mock-operations";
import { DocsMainPane } from "@/docs-core/src/docs-main-pane";
import { useDocsController } from "@/docs-core/src/use-docs-controller";
import "@/docs-core/src/docs-workspace.css";

function DocsMainPaneHarness({
  bootstrap,
  viewSource = false,
}: {
  bootstrap: DocsAppBootstrap;
  viewSource?: boolean;
}) {
  const operations = useMemo(() => createMockDocsOperations(), []);
  const controller = useDocsController({
    filePath: bootstrap.data.document?.apiPath ?? null,
    operations,
    initialDocument: bootstrap.data.document,
  });
  const fileKey = bootstrap.data.document?.apiPath ?? "empty";
  const [, setEditor] = useState<Editor | null>(null);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="docs-workspace"
        style={{
          minHeight: "100dvh",
          backgroundColor: "var(--color-we-got-soft)",
        }}
      >
        <div className="docs-workspace__editor mx-auto max-w-3xl px-6 py-10 md:px-12 md:py-16">
          <DocsMainPane
            controller={controller}
            fileKey={fileKey}
            viewSource={viewSource}
            onEditorReady={setEditor}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

const meta = {
  title: "Features/Docs/Panes/Main",
  component: DocsMainPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DocsMainPane>;

export default meta;
type Story = StoryObj<typeof DocsMainPane>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => <DocsMainPaneHarness bootstrap={createDocsAppBootstrap()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Product brief", level: 1 }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Discovery notes")).toBeInTheDocument();
    await expect(canvas.getByText("Approve table layout")).toBeInTheDocument();
  },
};

export const PlainText: Story = {
  render: () => <DocsMainPaneHarness bootstrap={createDocsTxtBootstrap()} />,
};

export const Empty: Story = {
  render: () => (
    <DocsMainPaneHarness bootstrap={createDocsAppBootstrap({ data: { document: null } })} />
  ),
};

export const ViewSource: Story = {
  render: () => <DocsMainPaneHarness bootstrap={createDocsAppBootstrap()} viewSource />,
};

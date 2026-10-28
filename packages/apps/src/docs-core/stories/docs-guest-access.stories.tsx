import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { createMockDocsOperations } from "@/docs-core/src/docs-mock-operations";
import { docsLabels as L } from "@/docs-core/src/docs-labels";
import type { DocsAPIOperations } from "@/docs-core/src/docs-types";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import "@/docs-core/src/docs-workspace.css";

/**
 * A guest has no way to save a Doc yet (#1713): public links are view-only and
 * guest uploads are refused. A guest opens the Doc read-only with a notice, and
 * no control suggests editing. Signed-in users keep the editor and autosave.
 */
const meta: Meta<typeof DocsWorkspace> = {
  title: "Features/Docs/GuestAccess",
  component: DocsWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof DocsWorkspace>;

const bootstrap = createDocsAppBootstrap();
const filePath = bootstrap.data.document!.apiPath;
/** Autosave waits 2.5 s after the last keystroke. */
const AUTOSAVE_WAIT_MS = 4000;

function spiedOperations(): DocsAPIOperations & { saveFile: ReturnType<typeof fn> } {
  const operations = createMockDocsOperations();
  return { ...operations, saveFile: fn(operations.saveFile) };
}

const guestOperations = spiedOperations();
const signedInOperations = spiedOperations();

export const GuestReadsOnly: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath,
    guestSession: true,
    operations: guestOperations,
    onLogout: () => {},
  },
  play: async ({ canvasElement }) => {
    guestOperations.saveFile.mockClear();
    const canvas = within(canvasElement);

    expect(await canvas.findByText(L.guestReadOnlyNotice)).toBeInTheDocument();
    await canvas.findByRole("heading", { name: "Product brief", level: 1 });

    // Read-only: no textbox to type into, no rename, and the source view only shows.
    expect(canvas.queryByRole("textbox", { name: L.editor })).toBeNull();
    expect(canvasElement.querySelector(".ProseMirror")).toHaveAttribute("contenteditable", "false");
    expect(canvas.queryAllByRole("button", { name: L.rename })).toHaveLength(0);
    expect(canvas.queryAllByRole("button", { name: L.viewSource })).toHaveLength(0);

    await userEvent.click(canvas.getAllByRole("button", { name: L.viewSourceReadOnly })[0]!);
    const source = await canvas.findByRole("textbox", { name: /source/i });
    expect(source).toHaveAttribute("readonly");
    await userEvent.type(source, "guest typing");
    expect(source).not.toHaveValue(expect.stringContaining("guest typing"));

    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_WAIT_MS));
    expect(guestOperations.saveFile).not.toHaveBeenCalled();
  },
};

export const SignedInEdits: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    filePath,
    guestSession: false,
    operations: signedInOperations,
    onFileRenamed: () => {},
    onLogout: () => {},
  },
  play: async ({ canvasElement }) => {
    signedInOperations.saveFile.mockClear();
    const canvas = within(canvasElement);

    const editor = await canvas.findByRole("textbox", { name: L.editor });
    expect(canvas.queryByText(L.guestReadOnlyNotice)).toBeNull();
    expect(canvas.getAllByRole("button", { name: L.rename }).length).toBeGreaterThan(0);
    expect(canvas.getAllByRole("button", { name: L.viewSource }).length).toBeGreaterThan(0);

    await userEvent.click(editor);
    await userEvent.keyboard("Signed-in edit");
    await waitFor(() => expect(signedInOperations.saveFile).toHaveBeenCalled(), {
      timeout: AUTOSAVE_WAIT_MS,
    });
    expect(signedInOperations.saveFile).toHaveBeenLastCalledWith(
      filePath,
      expect.stringContaining("Signed-in edit"),
    );
  },
};

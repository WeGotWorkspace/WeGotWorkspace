import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import { driveLabels as L } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

/**
 * Signed-in users upload, drop files and create Markdown files. A guest on a
 * view link sees none of that. A guest on a folder link that allows adding
 * files (#1715) gets Upload files and the drop target through the upload
 * queue, but still no New folder and no new Markdown file (#1712).
 */
const meta: Meta<typeof DriveWorkspace> = {
  title: "Features/Drive/UploadAccess",
  component: DriveWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof DriveWorkspace>;

const signedIn = createDriveAppBootstrap();

const guestData: DriveUIData = {
  ...signedIn.data,
  user: { ...signedIn.data.user, role: "guest" as DriveUIData["user"]["role"] },
};

/** Fires a file dragover on the main pane; returns false when the pane accepted the drop. */
function dragFileOver(canvasElement: HTMLElement): boolean {
  const pane = canvasElement.querySelector(".drive-main-pane");
  if (!pane) throw new Error("Drive main pane not rendered");
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(new File(["x"], "note.txt", { type: "text/plain" }));
  return pane.dispatchEvent(
    new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
  );
}

export const SignedInCanUpload: Story = {
  tags: ["vitest-ci"],
  args: {
    ...signedIn,
    onViewChange: STORY_NOOP,
    onOpenDocsFile: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    expect(canvas.getByLabelText(L.uploadFiles)).toBeInTheDocument();

    await userEvent.click(await canvas.findByRole("button", { name: L.newButtonMenu }));
    expect(await body.findByRole("menuitem", { name: L.uploadFiles })).toBeInTheDocument();
    expect(body.getByRole("menuitem", { name: L.newMarkdown })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    expect(dragFileOver(canvasElement)).toBe(false);
    await waitFor(() =>
      expect(canvas.getByText(L.dropUploadHint, { exact: false })).toBeInTheDocument(),
    );
  },
};

export const GuestHasNoUpload: Story = {
  tags: ["vitest-ci"],
  args: {
    ...signedIn,
    data: guestData,
    onViewChange: STORY_NOOP,
    onOpenDocsFile: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    // No New menu at all: guests cannot create folders either (#1712).
    await canvas.findAllByRole("button", { name: "More actions" });
    expect(canvas.queryByRole("button", { name: L.newFolder })).toBeNull();
    expect(canvas.queryByRole("button", { name: L.newButtonMenu })).toBeNull();
    expect(body.queryByRole("menuitem", { name: L.uploadFiles })).toBeNull();
    expect(body.queryByRole("menuitem", { name: L.newMarkdown })).toBeNull();
    expect(canvas.queryByLabelText(L.uploadFiles)).toBeNull();

    // The pane cancels the dragover (so the browser keeps the page) but shows no overlay.
    expect(dragFileOver(canvasElement)).toBe(false);
    expect(canvas.queryByText(L.dropUploadHint, { exact: false })).toBeNull();
  },
};

/** The guest Drive with the upload queue: what a guest on an edit link gets. */
const guestUploadOperations = {
  refreshState: async () => guestData,
  changeDir: async () => guestData,
  listDirectory: async () => guestData,
  enqueueUploads: async () => ({ batchId: "story-batch", itemIds: [] }),
  releaseUploadBatch: async () => undefined,
} as unknown as DriveAPIOperations;

export const GuestOnAddFilesLinkCanUpload: Story = {
  tags: ["vitest-ci"],
  args: {
    ...signedIn,
    data: guestData,
    operations: guestUploadOperations,
    onViewChange: STORY_NOOP,
    onOpenDocsFile: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    // Upload is the only action: no New folder, no menu, no new Markdown file.
    expect(await canvas.findByRole("button", { name: L.uploadFiles })).toBeInTheDocument();
    expect(canvasElement.querySelector("input[type=file]")).not.toBeNull();
    expect(canvas.queryByRole("button", { name: L.newFolder })).toBeNull();
    expect(canvas.queryByRole("button", { name: L.newButtonMenu })).toBeNull();
    expect(body.queryByRole("menuitem", { name: L.newMarkdown })).toBeNull();

    expect(dragFileOver(canvasElement)).toBe(false);
    await waitFor(() =>
      expect(canvas.getByText(L.dropUploadHint, { exact: false })).toBeInTheDocument(),
    );
  },
};

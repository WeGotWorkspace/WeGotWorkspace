import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import { driveLabels as L } from "@/drive-core/src/drive-labels";
import type { DriveUIData } from "@/drive-core/src/drive-types";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

/**
 * Guests have no write path for folders and files yet (#1712). Until they do,
 * a guest in a shared folder sees no New folder, Rename, Move or Delete — not
 * in the sidebar, the item menu, the selection bar or the detail panel — and
 * cannot delete by keyboard or move by dragging. Download stays.
 */
const meta: Meta<typeof DriveWorkspace> = {
  title: "Features/Drive/StructureAccess",
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

const FILE_TITLE = "Autumn Issue — Final Proofs.pdf";

/**
 * On a busy CI runner the file list can be off screen for more than Testing
 * Library's 1 s default: before the first render, and again between steps.
 * Wait longer for the tile.
 */
const LISTING_TIMEOUT = { timeout: 15_000 };

/** Fires a dragstart on an item; returns false when the item cancelled the drag. */
function dragItem(canvasElement: HTMLElement, title: string): boolean {
  const item = within(canvasElement).getAllByLabelText(title)[0]?.closest("[draggable]");
  if (!item) throw new Error(`No draggable item for ${title}`);
  return item.dispatchEvent(
    new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    }),
  );
}

async function openItemMenu(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const tile = (await canvas.findAllByLabelText(FILE_TITLE, {}, LISTING_TIMEOUT))[0]!.closest(
    "[draggable]",
  );
  if (!(tile instanceof HTMLElement)) throw new Error(`No tile for ${FILE_TITLE}`);
  await userEvent.click(within(tile).getByRole("button", { name: "More actions" }));
  return within(document.body).findByRole("menu");
}

/** Selects the file and returns the floating selection bar. */
async function selectFile(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const tile = (await canvas.findAllByLabelText(FILE_TITLE, {}, LISTING_TIMEOUT))[0]!;
  await userEvent.pointer({ keys: "[MouseRight]", target: tile });
  return waitFor(() => {
    const bar = canvasElement.querySelector<HTMLElement>(".drive-selection-bar");
    expect(bar).not.toBeNull();
    return bar!;
  });
}

export const SignedInManagesStructure: Story = {
  tags: ["vitest-ci"],
  args: {
    ...signedIn,
    onViewChange: STORY_NOOP,
    onOpenDocsFile: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    await canvas.findAllByLabelText(FILE_TITLE, {}, LISTING_TIMEOUT);
    expect(await canvas.findByRole("button", { name: L.newFolder })).toBeInTheDocument();

    const menu = await openItemMenu(canvasElement);
    for (const name of [L.detailDownload, L.detailRename, L.detailMove, L.detailDelete]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    await userEvent.keyboard("{Escape}");

    expect(dragItem(canvasElement, FILE_TITLE)).toBe(true);

    const barScope = within(await selectFile(canvasElement));
    expect(barScope.getByRole("button", { name: L.selectionMove })).toBeInTheDocument();
    expect(barScope.getByRole("button", { name: L.selectionMoveToTrash })).toBeInTheDocument();

    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Backspace}");
    expect(await body.findByRole("alertdialog")).toBeInTheDocument();
  },
};

export const GuestHasNoStructureActions: Story = {
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

    await canvas.findAllByLabelText(FILE_TITLE, {}, LISTING_TIMEOUT);
    expect(canvas.queryByRole("button", { name: L.newFolder })).toBeNull();
    expect(canvas.queryByRole("button", { name: L.newButtonMenu })).toBeNull();

    const menu = await openItemMenu(canvasElement);
    expect(within(menu).getByRole("menuitem", { name: L.detailDownload })).toBeInTheDocument();
    for (const name of [L.detailRename, L.detailMove, L.detailDelete]) {
      expect(within(menu).queryByRole("menuitem", { name })).toBeNull();
    }
    await userEvent.keyboard("{Escape}");

    // The item cancels the drag, so nothing can be dropped on a folder.
    expect(dragItem(canvasElement, FILE_TITLE)).toBe(false);

    const barScope = within(await selectFile(canvasElement));
    expect(barScope.queryByRole("button", { name: L.selectionMove })).toBeNull();
    expect(barScope.queryByRole("button", { name: L.selectionMoveToTrash })).toBeNull();

    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Backspace}");
    expect(body.queryByRole("alertdialog")).toBeNull();
  },
};

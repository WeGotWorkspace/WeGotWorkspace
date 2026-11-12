import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, within } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { WeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-logout";

/**
 * The sign-out screen's warnings. With files still in the Drive upload queue
 * (#1522) it asks first: *Wait* opens the Uploads view, *Sign out anyway*
 * signs out and drops the files from this device.
 */
const meta = {
  title: "Features/WeGotWorkspace/SignOutWarning",
  component: WeGotWorkspaceLogout,
  parameters: { layout: "fullscreen" },
  args: {
    countUnsyncedChanges: async () => 0,
    isGuestSession: () => false,
    isOnline: () => true,
    completeLogout: fn(async () => "member_login" as const),
  },
} satisfies Meta<typeof WeGotWorkspaceLogout>;

export default meta;
type Story = StoryObj<typeof meta>;

const uploadsWaiting: Story = {
  args: { countQueuedUploads: async () => 3 },
  play: async ({ args }) => {
    const dialog = await screen.findByRole("alertdialog", { name: "Uploads are not finished" });
    const body = within(dialog);
    await expect(
      body.getByText(
        "3 files are still waiting to upload. Signing out removes them from this device, so they are not uploaded.",
      ),
    ).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Wait" })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Sign out anyway" })).toBeInTheDocument();
    await expect(args.completeLogout).not.toHaveBeenCalled();
  },
};

export const UploadsWaiting: Story = {
  ...uploadsWaiting,
  name: "Uploads still waiting",
  tags: ["vitest-ci"],
};

export const UploadsWaitingDark: Story = {
  ...uploadsWaiting,
  name: "Uploads still waiting (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
};

export const UploadsAndUnsynced: Story = {
  name: "Uploads waiting and unsynced changes",
  tags: ["vitest-ci"],
  args: { countQueuedUploads: async () => 1, countUnsyncedChanges: async () => 2 },
  play: async () => {
    const dialog = await screen.findByRole("alertdialog", { name: "Uploads are not finished" });
    await expect(
      within(dialog).getByText(/1 file is still waiting to upload\..*2 unsynced changes/),
    ).toBeInTheDocument();
  },
};

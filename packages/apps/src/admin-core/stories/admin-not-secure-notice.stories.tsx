import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { withDarkTheme } from "@/branding-playground";
import { adminCopy } from "@/admin-core/src/admin-copy";
import { AdminNotSecureNotice } from "@/admin-core/src/admin-not-secure-notice";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const meta = {
  title: "Features/Admin/Not secure notice",
  component: AdminNotSecureNotice,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <AdminStoryScope>
        <Story />
      </AdminStoryScope>
    ),
  ],
  args: { secureContext: false },
} satisfies Meta<typeof AdminNotSecureNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNotice(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(adminCopy.notSecureTitle)).toBeInTheDocument();
  await expect(canvas.getByText(adminCopy.notSecureMessage)).toBeInTheDocument();
  // Persistent: nothing to dismiss it with.
  await expect(canvas.queryByRole("button")).toBeNull();
}

/** Admin open over http (not localhost): the notice stays until the site is on https. */
export const OverHttp: Story = {
  name: "Over http",
  play: async ({ canvasElement }) => {
    await expectNotice(canvasElement);
    await expect(document.documentElement.dataset.theme).not.toBe("dark");
  },
};

export const OverHttpDark: Story = {
  name: "Over http (dark theme)",
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    await expectNotice(canvasElement);
    await expect(document.documentElement.dataset.theme).toBe("dark");
  },
};

/** https or localhost: no notice. */
export const Secure: Story = {
  args: { secureContext: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(adminCopy.notSecureTitle)).toBeNull();
  },
};

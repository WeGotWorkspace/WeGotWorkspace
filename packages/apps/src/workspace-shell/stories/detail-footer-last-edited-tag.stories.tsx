import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { detailFooterLastEditedTag } from "@/workspace-shell/src/detail-footer-last-edited-tag";
import { WorkspaceDetailFooter } from "@/workspace-shell/src/workspace-detail-footer";

/**
 * Mock-tier coverage for DetailFooterLastEditedTag (shared Notes/Docs footer chip).
 */
const meta = {
  title: "Shared/Detail Footer Last Edited Tag",
  parameters: {
    layout: "padded",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <WorkspaceDetailFooter
      tags={detailFooterLastEditedTag({
        lastEdited: "10 Aug 2026, 14:00",
        editedLabel: "Last edited",
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Last edited")).toBeInTheDocument();
    await expect(canvas.getByText("10 Aug 2026, 14:00")).toBeInTheDocument();
  },
};

export const Busy: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <WorkspaceDetailFooter
      tags={detailFooterLastEditedTag({
        lastEdited: "10 Aug 2026, 14:00",
        editedLabel: "Last edited",
        busy: true,
        busyLabel: "Unsaved changes",
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status", { name: "Unsaved changes" })).toBeInTheDocument();
  },
};

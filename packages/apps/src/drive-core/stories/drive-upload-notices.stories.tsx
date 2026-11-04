import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DriveUploadNotices } from "@/drive-core/src/drive-upload-notices";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";

const REPLACE_FELL_BACK = {
  id: "batch-replace",
  notices: [
    { type: "replace_fell_back" as const, itemName: "report.pdf", keptAsName: "report (1).pdf" },
  ],
};

const KEPT_BOTH = {
  id: "batch-kept",
  notices: [{ type: "kept_both" as const, itemName: "budget.xlsx", keptAsName: "budget (2).xlsx" }],
};

const meta = {
  title: "Features/Drive/UploadNotices",
  component: DriveUploadNotices,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <DriveStoryScope>
        <Story />
      </DriveStoryScope>
    ),
  ],
  args: { batches: [REPLACE_FELL_BACK], onDismiss: fn() },
} satisfies Meta<typeof DriveUploadNotices>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReplaceFellBack: Story = {
  play: async ({ canvasElement, args }) => {
    const region = within(canvasElement).getByRole("region", { name: "Upload notices" });
    await expect(
      within(region).getByText(
        "report.pdf was changed by someone else in the meantime. Your version was added as report (1).pdf.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(region).getByRole("button", { name: "OK" }));
    await expect(args.onDismiss).toHaveBeenCalledWith("batch-replace");
  },
};

export const ReplaceFellBackDark: Story = {
  name: "Replace fell back (dark)",
  decorators: [withDarkTheme],
};

export const KeptBoth: Story = {
  args: { batches: [KEPT_BOTH] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        "budget.xlsx already existed when it was uploaded. Your file was added as budget (2).xlsx.",
      ),
    ).toBeInTheDocument();
  },
};

export const KeptBothDark: Story = {
  name: "Kept both (dark)",
  args: { batches: [KEPT_BOTH] },
  decorators: [withDarkTheme],
};

export const SeveralInOneBatch: Story = {
  args: {
    batches: [{ id: "batch-many", notices: [...REPLACE_FELL_BACK.notices, ...KEPT_BOTH.notices] }],
  },
};

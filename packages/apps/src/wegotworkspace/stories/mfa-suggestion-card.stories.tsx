import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MfaSuggestionCard } from "@/wegotworkspace/src/mfa-suggestion-card";

const meta = {
  title: "Features/Workspace/Two-factor suggestion",
  component: MfaSuggestionCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof MfaSuggestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Suggest: Story = {
  tags: ["vitest-ci"],
  args: {
    account: {
      enabled: false,
      required: false,
      recoveryCodesRemaining: 0,
      suggest: true,
    },
    onEnable: () => undefined,
    onLater: () => undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("complementary", { name: "Two-factor suggestion" }),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Set up" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Later" })).toBeVisible();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ComposerSendButton } from "@/button/src/composer-send-button";

const meta = {
  title: "Chat/Composer Send Button",
  component: ComposerSendButton,
  args: { onClick: fn() },
} satisfies Meta<typeof ComposerSendButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Meet, Tasks and Docs composers all submit with this ghost icon button. */
export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Send" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Disabled: Story = { args: { disabled: true } };

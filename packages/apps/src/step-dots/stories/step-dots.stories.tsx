import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { StepDots } from "@/step-dots/src/step-dots";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";

const STEPS = ["space", "conflicts", "keepOffline"] as const;
const LABELS = { space: "Server space", conflicts: "Name conflicts", keepOffline: "Keep offline" };

const meta = {
  title: "UI/Primitives/StepDots",
  component: StepDots<(typeof STEPS)[number]>,
  tags: ["vitest-ci"],
  args: {
    steps: STEPS,
    current: "conflicts",
    label: "Upload steps",
    describeStep: (step, { number, total }) => `Step ${number} of ${total}: ${LABELS[step]}`,
  },
  argTypes: {
    current: { control: "select", options: STEPS },
    steps: { control: false },
    describeStep: { control: false },
  },
} satisfies Meta<typeof StepDots<(typeof STEPS)[number]>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SecondOfThree: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole("list", { name: "Upload steps" });
    await expect(within(list).getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Step 2 of 3: Name conflicts",
    );
  },
};

export const FirstStep: Story = { args: { current: "space" } };

export const LastStep: Story = { args: { current: "keepOffline" } };

export const SecondOfThreeDark: Story = {
  name: "Second of three (dark)",
  decorators: [withDarkTheme],
};

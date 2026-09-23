import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";

const meta = {
  title: "UI/Primitives/Loading Spinner",
  component: LoadingSpinner,
  tags: ["vitest-ci"],
  parameters: { layout: "padded" },
  argTypes: {
    size: { control: "radio", options: ["sm", "lg"] },
    label: { control: "text" },
    className: { control: false },
  },
} satisfies Meta<typeof LoadingSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const WithLabel: Story = {
  args: { size: "lg", label: "Loading messages…" },
};

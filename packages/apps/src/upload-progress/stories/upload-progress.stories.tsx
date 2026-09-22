import type { Meta, StoryObj } from "@storybook/react-vite";
import { UploadProgress } from "@/upload-progress/src/upload-progress";

const meta = {
  title: "UI/Patterns/Upload Progress",
  component: UploadProgress,
  tags: ["autodocs"],
  argTypes: {
    percent: { control: { type: "range", min: 0, max: 100, step: 1 } },
    done: { control: "boolean" },
  },
} satisfies Meta<typeof UploadProgress>;

export default meta;
type Story = StoryObj<typeof UploadProgress>;

export const Uploading: Story = {
  args: {
    label: "Uploading 3 files",
    percent: 42,
    detail: "Autumn Issue — Final Proofs.pdf",
    done: false,
  },
};

export const Complete: Story = {
  args: {
    label: "Uploaded 3 files",
    percent: 100,
    detail: "Upload complete",
    done: true,
  },
};

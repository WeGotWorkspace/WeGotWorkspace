import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { NoteDetailEyebrow } from "@/note-detail-view/src/note-detail-eyebrow";
import "@/note-detail-view/src/note-detail-view.css";

/** The line above a detail title: the notebook in Notes, the address book in Contacts. */
const meta = {
  title: "Features/Notes/Note Detail Eyebrow",
  component: NoteDetailEyebrow,
  tags: ["autodocs", "vitest-ci"],
} satisfies Meta<typeof NoteDetailEyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithContent: Story = {
  args: { children: "The Journal" },
  play: async ({ canvasElement }) => {
    const eyebrow = canvasElement.querySelector(".note-detail-view__eyebrow");
    await expect(eyebrow).toHaveTextContent("The Journal");
  },
};

/** Empty: nothing renders, so the title moves up. */
export const Empty: Story = {
  args: { children: null },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".note-detail-view__eyebrow")).toBeNull();
  },
};

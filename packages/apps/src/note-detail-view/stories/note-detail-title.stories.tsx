import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NoteDetailTitle } from "@/note-detail-view/src/note-detail-title";
import "@/note-detail-view/src/note-detail-view.css";

/** The top of a detail (Notes, Tasks, Calendar): the collection, then a large title field. */
const meta = {
  title: "Features/Notes/Note Detail Title",
  component: NoteDetailTitle,
  tags: ["autodocs", "vitest-ci"],
  args: { value: "Groceries", placeholder: "Title", onChange: fn() },
} satisfies Meta<typeof NoteDetailTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
  play: async ({ canvasElement, args }) => {
    const field = within(canvasElement).getByRole("textbox", { name: "Title" });
    await userEvent.type(field, "!");
    await expect(args.onChange).toHaveBeenCalledWith("Groceries!");
  },
};

export const WithEyebrowAndLeading: Story = {
  args: {
    eyebrow: "Personal",
    leading: <input type="checkbox" aria-label="Done" />,
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".note-detail-view__eyebrow")).toHaveTextContent(
      "Personal",
    );
    await expect(within(canvasElement).getByRole("checkbox", { name: "Done" })).toBeTruthy();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("textbox", { name: "Title" })).toHaveAttribute(
      "readonly",
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SearchBar } from "@/search-bar/src/search-bar";

const meta = {
  title: "UI/Primitives/Search Bar",
  component: SearchBar,
  tags: ["autodocs", "vitest-ci"],
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof SearchBar>;

export const Empty: Story = {
  args: {
    placeholder: "Search…",
    value: "",
    onSearch: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText("Search…");
    await userEvent.click(input);
    await userEvent.type(input, "proofs");
    await expect(input).toHaveValue("proofs");
  },
};

export const WithQuery: Story = {
  name: "With query",
  args: {
    placeholder: "Search in Drive…",
    value: "proofs",
    onSearch: () => {},
  },
};

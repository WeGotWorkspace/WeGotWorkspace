import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const meta = {
  title: "Shared/Input",
  component: Input,
  tags: ["autodocs", "vitest-ci"],
  argTypes: {
    size: { control: "radio", options: ["sm", "md"] },
    variant: { control: "radio", options: ["default", "search"] },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: "Title",
    "aria-label": "Title",
  },
};

function SearchPlayHarness() {
  const [query, setQuery] = React.useState("");
  return (
    <Input
      variant="search"
      size="sm"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Search…"
      aria-label="Search…"
    />
  );
}

export const Search: Story = {
  render: () => <SearchPlayHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("searchbox");
    await userEvent.click(input);
    await userEvent.type(input, "standup");
    await expect(input).toHaveValue("standup");
    await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
    await expect(input).toHaveValue("");
  },
};

export const SearchWithValue: Story = {
  name: "Search with value",
  args: {
    variant: "search",
    size: "sm",
    placeholder: "Search…",
    "aria-label": "Search…",
    defaultValue: "client call",
  },
};

export const SameSizePair: Story = {
  name: "Same-size Input and Select",
  render: () => (
    <div className="flex flex-col gap-4">
      {(["sm", "md"] as const).map((size) => (
        <div key={size} className="flex items-end gap-2">
          <Input size={size} aria-label={`${size} input`} defaultValue={`${size} input`} />
          <Select defaultValue="option">
            <SelectTrigger size={size} aria-label={`${size} select`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option">{size} select</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "sm input" })).toHaveClass("input--size-sm");
    await expect(canvas.getByRole("combobox", { name: "sm select" })).toHaveClass(
      "select-trigger--size-sm",
    );
    await expect(canvas.getByRole("textbox", { name: "md input" })).not.toHaveClass(
      "input--size-sm",
    );
    await expect(canvas.getByRole("combobox", { name: "md select" })).not.toHaveClass(
      "select-trigger--size-sm",
    );
  },
};

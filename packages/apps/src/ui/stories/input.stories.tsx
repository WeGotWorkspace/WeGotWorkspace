import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { CONTROL_SIZE_OPTIONS } from "@/ui/control-size";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const SIZE_PX: Record<(typeof CONTROL_SIZE_OPTIONS)[number], number> = {
  xs: 28,
  sm: 32,
  md: 36,
  lg: 40,
  xl: 44,
};

const meta = {
  title: "UI/Primitives/Input",
  component: Input,
  tags: ["autodocs", "vitest-ci"],
  argTypes: {
    size: { control: "radio", options: [...CONTROL_SIZE_OPTIONS] },
    variant: { control: "radio", options: ["default", "search", "password"] },
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
      size="md"
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

function PasswordPlayHarness() {
  const [secret, setSecret] = React.useState("");
  return (
    <Input
      variant="password"
      size="md"
      value={secret}
      onChange={(event) => setSecret(event.target.value)}
      placeholder="At least 10 characters"
      aria-label="Password"
      autoComplete="new-password"
    />
  );
}

export const Password: Story = {
  render: () => <PasswordPlayHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Password") as HTMLInputElement;
    await userEvent.type(input, "hunter2hunter");
    await expect(input).toHaveValue("hunter2hunter");
    await expect(input).toHaveAttribute("type", "password");
    await userEvent.click(canvas.getByRole("button", { name: "Show password" }));
    await expect(input).toHaveAttribute("type", "text");
    await userEvent.click(canvas.getByRole("button", { name: "Hide password" }));
    await expect(input).toHaveAttribute("type", "password");
  },
};

export const PasswordVisible: Story = {
  name: "Password (toggle)",
  args: {
    variant: "password",
    size: "md",
    placeholder: "At least 10 characters",
    "aria-label": "Password",
    defaultValue: "hunter2hunter",
    autoComplete: "new-password",
  },
};

export const SearchWithValue: Story = {
  name: "Search with value",
  args: {
    variant: "search",
    size: "md",
    placeholder: "Search…",
    "aria-label": "Search…",
    defaultValue: "client call",
  },
};

export const AllSizes: Story = {
  name: "Sizes (xs–xl)",
  render: () => (
    <div className="flex flex-col gap-4">
      {CONTROL_SIZE_OPTIONS.map((size) => (
        <div key={size} className="flex items-end gap-2">
          <Input
            size={size}
            aria-label={`${size} input (${SIZE_PX[size]}px)`}
            defaultValue={`${size} · ${SIZE_PX[size]}px`}
          />
          <Select defaultValue="option">
            <SelectTrigger size={size} aria-label={`${size} select (${SIZE_PX[size]}px)`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option">
                {size} · {SIZE_PX[size]}px
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const size of CONTROL_SIZE_OPTIONS) {
      await expect(
        canvas.getByRole("textbox", { name: `${size} input (${SIZE_PX[size]}px)` }),
      ).toHaveClass(`input--size-${size}`);
      await expect(
        canvas.getByRole("combobox", { name: `${size} select (${SIZE_PX[size]}px)` }),
      ).toHaveClass(`select-trigger--size-${size}`);
    }
  },
};

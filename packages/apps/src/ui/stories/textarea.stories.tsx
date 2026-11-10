import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Textarea } from "@/ui/textarea";

const meta = {
  title: "UI/Primitives/Textarea",
  component: Textarea,
  tags: ["autodocs", "vitest-ci"],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    placeholder: "Notes",
    "aria-label": "Notes",
  },
};

function GhostPlayHarness() {
  const [value, setValue] = React.useState("");
  return (
    <Textarea
      size="sm"
      className="textarea--ghost"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder="Add notes"
      aria-label="Notes"
    />
  );
}

/** Ghost textarea (Contacts notes row): no chrome at rest, a quiet wash while typing. */
export const Ghost: Story = {
  render: () => <GhostPlayHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole("textbox", { name: "Notes" });
    await expect(textarea).toHaveClass("textarea--ghost");
    // Read the colours through waitFor so a late style pass cannot fail the check.
    await waitFor(() => {
      expect(getComputedStyle(textarea).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(textarea).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    });
    await userEvent.click(textarea);
    await userEvent.type(textarea, "Met at the conference");
    await expect(textarea).toHaveValue("Met at the conference");
    await waitFor(() => {
      expect(getComputedStyle(textarea).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    });
  },
};

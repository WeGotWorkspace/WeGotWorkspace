import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Smile } from "lucide-react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { IconButton } from "@/button/src/icon-button";
import { REACTION_EMOJIS, ReactionPicker } from "@/reaction-picker/src/reaction-picker";

function ReactionPickerDemo() {
  const [picked, setPicked] = useState<string[]>(["👍"]);
  return (
    <div className="flex items-center gap-3 p-16">
      <ReactionPicker
        side="bottom"
        trigger={<IconButton label="React" icon={<Smile />} size="sm" variant="ghost" />}
        isPicked={(emoji) => picked.includes(emoji)}
        onPick={(emoji) =>
          setPicked((current) =>
            current.includes(emoji) ? current.filter((row) => row !== emoji) : [...current, emoji],
          )
        }
      />
      <span data-testid="picked">{picked.join(" ")}</span>
    </div>
  );
}

const meta = {
  title: "UI/Patterns/Reaction Picker",
  component: ReactionPickerDemo,
} satisfies Meta<typeof ReactionPickerDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Chat messages and Docs comments: the floating toolbar with `lg` outline buttons. */
export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "React" }));
    const body = within(canvasElement.ownerDocument.body);
    const picker = await waitFor(() => {
      const element = canvasElement.ownerDocument.querySelector<HTMLElement>(".reaction-picker");
      if (!element) throw new Error("no picker yet");
      return element;
    });
    await expect(picker.classList).toContain("popover-ui--frost");
    await expect(getComputedStyle(picker).paddingTop).toBe("6px");
    const items = within(picker).getAllByRole("button");
    await expect(items).toHaveLength(REACTION_EMOJIS.length);
    for (const item of items) {
      await expect(item.classList).toContain("icon-button--size-lg");
    }
    await expect(body.getByRole("button", { name: "👍" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await userEvent.click(body.getByRole("button", { name: "🎉" }));
    await waitFor(() =>
      expect(canvasElement.ownerDocument.querySelector(".reaction-picker")).toBeNull(),
    );
    await expect(canvas.getByTestId("picked").textContent).toBe("👍 🎉");
  },
};

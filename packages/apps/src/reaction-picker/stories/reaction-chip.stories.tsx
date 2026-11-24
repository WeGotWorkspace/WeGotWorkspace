import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ReactionAddPicker, ReactionChip } from "@/reaction-picker/src/reaction-chip";

function ReactionChipDemo() {
  const [counts, setCounts] = useState<Record<string, number>>({ "👍": 2 });
  const [mine, setMine] = useState<string[]>([]);
  const toggle = (emoji: string) => {
    const reacted = mine.includes(emoji);
    setMine(reacted ? mine.filter((row) => row !== emoji) : [...mine, emoji]);
    setCounts({ ...counts, [emoji]: (counts[emoji] ?? 0) + (reacted ? -1 : 1) });
  };
  return (
    <div className="flex items-center gap-1.5 p-16">
      {Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([emoji, count]) => (
          <ReactionChip
            key={emoji}
            emoji={emoji}
            count={count}
            reacted={mine.includes(emoji)}
            onClick={() => toggle(emoji)}
          />
        ))}
      <ReactionAddPicker label="Add reaction" isPicked={(e) => mine.includes(e)} onPick={toggle} />
    </div>
  );
}

const meta = {
  title: "UI/Patterns/Reaction Chip",
  component: ReactionChipDemo,
} satisfies Meta<typeof ReactionChipDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one reaction look for Meet, Tasks and Docs: capsule chips plus the smile add button. */
export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByRole("button", { name: "2" });
    await expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
    await expect(chip.textContent).toContain("3");
    await expect(canvas.getByRole("button", { name: "Add reaction" })).toBeTruthy();
  },
};

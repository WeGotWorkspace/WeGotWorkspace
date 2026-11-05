import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Tag, TagGroup } from "../src/tag";

const meta: Meta<typeof TagGroup> = {
  title: "UI/Primitives/Tag Group",
  component: TagGroup,
};

export default meta;
type Story = StoryObj<typeof TagGroup>;

export const Readonly: Story = {
  args: {
    tags: ["ideas", "draft"],
    readonly: true,
  },
};

export const Editable: Story = {
  render: function EditableTagGroup() {
    const [tags, setTags] = useState(["ideas", "draft"]);
    return (
      <TagGroup
        tags={tags}
        readonly={false}
        suggestions={["ideas", "draft", "focus", "shipping", "research"]}
        onAddTag={(label) => {
          setTags((prev) => (prev.includes(label) ? prev : [...prev, label]));
        }}
        onRemoveTag={(label) => {
          setTags((prev) => prev.filter((tag) => tag !== label));
        }}
      />
    );
  },
};

export const Large: Story = {
  name: "Large (notes density)",
  render: function LargeTagGroup() {
    const [tags, setTags] = useState(["research", "ideas", "draft"]);
    return (
      <TagGroup
        size="lg"
        tags={tags}
        readonly={false}
        suggestions={["ideas", "draft", "focus", "shipping", "research"]}
        onAddTag={(label) => {
          setTags((prev) => (prev.includes(label) ? prev : [...prev, label]));
        }}
        onRemoveTag={(label) => {
          setTags((prev) => prev.filter((tag) => tag !== label));
        }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvasElement.querySelector(".tag-group") as HTMLElement;
    const chips = () => Array.from(group.querySelectorAll<HTMLElement>(".tag"));

    // Chips A–Z, then Add tag last: no border, no fill.
    await expect(chips().map((chip) => chip.textContent)).toEqual(["draft", "ideas", "research"]);
    const add = canvas.getByRole("button", { name: "Add tag" });
    await expect(group.lastElementChild?.contains(add)).toBe(true);
    await expect(getComputedStyle(add).borderTopWidth).toBe("0px");
    await expect(getComputedStyle(add).backgroundColor).toBe("rgba(0, 0, 0, 0)");

    // The text sits a fraction above the middle (optical centre), chip and Add alike.
    const label = chips()[0].querySelector(".tag__label") as HTMLElement;
    await expect(parseFloat(getComputedStyle(label).top)).toBeLessThan(0);
    await expect(getComputedStyle(label).top).toBe(
      getComputedStyle(add.querySelector("span") as HTMLElement).top,
    );

    // Opening the field and typing moves no chip.
    const before = chips().map((chip) => chip.getBoundingClientRect().left);
    await userEvent.click(add);
    await userEvent.keyboard("s");
    await expect(chips().map((chip) => chip.getBoundingClientRect().left)).toEqual(before);

    // Suggestions: frosted popover, A–Z, rows as tall as a menu item (36px).
    const popover = group.querySelector(".tag-group__popover") as HTMLElement;
    await expect(getComputedStyle(popover).backdropFilter).not.toBe("none");
    const options = Array.from(popover.querySelectorAll<HTMLElement>(".tag-group__suggestion"));
    const names = options
      .map((option) => option.textContent)
      .filter((name) => !/^Create/.test(name ?? ""));
    await expect(names).toEqual([...names].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
    await expect(options[0].getBoundingClientRect().height).toBe(36);
    await userEvent.keyboard("{Escape}");
  },
};

export const TagAtoms: Story = {
  name: "Tag (atoms)",
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Tag label="readonly" />
      <Tag label="editable" removable onRemove={() => {}} />
      <Tag size="lg" label="large" removable onRemove={() => {}} />
    </div>
  ),
};

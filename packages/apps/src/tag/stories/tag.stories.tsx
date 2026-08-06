import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Tag, TagGroup } from "../src/tag";

const meta: Meta<typeof TagGroup> = {
  title: "Shared/Tag Group",
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
    const [tags, setTags] = useState(["ideas", "draft"]);
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

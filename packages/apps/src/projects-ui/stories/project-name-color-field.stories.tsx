import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ProjectNameColorField } from "@/projects-ui/src/project-name-color-field";

const meta = {
  title: "Projects/Project Name Color Field",
  component: ProjectNameColorField,
  tags: ["autodocs"],
} satisfies Meta<typeof ProjectNameColorField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The name and color row the create and edit Project dialogs share. */
export const Default: Story = {
  args: {
    id: "project-name",
    name: "",
    color: "#3b82f6",
    onNameChange: () => {},
    onColorChange: () => {},
  },
  render: (args) => {
    const [name, setName] = useState("Launch");
    const [color, setColor] = useState(args.color);
    return (
      <ProjectNameColorField
        {...args}
        name={name}
        color={color}
        onNameChange={setName}
        onColorChange={setColor}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Website");
    await expect(input).toHaveValue("Website");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Mail, User } from "lucide-react";
import { Input } from "@/ui/input";
import { FormField } from "../src";

const meta: Meta<typeof FormField> = {
  title: "UI/Primitives/Form Field",
  component: FormField,
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const Readonly: Story = {
  args: {
    label: "Username",
    readOnly: true,
    htmlFor: "form-field-story-username",
    icon: <User className="size-3.5 opacity-70" />,
    children: (
      <Input
        id="form-field-story-username"
        value="elias.linden"
        readOnly
        className="cursor-default"
      />
    ),
  },
};

export const Editable: Story = {
  tags: ["vitest-ci"],
  args: {
    label: "Email",
    htmlFor: "form-field-story-email",
    icon: <Mail className="size-3.5 opacity-70" />,
    children: (
      <Input id="form-field-story-email" defaultValue="elias@northlight.studio" type="email" />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "agent@example.com");
    await expect(input).toHaveValue("agent@example.com");
  },
};

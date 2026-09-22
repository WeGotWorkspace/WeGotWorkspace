import type { Meta, StoryObj } from "@storybook/react-vite";
import { TypographySheet } from "../typography-sheet";

/**
 * Interactive typography token catalog. Live chrome stays under Themes.
 */
const meta = {
  title: "Foundations/Typography",
  component: TypographySheet,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Interactive catalog of font families, shared type-role utilities, Tailwind size steps, and font-medium / font-semibold. Values are read from computed CSS.",
      },
    },
  },
} satisfies Meta<typeof TypographySheet>;

export default meta;
type Story = StoryObj<typeof TypographySheet>;

export const Sheet: Story = {};

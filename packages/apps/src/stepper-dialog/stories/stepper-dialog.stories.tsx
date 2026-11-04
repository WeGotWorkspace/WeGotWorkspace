import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { StepperDialog, type StepperDialogStep } from "@/stepper-dialog/src/stepper-dialog";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";

const LABELS = {
  back: "Back",
  next: "Next",
  cancel: "Cancel",
  dots: "Steps",
  stepOf: (number: number, total: number, dot: string) => `Step ${number} of ${total}: ${dot}`,
};

const STEPS: StepperDialogStep[] = [
  { id: "one", title: "Choose a size", dotLabel: "Size", content: <p>Small, medium, or large.</p> },
  { id: "two", title: "Choose a colour", dotLabel: "Colour", content: <p>Any colour you like.</p> },
  {
    id: "three",
    title: "Check your order",
    dotLabel: "Check",
    content: <p>Everything looks right.</p>,
  },
];

const meta = {
  title: "UI/Patterns/StepperDialog",
  component: StepperDialog,
  tags: ["vitest-ci"],
  args: {
    open: true,
    steps: STEPS,
    labels: LABELS,
    finishLabel: "Order",
    onCancel: fn(),
    onFinish: fn(),
  },
  argTypes: { steps: { control: false }, labels: { control: false } },
} satisfies Meta<typeof StepperDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeSteps: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    const dialog = await body.findByRole("dialog", { name: "Choose a size" });
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Choose a size"));
    await expect(
      within(within(dialog).getByRole("list", { name: "Steps" })).getByRole("listitem", {
        current: "step",
      }),
    ).toHaveTextContent("Step 1 of 3: Size");
    await expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await body.findByRole("dialog", { name: "Choose a colour" });
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Choose a colour"));
    await userEvent.click(body.getByRole("button", { name: "Next" }));
    await userEvent.click(await body.findByRole("button", { name: "Order" }));
    await expect(args.onFinish).toHaveBeenCalledTimes(1);
  },
};

export const SingleStepHidesDots: Story = {
  args: { steps: [STEPS[0]!] },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Choose a size" });
    await expect(within(dialog).queryByRole("list", { name: "Steps" })).toBeNull();
    await expect(within(dialog).getByRole("button", { name: "Order" })).toBeInTheDocument();
  },
};

export const EscapeCancels: Story = {
  play: async ({ args }) => {
    await within(document.body).findByRole("dialog", { name: "Choose a size" });
    await userEvent.keyboard("{Escape}");
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
  },
};

export const ThreeStepsDark: Story = {
  name: "Three steps (dark)",
  decorators: [withDarkTheme],
  play: async () => {
    await within(document.body).findByRole("dialog", { name: "Choose a size" });
  },
};

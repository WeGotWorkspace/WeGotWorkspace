import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Bell, Mail, NotebookText, Phone, Trash2 } from "lucide-react";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { IconButton } from "@/button/src/button";
import {
  DetailFieldAddRow,
  DetailFieldList,
  DetailFieldRow,
} from "@/detail-field-row/src/detail-field-row";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";

/**
 * One field of an open item on the detail sheet (Tasks, Contacts): an icon, a fixed
 * label column, then the value. Every value starts on the same line.
 */
const meta = {
  title: "UI/Patterns/Detail Field Row",
  component: DetailFieldRow,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof DetailFieldRow>;

export default meta;
type Story = StoryObj<typeof meta>;

function DetailFieldsHarness({ onAdd, onRemove }: { onAdd: () => void; onRemove: () => void }) {
  const [email, setEmail] = useState("ada@example.com");
  const [reminders, setReminders] = useState(true);
  return (
    <div className="max-w-xl" style={{ background: "var(--workspace-surface)" }}>
      <DetailFieldList>
        <DetailFieldRow icon={<Phone />} title="Mobile">
          <Input variant="ghost" aria-label="Phone" defaultValue="+31 6 1234 5678" />
        </DetailFieldRow>
        <DetailFieldRow
          icon={<Mail />}
          title="Email"
          trailing={
            <IconButton
              label="Remove"
              icon={<Trash2 aria-hidden />}
              variant="ghost"
              severity="danger"
              size="sm"
              onClick={onRemove}
            />
          }
        >
          <Input
            variant="ghost"
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </DetailFieldRow>
        <DetailFieldAddRow label="Add email" onAdd={onAdd} />
        <DetailFieldRow icon={<Bell />} title="Reminders" center>
          <Switch aria-label="Reminders" checked={reminders} onCheckedChange={setReminders} />
        </DetailFieldRow>
        <DetailFieldRow icon={<NotebookText />} title="Notes" stacked>
          <Input variant="ghost" aria-label="Notes" defaultValue="Met at the spring meetup." />
        </DetailFieldRow>
      </DetailFieldList>
    </div>
  );
}

async function playDetailFields(
  canvasElement: HTMLElement,
  args: { onAdd: () => void; onRemove: () => void },
) {
  const canvas = within(canvasElement);
  // The label column has one width, so every value starts on the same line.
  const phone = canvas.getByRole("textbox", { name: "Phone" });
  const email = canvas.getByRole("textbox", { name: "Email" });
  await expect(
    Math.abs(phone.getBoundingClientRect().left - email.getBoundingClientRect().left),
  ).toBeLessThan(1);
  // A stacked value sits under its label, not beside it.
  const notes = canvas.getByRole("textbox", { name: "Notes" });
  const notesLabel = canvas.getByText("Notes");
  await expect(notes.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    notesLabel.getBoundingClientRect().bottom,
  );
  // The value is a plain ghost field: typing edits it.
  await userEvent.clear(email);
  await userEvent.type(email, "ada@work.example");
  await expect(email).toHaveValue("ada@work.example");
  await userEvent.click(canvas.getByRole("switch", { name: "Reminders" }));
  await expect(canvas.getByRole("switch", { name: "Reminders" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await userEvent.click(canvas.getByRole("button", { name: "Remove" }));
  await expect(args.onRemove).toHaveBeenCalledTimes(1);
  await userEvent.click(canvas.getByRole("button", { name: "Add email" }));
  await expect(args.onAdd).toHaveBeenCalledTimes(1);
}

export const Fields: StoryObj<typeof DetailFieldsHarness> = {
  tags: ["vitest-ci"],
  render: (args) => <DetailFieldsHarness {...args} />,
  args: { onAdd: fn(), onRemove: fn() },
  play: async ({ canvasElement, args }) => {
    await playDetailFields(canvasElement, args);
  },
};

export const FieldsDark: StoryObj<typeof DetailFieldsHarness> = {
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: (args) => <DetailFieldsHarness {...args} />,
  args: { onAdd: fn(), onRemove: fn() },
  play: async ({ canvasElement, args }) => {
    await playDetailFields(canvasElement, args);
  },
};

export const Single: Story = {
  args: {
    icon: <Phone />,
    title: "Mobile",
    children: <Input variant="ghost" aria-label="Phone" defaultValue="+31 6 1234 5678" />,
  },
};

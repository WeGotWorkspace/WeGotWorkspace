import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eraser, Globe2, RefreshCw } from "lucide-react";
import { Input } from "@/ui/input";
import { Button } from "@/button/src/button";
import { Card } from "../src/card";
import { CardPanel, CardRowDivider } from "../src/card-panel";
import { CardRow } from "../src/card-row";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";

const meta: Meta<typeof Card> = {
  title: "Shared/Card",
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const ReadonlySummary: Story = {
  render: () => (
    <Card title="Readonly">
      <FormField label="Username" readOnly>
        <Input value="elias.linden" readOnly className="cursor-default" />
      </FormField>
      <FormField label="Email" readOnly>
        <Input value="elias@northlight.studio" readOnly className="cursor-default" />
      </FormField>
    </Card>
  ),
};

export const EditableFormLike: Story = {
  render: () => (
    <Card title="Identity">
      <FormField label="Display name">
        <Input defaultValue="Elias Linden" />
      </FormField>
      <FormField label="Email">
        <Input defaultValue="elias@northlight.studio" type="email" />
      </FormField>
      <div className="flex justify-end pt-2">
        <Button
          label="Save"
          variant="subtle"
          style={{ backgroundColor: "#949dad", color: "var(--color-ink)" }}
        />
      </div>
    </Card>
  ),
};

export const WithHeaderIconActions: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <Card
      title="Update log"
      iconActions={[
        {
          label: "Refresh",
          icon: <RefreshCw className="size-4" />,
          onClick: () => {},
        },
        {
          label: "Clear",
          icon: <Eraser className="size-4" />,
          onClick: () => {},
        },
      ]}
    >
      <p className="text-sm opacity-80">Card header supports one or more icon actions.</p>
    </Card>
  ),
};

export const WithTitleIconAndDescription: Story = {
  render: () => (
    <Card
      titleIcon={<Globe2 className="size-4" />}
      title="Anyone with the link"
      description="No sign-in required — anyone with the URL can view this doc."
    >
      <FormField label="Share URL" readOnly>
        <Input value="https://example.com/s/abc123" readOnly className="cursor-default" />
      </FormField>
    </Card>
  ),
};

/** Inner panel + rows used by share dialogs and the calendar event editor. */
export const WithPanelRows: Story = {
  render: () => (
    <Card titleIcon={<Globe2 className="size-4" />} title="When">
      <CardPanel>
        <CardRow title="All day">
          <Button label="On" variant="subtle" />
        </CardRow>
        <CardRow title="Starts">
          <Button label="17 Aug" variant="outline" />
        </CardRow>
        <CardRowDivider />
        <CardRow title="Time zone" subtitle="Used for timed events">
          <Button label="UTC" variant="outline" />
        </CardRow>
      </CardPanel>
    </Card>
  ),
};

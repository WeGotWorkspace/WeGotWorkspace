import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function EmailDeliveryHarness({
  override,
}: {
  override?: Parameters<typeof useAdminPaneStoryController>[0];
}) {
  const controller = useAdminPaneStoryController(override);
  return (
    <AdminStoryScope>
      <AdminEmailDeliveryPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Apps/Admin/Panes/Email delivery",
  component: AdminEmailDeliveryPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminEmailDeliveryPane>;

export default meta;
type Story = StoryObj<typeof AdminEmailDeliveryPane>;

export const CapabilityOkTestNull: Story = {
  name: "capability-ok / test-null",
  tags: ["vitest-ci"],
  render: () => (
    <EmailDeliveryHarness
      override={{
        mailDelivery: {
          capability: {
            canSubmit: true,
            selectedTransport: "smtp",
            probes: { fromConfigured: true, smtpEligible: true },
          },
          lastTestSend: null,
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fromInput = canvas.getByLabelText("From address");
    await userEvent.clear(fromInput);
    await userEvent.type(fromInput, "noreply@example.test");
    await expect(fromInput).toHaveValue("noreply@example.test");
  },
};

export const TestAccepted: Story = {
  name: "test-accepted",
  render: () => (
    <EmailDeliveryHarness
      override={{
        mailDelivery: {
          capability: {
            canSubmit: true,
            selectedTransport: "php",
            probes: { fromConfigured: true },
          },
          lastTestSend: {
            accepted: true,
            status: "accepted_by_transport",
            transport: "php",
            at: "2026-08-18T12:00:00+00:00",
            message: null,
          },
        },
      }}
    />
  ),
};

export const TestFailed: Story = {
  name: "test-failed",
  render: () => (
    <EmailDeliveryHarness
      override={{
        mailDelivery: {
          capability: {
            canSubmit: true,
            selectedTransport: "smtp",
            probes: { fromConfigured: true, smtpEligible: true },
          },
          lastTestSend: {
            accepted: false,
            status: "timeout",
            transport: "smtp",
            at: "2026-08-18T12:05:00+00:00",
            message: "Connection timed out after 10 seconds.",
          },
        },
      }}
    />
  ),
};

export const CannotSubmit: Story = {
  name: "cannot-submit",
  render: () => (
    <EmailDeliveryHarness
      override={{
        mailDelivery: {
          config: {
            from: "",
            transport: "auto",
            smtpHost: "smtp.example.test",
            smtpPort: 587,
            smtpSecurity: "starttls",
            smtpUsername: "",
            smtpPasswordSet: false,
          },
          capability: {
            canSubmit: false,
            selectedTransport: "php",
            probes: { fromConfigured: false, smtpEligible: false },
          },
          lastTestSend: null,
        },
      }}
    />
  ),
};

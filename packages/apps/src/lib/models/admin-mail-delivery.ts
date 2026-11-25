import type {
  AdminMailDeliveryCapability,
  AdminMailDeliveryConfig,
  AdminMailDeliveryLastTestSend,
  AdminMailDeliveryState,
} from "@/lib/models/admin-types";

/** Matches `MailDeliveryConfig::PLACEHOLDER_FROM` when Admin has not saved a From. */
export const MAIL_DELIVERY_PLACEHOLDER_FROM = "noreply@localhost";

export function defaultMailDeliveryConfig(): AdminMailDeliveryConfig {
  return {
    from: "",
    transport: "auto",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls",
    smtpUsername: "",
    smtpPasswordSet: false,
  };
}

export function defaultMailDeliveryCapability(): AdminMailDeliveryCapability {
  return {
    canSubmit: false,
    selectedTransport: null,
    probes: {
      fromConfigured: false,
      smtpEligible: false,
      smtpAuthRequired: true,
      phpMailAvailable: true,
      sendmailAvailable: false,
    },
  };
}

export function defaultMailDeliveryState(
  override?: Partial<AdminMailDeliveryState> & {
    config?: Partial<AdminMailDeliveryConfig>;
    capability?: Partial<AdminMailDeliveryCapability> & {
      probes?: Partial<AdminMailDeliveryCapability["probes"]>;
    };
    lastTestSend?: AdminMailDeliveryLastTestSend | null;
  },
): AdminMailDeliveryState {
  const baseCapability = defaultMailDeliveryCapability();
  return {
    config: { ...defaultMailDeliveryConfig(), ...override?.config },
    capability: {
      ...baseCapability,
      ...override?.capability,
      probes: { ...baseCapability.probes, ...override?.capability?.probes },
    },
    lastTestSend: override?.lastTestSend === undefined ? null : override.lastTestSend,
  };
}

export function lastTestSendLabel(result: AdminMailDeliveryLastTestSend | null): string {
  if (!result) {
    return "No test sent yet. Accepted means the server took it, not that it arrived.";
  }
  if (result.accepted) {
    return `Accepted by the ${result.transport || "selected"} transport. Not a delivery guarantee.`;
  }
  return `Last test send was not accepted (${result.status}${result.transport ? `, ${result.transport}` : ""}).`;
}

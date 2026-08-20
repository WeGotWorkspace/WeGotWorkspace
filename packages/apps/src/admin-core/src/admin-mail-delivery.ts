import type {
  AdminMailDeliveryCapability,
  AdminMailDeliveryConfig,
  AdminMailDeliveryLastTestSend,
  AdminMailDeliveryState,
} from "@/admin-core/src/admin-types";

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
    return "No test send yet. A successful test means the transport accepted the message, not that it reached an inbox.";
  }
  if (result.accepted) {
    return `Last test send was accepted by the ${result.transport || "selected"} transport. This does not confirm inbox placement.`;
  }
  return `Last test send was not accepted (${result.status}${result.transport ? `, ${result.transport}` : ""}).`;
}

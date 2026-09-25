import type { AdminMailDeliveryLastTestSend } from "@/admin-core/src/admin-types";

export type MailTestRecipient =
  | { ok: true; recipient: string }
  | { ok: false; message: "A recipient email is required" };

export type MailTestSendFeedback =
  | { kind: "success"; message: "Test send accepted by the transport (not inbox placement)" }
  | { kind: "error"; message: string };

export function normalizeMailTestRecipient(to: string): MailTestRecipient {
  const recipient = to.trim();
  if (!recipient.includes("@")) {
    return { ok: false, message: "A recipient email is required" };
  }
  return { ok: true, recipient };
}

export function mailTestSendFeedback(
  last: AdminMailDeliveryLastTestSend | null | undefined,
): MailTestSendFeedback {
  if (last?.accepted) {
    return {
      kind: "success",
      message: "Test send accepted by the transport (not inbox placement)",
    };
  }
  return {
    kind: "error",
    message: last?.message || `Test send failed (${last?.status ?? "unavailable"})`,
  };
}

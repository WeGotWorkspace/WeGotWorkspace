import { describe, expect, it } from "vitest";
import {
  defaultMailDeliveryCapability,
  defaultMailDeliveryConfig,
  defaultMailDeliveryState,
  lastTestSendLabel,
} from "@/lib/models/admin-mail-delivery";

describe("admin-mail-delivery", () => {
  it("defaults describe an unconfigured install", () => {
    expect(defaultMailDeliveryConfig().transport).toBe("auto");
    expect(defaultMailDeliveryCapability().canSubmit).toBe(false);
  });

  it("defaultMailDeliveryState merges overrides and keeps the other defaults", () => {
    const state = defaultMailDeliveryState({
      config: { ...defaultMailDeliveryConfig(), from: "a@b.test" },
      capability: {
        ...defaultMailDeliveryCapability(),
        canSubmit: true,
        probes: { ...defaultMailDeliveryCapability().probes, smtpEligible: true },
      },
    });
    expect(state.config.from).toBe("a@b.test");
    expect(state.config.smtpPort).toBe(587);
    expect(state.capability.canSubmit).toBe(true);
    expect(state.capability.probes.smtpEligible).toBe(true);
    expect(state.capability.probes.phpMailAvailable).toBe(true);
    expect(state.lastTestSend).toBeNull();
    expect(defaultMailDeliveryState().capability.canSubmit).toBe(false);
  });

  it("defaultMailDeliveryState keeps an explicit lastTestSend", () => {
    const last = { accepted: true, status: "accepted", transport: "smtp", at: "t", message: null };
    expect(defaultMailDeliveryState({ lastTestSend: last as never }).lastTestSend).toBe(last);
  });

  it("lastTestSendLabel covers none, accepted and rejected", () => {
    expect(lastTestSendLabel(null)).toContain("No test send yet");
    const base = { accepted: true, status: "accepted", transport: "smtp", at: "t", message: null };
    expect(lastTestSendLabel(base as never)).toContain("accepted by the smtp transport");
    expect(lastTestSendLabel({ ...base, transport: "" } as never)).toContain("the selected");
    expect(lastTestSendLabel({ ...base, accepted: false, status: "failed" } as never)).toContain(
      "(failed, smtp)",
    );
    expect(
      lastTestSendLabel({ ...base, accepted: false, status: "failed", transport: "" } as never),
    ).toContain("(failed)");
  });
});

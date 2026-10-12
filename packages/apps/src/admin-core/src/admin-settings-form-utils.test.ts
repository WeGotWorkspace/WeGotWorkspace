import { describe, expect, it } from "vitest";
import { defaultMailDeliveryState } from "@/admin-core/src/admin-mail-delivery";
import {
  adminSettingsFormToMap,
  buildAdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

describe("adminSettingsFormToMap", () => {
  it("omits an empty delivery password so the server keeps the stored secret", () => {
    const { data } = createAdminAppBootstrap();
    const form = buildAdminSettingsFormState(data);
    expect(form.mailDeliverySmtpPassword).toBe("");
    const values = adminSettingsFormToMap(form);
    expect(values).not.toHaveProperty("mail_delivery_smtp_password");
    expect(values.mail_delivery_from).toBe(data.mailDelivery.config.from);
  });

  it("includes a new delivery password only when the field is filled", () => {
    const { data } = createAdminAppBootstrap();
    const values = adminSettingsFormToMap({
      ...buildAdminSettingsFormState(data),
      mailDeliverySmtpPassword: "new-secret",
    });
    expect(values.mail_delivery_smtp_password).toBe("new-secret");
  });

  it("prefills SMTP host from Mail-app settings when delivery host is empty", () => {
    const { data } = createAdminAppBootstrap({
      data: {
        ...createAdminAppBootstrap().data,
        mailDelivery: defaultMailDeliveryState(),
      },
    });
    const form = buildAdminSettingsFormState(data);
    expect(form.mailDeliverySmtpHost).toBe(data.mail.smtpHost);
  });

  it("never round-trips the TURN secret and omits it while the field is blank", () => {
    const { data } = createAdminAppBootstrap();
    const form = buildAdminSettingsFormState(data);
    expect(form.turnSecret).toBe("");
    const values = adminSettingsFormToMap(form);
    expect(values).not.toHaveProperty("rtc_turn_secret");
    expect(values).not.toHaveProperty("rtc_turn_username");
    expect(values).not.toHaveProperty("rtc_turn_credential");
  });

  it("sends the TURN secret only when the administrator typed one", () => {
    const { data } = createAdminAppBootstrap();
    const values = adminSettingsFormToMap({
      ...buildAdminSettingsFormState(data),
      turnSecret: "  north  ",
    });
    expect(values.rtc_turn_secret).toBe("north");
  });

  it("includes mcp_enabled from the form", () => {
    const { data } = createAdminAppBootstrap();
    const values = adminSettingsFormToMap(buildAdminSettingsFormState(data));
    expect(values.mcp_enabled).toBe(false);
  });

  it("round-trips rtc diagnostics switches", () => {
    const { data } = createAdminAppBootstrap({
      data: {
        ...createAdminAppBootstrap().data,
        rtc: {
          ...createAdminAppBootstrap().data.rtc,
          debugLogging: true,
          forceRelay: true,
        },
      },
    });
    const form = buildAdminSettingsFormState(data);
    expect(form.rtcDebugLogging).toBe(true);
    expect(form.rtcForceRelay).toBe(true);
    const values = adminSettingsFormToMap(form);
    expect(values.rtc_debug_logging).toBe(true);
    expect(values.rtc_force_relay).toBe(true);
  });
});

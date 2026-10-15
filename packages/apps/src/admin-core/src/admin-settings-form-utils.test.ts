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

  it("round-trips external invitation caps", () => {
    const { data } = createAdminAppBootstrap({
      data: {
        ...createAdminAppBootstrap().data,
        apps: {
          ...createAdminAppBootstrap().data.apps,
          imipExternalEnabled: false,
          imipHourlyLimit: 25,
          imipDailyLimit: 400,
        },
      },
    });
    const form = buildAdminSettingsFormState(data);
    expect(form.imipExternalEnabled).toBe(false);
    expect(form.imipHourlyLimit).toBe("25");
    expect(form.imipDailyLimit).toBe("400");
    const values = adminSettingsFormToMap(form);
    expect(values.imip_external_enabled).toBe(false);
    expect(values.imip_hourly_limit).toBe(25);
    expect(values.imip_daily_limit).toBe(400);
  });

  it("keeps a cleared hourly limit as text and normalizes it on save", () => {
    const { data } = createAdminAppBootstrap();
    const form = buildAdminSettingsFormState(data);
    expect(adminSettingsFormToMap({ ...form, imipHourlyLimit: "" }).imip_hourly_limit).toBe(100);
    expect(adminSettingsFormToMap({ ...form, imipHourlyLimit: "500" }).imip_hourly_limit).toBe(300);
    expect(adminSettingsFormToMap({ ...form, imipHourlyLimit: "40" }).imip_hourly_limit).toBe(40);
    expect(
      adminSettingsFormToMap({ ...form, imipHourlyLimit: "500", imipDailyLimit: "800" })
        .imip_hourly_limit,
    ).toBe(500);
    expect(
      adminSettingsFormToMap({ ...form, imipHourlyLimit: "500", imipDailyLimit: "200" })
        .imip_hourly_limit,
    ).toBe(200);
    expect(adminSettingsFormToMap({ ...form, imipDailyLimit: "" }).imip_daily_limit).toBe(300);
  });
});

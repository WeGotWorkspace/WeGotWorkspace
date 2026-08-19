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
});

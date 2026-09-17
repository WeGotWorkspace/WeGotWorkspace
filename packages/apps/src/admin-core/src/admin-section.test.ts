import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_SECTION,
  adminNavigateTarget,
  adminPathFor,
  adminSectionFromPathname,
  isAdminPathname,
  isAdminSection,
  resolveAdminSection,
} from "@/admin-core/src/admin-section";

describe("admin-section", () => {
  it("maps the default users pane to /admin", () => {
    expect(ADMIN_DEFAULT_SECTION).toBe("users");
    expect(adminPathFor("users")).toBe("/admin");
    expect(adminPathFor("email-delivery")).toBe("/admin/email-delivery");
    expect(adminPathFor("mcp")).toBe("/admin/mcp");
    expect(adminNavigateTarget("users")).toEqual({ to: "/admin" });
    expect(adminNavigateTarget("email-delivery")).toEqual({
      to: "/admin/$section",
      params: { section: "email-delivery" },
    });
  });

  it("falls back unknown or missing sections to users", () => {
    expect(isAdminSection("plugins")).toBe(true);
    expect(isAdminSection("nope")).toBe(false);
    expect(resolveAdminSection("plugins")).toBe("plugins");
    expect(resolveAdminSection("nope")).toBe("users");
    expect(resolveAdminSection(undefined)).toBe("users");
    expect(isAdminPathname("/admin")).toBe(true);
    expect(isAdminPathname("/admin/plugins")).toBe(true);
    expect(isAdminPathname("/settings")).toBe(false);
    expect(adminSectionFromPathname("/admin")).toBeUndefined();
    expect(adminSectionFromPathname("/admin/plugins")).toBe("plugins");
    expect(adminSectionFromPathname("/admin/email-delivery")).toBe("email-delivery");
    expect(adminSectionFromPathname("/admin/not-a-pane")).toBe("not-a-pane");
  });
});

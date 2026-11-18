import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  ADMIN_GROUP_ORDER,
  adminHasBackups,
  useAdminSidebarModel,
} from "@/admin-core/src/use-admin-sidebar-model";

describe("adminHasBackups", () => {
  it("shows Backups only where the web updater makes them (ZIP installs)", () => {
    expect(adminHasBackups(null)).toBe(true);
    expect(adminHasBackups(undefined)).toBe(true);
    // Docker and Helm installs both report the docker channel.
    expect(adminHasBackups("docker")).toBe(false);
  });
});

describe("useAdminSidebarModel", () => {
  it("lists Backups on a ZIP install and hides it on Docker or Helm", () => {
    const zip = renderHook(() => useAdminSidebarModel({ installChannel: null })).result.current;
    const docker = renderHook(() => useAdminSidebarModel({ installChannel: "docker" })).result
      .current;
    expect(zip.some((section) => section.id === "backups")).toBe(true);
    expect(docker.some((section) => section.id === "backups")).toBe(false);
    expect(docker.some((section) => section.id === "updates")).toBe(true);
  });

  it("puts every section in a known group, Health under System", () => {
    const sections = renderHook(() => useAdminSidebarModel({ installChannel: null })).result
      .current;
    expect(sections.every((section) => ADMIN_GROUP_ORDER.includes(section.group))).toBe(true);
    expect(sections.find((section) => section.id === "health")?.group).toBe("system");
  });
});

import type { AdminSection } from "@/admin-core/src/admin-types";

export const ADMIN_DEFAULT_SECTION: AdminSection = "users";

export const ADMIN_SECTIONS = [
  "users",
  "mail",
  "email-delivery",
  "collaboration",
  "webdav",
  "plugins",
  "backups",
  "updates",
  "search",
  "mcp",
] as const satisfies readonly AdminSection[];

export function isAdminSection(value: string | undefined): value is AdminSection {
  return value !== undefined && (ADMIN_SECTIONS as readonly string[]).includes(value);
}

export function isAdminPathname(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function resolveAdminSection(requested: string | undefined): AdminSection {
  return isAdminSection(requested) ? requested : ADMIN_DEFAULT_SECTION;
}

export function adminPathFor(section: AdminSection): string {
  return section === ADMIN_DEFAULT_SECTION ? "/admin" : `/admin/${section}`;
}

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

/** First `/admin/:section` segment, or `undefined` on `/admin`. */
export function adminSectionFromPathname(pathname: string): string | undefined {
  if (!pathname.startsWith("/admin/")) return undefined;
  const segment = pathname.slice("/admin/".length).split("/")[0];
  return segment ? decodeURIComponent(segment) : undefined;
}

export function resolveAdminSection(requested: string | undefined): AdminSection {
  return isAdminSection(requested) ? requested : ADMIN_DEFAULT_SECTION;
}

export function adminPathFor(section: AdminSection): string {
  return section === ADMIN_DEFAULT_SECTION ? "/admin" : `/admin/${section}`;
}

export type AdminNavigateTarget =
  | { to: "/admin"; params?: never }
  | { to: "/admin/$section"; params: { section: Exclude<AdminSection, "users"> } };

/** TanStack `to` must be the route pattern (`/admin/$section`), not `/admin/mail`. */
export function adminNavigateTarget(section: AdminSection): AdminNavigateTarget {
  if (section === "users") {
    return { to: "/admin" };
  }
  return { to: "/admin/$section", params: { section } };
}

import { decodeJwtPayload } from "@/lib/api/wgw/jwt-exp";

export type PrincipalRole = "guest" | "user" | "admin";

/** The access token's `role` claim. That claim is the principal role. */
export function principalRoleFromToken(token: string | null | undefined): PrincipalRole {
  if (!token) return "guest";
  const role = decodeJwtPayload(token)?.role;
  if (role === "admin" || role === "user" || role === "guest") return role;
  return "guest";
}

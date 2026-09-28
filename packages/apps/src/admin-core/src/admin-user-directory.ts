import type { AdminUser } from "@/admin-core/src/admin-types";

export type CreateUserDecision =
  | { ok: true; username: string }
  | { ok: false; message: "Username is required" | "Username already exists" };

export function createTemporaryPassword(): string {
  const token = typeof crypto !== "undefined" ? crypto.randomUUID() : Date.now();
  return `Temp-${token}`;
}

export function validateCreateUser(
  users: readonly AdminUser[],
  username: string,
): CreateUserDecision {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, message: "Username is required" };
  }
  const needle = trimmed.toLowerCase();
  if (users.some((user) => user.username.toLowerCase() === needle)) {
    return { ok: false, message: "Username already exists" };
  }
  return { ok: true, username: trimmed };
}

export function localCreatedUser(input: {
  username: string;
  displayName: string;
  email: string;
  createdAt: string;
}): AdminUser {
  return {
    id: input.username,
    username: input.username,
    displayName: input.displayName.trim(),
    email: input.email.trim(),
    groups: [],
    createdAt: input.createdAt,
    enabled: true,
  };
}

export function mapUserProfile(
  users: readonly AdminUser[],
  userId: string,
  input: { displayName: string; email: string },
): AdminUser[] {
  return users.map((user) =>
    user.id === userId
      ? {
          ...user,
          displayName: input.displayName.trim(),
          email: input.email.trim(),
        }
      : user,
  );
}

export function mapUserEnabled(
  users: readonly AdminUser[],
  userId: string,
  enabled: boolean,
): AdminUser[] {
  return users.map((candidate) =>
    candidate.id === userId ? { ...candidate, enabled } : candidate,
  );
}

export function removeUserById(users: readonly AdminUser[], userId: string): AdminUser[] {
  return users.filter((user) => user.id !== userId);
}

export function validatePasswordChange(password: string, confirmPassword: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}

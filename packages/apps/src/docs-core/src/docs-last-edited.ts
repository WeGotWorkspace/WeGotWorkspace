import { formatListDateTime } from "@/lib/datetime/format-list-date";

/** Compact footer stamp for Docs last-saved / updatedAt. Empty when no real timestamp. */
export function formatDocLastEdited(updatedAt: string | null | undefined): string {
  if (!updatedAt || updatedAt === "—" || updatedAt === "") return "";
  return formatListDateTime(updatedAt);
}

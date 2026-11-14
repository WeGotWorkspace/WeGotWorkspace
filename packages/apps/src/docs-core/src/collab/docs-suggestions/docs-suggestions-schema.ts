import { z } from "zod";
import type { DocsSuggestionThread } from "@/text-editor-core/docs-collab/docs-suggestions-types";

const docsCommentAuthorSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value?.trim() || "Unknown"),
});

const docsCommentMessageSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: docsCommentAuthorSchema,
});

const docsCommentReactionSchema = z.object({
  emoji: z.string(),
  userIds: z.array(z.string()).min(1),
});

function parseReactionArray(items: unknown): z.infer<typeof docsCommentReactionSchema>[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const parsed = docsCommentReactionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Wire shape stored in the Yjs suggestionThreads map (changeId lives on the map key). */
export const docsSuggestionThreadStoredSchema = z.object({
  messages: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = docsCommentMessageSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  reactions: z
    .unknown()
    .optional()
    .transform((value) => {
      const reactions = parseReactionArray(value);
      return reactions.length > 0 ? reactions : undefined;
    }),
});

export type DocsSuggestionThreadStored = z.infer<typeof docsSuggestionThreadStoredSchema>;

export function parseDocsSuggestionThread(
  value: unknown,
  changeId: string,
): DocsSuggestionThread | null {
  const result = docsSuggestionThreadStoredSchema.safeParse(value);
  if (!result.success) return null;
  return { changeId, ...result.data };
}

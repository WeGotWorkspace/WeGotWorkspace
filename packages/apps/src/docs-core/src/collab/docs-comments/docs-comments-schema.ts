import { z } from "zod";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

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

/** Wire shape stored in the Yjs comments map (thread id lives on the map key). */
export const docsCommentThreadStoredSchema = z.object({
  anchorText: z.string(),
  anchorFrom: z.number().optional(),
  anchorTo: z.number().optional(),
  anchorOccurrence: z.number().optional(),
  createdAt: z.string(),
  createdBy: docsCommentAuthorSchema,
  resolved: z.boolean(),
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
  id: z.string().optional(),
});

export type DocsCommentThreadStored = z.infer<typeof docsCommentThreadStoredSchema>;

export function parseDocsCommentThread(value: unknown, id: string): DocsCommentThread | null {
  const result = docsCommentThreadStoredSchema.safeParse(value);
  if (!result.success) return null;
  return { id, ...result.data };
}

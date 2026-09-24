import type { ChatMention, ChatMentionPrincipal } from "@/chat-ui/src/chat-types";

export type ChatMentionQuery = {
  query: string;
  start: number;
  end: number;
};

const MENTION_AFTER = /[\s.,!?;:)]/u;

function mentionBoundaryAfter(body: string, end: number): boolean {
  const after = body[end];
  return after == null || MENTION_AFTER.test(after);
}

/** `@` query at the end of `text` (cursor). `start`/`end` are indexes into `text`. */
export function extractChatMentionQuery(text: string): ChatMentionQuery | null {
  const match = text.match(/(^|[\s([{])@([^\s@]*)$/u);
  if (!match || match.index == null) return null;
  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const atIndex = match.index + prefix.length;
  return { query, start: atIndex, end: text.length };
}

export function filterChatMentionPrincipals(
  principals: readonly ChatMentionPrincipal[],
  query: string,
): ChatMentionPrincipal[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...principals];
  return principals.filter((principal) => {
    return (
      principal.displayName.toLowerCase().includes(needle) ||
      principal.id.toLowerCase().includes(needle)
    );
  });
}

function mentionStartsAt(body: string, index: number): boolean {
  if (body[index] !== "@") return false;
  if (index === 0) return true;
  return /[\s([{]/u.test(body[index - 1] ?? "");
}

/** Longest display-name / id wins so `@Ada Lovelace` beats `@Ada`. */
export function parseChatMentions(
  body: string,
  principals: readonly ChatMentionPrincipal[],
): ChatMention[] {
  const found = new Map<string, ChatMention>();
  const ranked = [...principals].sort((left, right) => {
    return (
      Math.max(right.displayName.length, right.id.length) -
      Math.max(left.displayName.length, left.id.length)
    );
  });
  const lower = body.toLowerCase();

  let index = 0;
  while (index < body.length) {
    if (!mentionStartsAt(body, index)) {
      index += 1;
      continue;
    }

    let matched: ChatMentionPrincipal | null = null;
    let matchedLength = 0;
    for (const principal of ranked) {
      for (const name of [principal.displayName, principal.id]) {
        const token = `@${name}`;
        if (
          token.length > matchedLength &&
          lower.startsWith(token.toLowerCase(), index) &&
          mentionBoundaryAfter(body, index + token.length)
        ) {
          matched = principal;
          matchedLength = token.length;
        }
      }
    }

    if (matched) {
      found.set(matched.id, { id: matched.id, displayName: matched.displayName });
      index += matchedLength;
      continue;
    }
    index += 1;
  }

  return [...found.values()];
}

/**
 * Wrap parsed `@mention` tokens in `<mark>` so the read-only Highlight mark
 * paints them. Display-only — do not persist this wrapping.
 */
export function highlightChatMentionsMarkdown(
  body: string,
  mentions: readonly ChatMention[],
): string {
  if (!body || mentions.length === 0) return body;
  const tokens = [
    ...new Set(mentions.flatMap((mention) => [`@${mention.displayName}`, `@${mention.id}`])),
  ].sort((left, right) => right.length - left.length);
  const lower = body.toLowerCase();
  let index = 0;
  let result = "";

  while (index < body.length) {
    if (!mentionStartsAt(body, index)) {
      result += body[index];
      index += 1;
      continue;
    }

    let matchedLength = 0;
    for (const token of tokens) {
      if (
        token.length > matchedLength &&
        lower.startsWith(token.toLowerCase(), index) &&
        mentionBoundaryAfter(body, index + token.length)
      ) {
        matchedLength = token.length;
      }
    }

    if (matchedLength > 0) {
      const alreadyWrapped =
        result.endsWith("<mark>") || body.startsWith("</mark>", index + matchedLength);
      const slice = body.slice(index, index + matchedLength);
      result += alreadyWrapped ? slice : `<mark>${slice}</mark>`;
      index += matchedLength;
      continue;
    }

    result += body[index];
    index += 1;
  }

  return result;
}

/**
 * Reads the two front matter keys a Markdown import needs (#1623): `title`
 * and `tags`. Not a YAML parser — other keys, nesting and anchors are ignored.
 */

export type MarkdownFrontMatter = {
  title?: string;
  tags: string[];
};

export type SplitFrontMatter = {
  frontMatter: MarkdownFrontMatter | null;
  body: string;
};

const OPEN_LINE = /^---[ \t]*$/;
const CLOSE_LINE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_LINE = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/;
const LIST_ITEM_LINE = /^[ \t]+-[ \t]*(.*)$|^-[ \t]+(.*)$/;

/** Strip one pair of matching quotes and a trailing ` # comment` on plain scalars. */
export function unquoteScalar(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'");
    }
  }
  return value.replace(/[ \t]+#.*$/, "").trim();
}

function splitTagScalar(raw: string): string[] {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => unquoteScalar(item));
  }
  const unquoted = unquoteScalar(value);
  return unquoted.split(/[,]/).map((item) => item.trim());
}

function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/, "").trim();
}

function parseFrontMatterLines(lines: readonly string[]): MarkdownFrontMatter {
  const result: MarkdownFrontMatter = { tags: [] };
  let listKey: string | null = null;
  for (const line of lines) {
    const listItem = line.match(LIST_ITEM_LINE);
    if (listItem && listKey) {
      if (listKey === "tags") {
        result.tags.push(...splitTagScalar(listItem[1] ?? listItem[2] ?? ""));
      }
      continue;
    }
    const keyLine = line.match(KEY_LINE);
    if (!keyLine) {
      if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("\t")) listKey = null;
      continue;
    }
    const key = keyLine[1].toLowerCase();
    const value = keyLine[2];
    listKey = value.trim() === "" ? key : null;
    if (key === "title" && value.trim() !== "") {
      result.title = unquoteScalar(value);
    } else if (key === "tags" && value.trim() !== "") {
      result.tags.push(...splitTagScalar(value));
    }
  }
  result.tags = result.tags.map(cleanTag).filter((tag) => tag !== "");
  return result;
}

/**
 * Split a leading `---` block off `text`. Without a closing `---` / `...`
 * line there is no front matter and the text is returned unchanged.
 */
export function splitFrontMatter(text: string): SplitFrontMatter {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !OPEN_LINE.test(lines[0])) {
    return { frontMatter: null, body: text };
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (CLOSE_LINE.test(lines[index])) {
      return {
        frontMatter: parseFrontMatterLines(lines.slice(1, index)),
        body: lines.slice(index + 1).join("\n"),
      };
    }
  }
  return { frontMatter: null, body: text };
}

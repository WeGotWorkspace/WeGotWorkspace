import type { JSONContent } from "@tiptap/core";

/**
 * A Doc as neutral blocks for file writers (Word now, PDF and OpenDocument later).
 * Built from `editor.getJSON()` because text alignment only lives in the live document,
 * not in the stored Markdown. Holds what Print shows: no comment or suggestion markup.
 */

export type ExportAlign = "left" | "center" | "right" | "justify";

export type ExportTextRun = {
  kind: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
  code?: boolean;
  /** Only `http(s):`, `mailto:` and `tel:` links survive. */
  href?: string;
};

export type ExportRun = ExportTextRun | { kind: "break" };

export type ExportListItem = { blocks: ExportBlock[] };
export type ExportTaskItem = { checked: boolean; blocks: ExportBlock[] };

export type ExportTableCell = {
  header: boolean;
  colspan: number;
  rowspan: number;
  blocks: ExportBlock[];
};

export type ExportTableRow = { cells: ExportTableCell[] };

export type ExportHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ExportBlock =
  | { kind: "paragraph"; align?: ExportAlign; runs: ExportRun[] }
  | { kind: "heading"; level: ExportHeadingLevel; align?: ExportAlign; runs: ExportRun[] }
  | { kind: "list"; ordered: boolean; start: number; items: ExportListItem[] }
  | { kind: "taskList"; items: ExportTaskItem[] }
  | { kind: "quote"; blocks: ExportBlock[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "divider" }
  | { kind: "image"; src: string; alt: string; title: string }
  | { kind: "table"; rows: ExportTableRow[] }
  | { kind: "pageBreak" };

/** A pending deletion is not part of the exported text: suggestions export as accepted. */
const DELETION_MARK = "deletion";

const ALIGNMENTS = new Set<ExportAlign>(["left", "center", "right", "justify"]);
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

function alignOf(node: JSONContent): ExportAlign | undefined {
  const value = node.attrs?.textAlign;
  // `left` is the default; leave it out so writers keep their own default.
  if (typeof value !== "string" || value === "left") return undefined;
  return ALIGNMENTS.has(value as ExportAlign) ? (value as ExportAlign) : undefined;
}

function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const href = value.trim();
  return SAFE_LINK.test(href) ? href : undefined;
}

function isDeleted(node: JSONContent): boolean {
  return node.marks?.some((mark) => mark.type === DELETION_MARK) ?? false;
}

function textRun(node: JSONContent): ExportTextRun {
  const run: ExportTextRun = { kind: "text", text: node.text ?? "" };
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        run.bold = true;
        break;
      case "italic":
        run.italic = true;
        break;
      case "underline":
        run.underline = true;
        break;
      case "strike":
        run.strike = true;
        break;
      case "highlight":
        run.highlight = true;
        break;
      case "code":
        run.code = true;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (href) run.href = href;
        break;
      }
      // comment, commentDraftAnchor, legacySuggestion, insertion, formatChange: Print
      // shows none of them as markup, so the text stays and the mark goes.
      default:
        break;
    }
  }
  return run;
}

function sameFormat(a: ExportTextRun, b: ExportTextRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.highlight === b.highlight &&
    a.code === b.code &&
    a.href === b.href
  );
}

/** Inline content as runs. Neighbouring runs with the same format are joined. */
export function exportRuns(nodes: JSONContent[] | undefined): ExportRun[] {
  const runs: ExportRun[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      runs.push({ kind: "break" });
      continue;
    }
    if (node.type !== "text" || isDeleted(node) || !node.text) continue;
    const run = textRun(node);
    const last = runs.at(-1);
    if (last?.kind === "text" && sameFormat(last, run)) last.text += run.text;
    else runs.push(run);
  }
  return runs;
}

function plainText(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") return "\n";
      if (node.type !== "text" || isDeleted(node)) return "";
      return node.text ?? "";
    })
    .join("");
}

function headingLevel(value: unknown): ExportHeadingLevel {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, level)) as ExportHeadingLevel;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function table(node: JSONContent): ExportBlock {
  const rows: ExportTableRow[] = (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map((row) => ({
      cells: (row.content ?? []).map((cell) => ({
        header: cell.type === "tableHeader",
        colspan: positiveInt(cell.attrs?.colspan, 1),
        rowspan: positiveInt(cell.attrs?.rowspan, 1),
        blocks: exportBlocks(cell.content),
      })),
    }));
  return { kind: "table", rows };
}

function block(node: JSONContent): ExportBlock[] {
  switch (node.type) {
    case "paragraph":
      return [{ kind: "paragraph", align: alignOf(node), runs: exportRuns(node.content) }];
    case "heading":
      return [
        {
          kind: "heading",
          level: headingLevel(node.attrs?.level),
          align: alignOf(node),
          runs: exportRuns(node.content),
        },
      ];
    case "bulletList":
    case "orderedList":
      return [
        {
          kind: "list",
          ordered: node.type === "orderedList",
          start: positiveInt(node.attrs?.start, 1),
          items: (node.content ?? []).map((item) => ({ blocks: exportBlocks(item.content) })),
        },
      ];
    case "taskList":
      return [
        {
          kind: "taskList",
          items: (node.content ?? []).map((item) => ({
            checked: item.attrs?.checked === true,
            blocks: exportBlocks(item.content),
          })),
        },
      ];
    case "blockquote":
      return [{ kind: "quote", blocks: exportBlocks(node.content) }];
    case "codeBlock": {
      const language = node.attrs?.language;
      return [
        {
          kind: "code",
          text: plainText(node.content),
          ...(typeof language === "string" && language ? { language } : {}),
        },
      ];
    }
    case "horizontalRule":
      return [{ kind: "divider" }];
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      if (!src) return [];
      return [
        {
          kind: "image",
          src,
          alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "",
          title: typeof node.attrs?.title === "string" ? node.attrs.title : "",
        },
      ];
    }
    case "table":
      return [table(node)];
    case "pageBreak":
      return [{ kind: "pageBreak" }];
    default:
      // Unknown wrapper: keep its blocks rather than lose the text.
      return node.content ? exportBlocks(node.content) : [];
  }
}

/** Block content (a doc, list item, cell or quote) as export blocks. */
export function exportBlocks(nodes: JSONContent[] | undefined): ExportBlock[] {
  return (nodes ?? []).flatMap(block);
}

/** The whole document. An empty Doc gives one empty paragraph so writers stay valid. */
export function editorJsonToExportBlocks(doc: JSONContent): ExportBlock[] {
  const blocks = exportBlocks(doc.content);
  return blocks.length > 0 ? blocks : [{ kind: "paragraph", runs: [] }];
}

/** Every image source in reading order, without duplicates. */
export function exportImageSources(blocks: readonly ExportBlock[]): string[] {
  const seen = new Set<string>();
  const visit = (list: readonly ExportBlock[]) => {
    for (const b of list) {
      if (b.kind === "image") seen.add(b.src);
      else if (b.kind === "quote") visit(b.blocks);
      else if (b.kind === "list" || b.kind === "taskList") b.items.forEach((i) => visit(i.blocks));
      else if (b.kind === "table") b.rows.forEach((r) => r.cells.forEach((c) => visit(c.blocks)));
    }
  };
  visit(blocks);
  return [...seen];
}

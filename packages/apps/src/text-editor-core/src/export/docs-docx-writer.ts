/**
 * Export blocks → Word (.docx). Loaded only through `import()` from the download action,
 * so the `docx` library (MIT) never enters the Docs route chunk.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type INumberingOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type {
  ExportAlign,
  ExportBlock,
  ExportRun,
} from "@/text-editor-core/src/export/text-editor-export-blocks";
import type { ExportImages } from "@/text-editor-core/src/export/text-editor-export-images";

export type DocxPage = {
  /** Portrait width and height in CSS px (96 dpi), as `TEXT_EDITOR_PAGE_FORMAT_SPECS`. */
  width: number;
  height: number;
  landscape: boolean;
  /** Margin on every side in CSS px. */
  margin: number;
};

export type DocxWriteOptions = {
  title: string;
  page: DocxPage;
  images: ExportImages;
};

export type DocxWriteResult = {
  blob: Blob;
  /** Images that became a placeholder because their bytes were missing. */
  missingImages: number;
};

/** 1 CSS px = 15 twips (1/20 pt) at 96 dpi. */
const TWIPS_PER_PX = 15;
const INDENT_STEP = 720;
const MONO_FONT = "Courier New";
const BODY_FONT = "Calibri";
const MAX_LIST_LEVEL = 8;

const BULLET_REF = "docs-bullet";
const BULLET_GLYPHS = ["•", "◦", "▪"];
const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** Heading sizes in half-points, close to the editor's prose scale. */
const HEADING_SIZES = [40, 32, 28, 24, 22, 22] as const;

const ALIGN: Record<ExportAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

type Block = Paragraph | Table;

type Ctx = {
  images: ExportImages;
  contentWidthTwips: number;
  /** One numbering reference per ordered-list start value; each list gets its own instance. */
  orderedRefs: Map<number, string>;
  nextInstance: number;
  missingImages: number;
};

type Scope = {
  /** Left indent in twips for blocks nested in a list item or quote. */
  indent: number;
  /** List nesting level of the enclosing item, -1 outside lists. */
  listLevel: number;
  bold: boolean;
  quote: boolean;
};

const ROOT: Scope = { indent: 0, listLevel: -1, bold: false, quote: false };

function runOptions(run: Extract<ExportRun, { kind: "text" }>, scope: Scope): IRunOptions {
  return {
    text: run.text,
    ...(run.bold || scope.bold ? { bold: true } : {}),
    ...(run.italic ? { italics: true } : {}),
    ...(run.underline ? { underline: {} } : {}),
    ...(run.strike ? { strike: true } : {}),
    ...(run.highlight ? { highlight: "yellow" } : {}),
    // Named character styles, so the Word importer (#1619) can map them back.
    ...(run.code ? { style: "InlineCode" } : run.href ? { style: "Hyperlink" } : {}),
  };
}

function inlineChildren(runs: readonly ExportRun[], scope: Scope): ParagraphChild[] {
  return runs.map((run) => {
    if (run.kind === "break") return new TextRun({ break: 1 });
    const text = new TextRun(runOptions(run, scope));
    return run.href ? new ExternalHyperlink({ link: run.href, children: [text] }) : text;
  });
}

function indentOf(scope: Scope) {
  return scope.indent > 0 ? { indent: { left: scope.indent } } : {};
}

function quoteOf(scope: Scope) {
  return scope.quote ? { style: "Quote" } : {};
}

function orderedRef(ctx: Ctx, start: number): string {
  let ref = ctx.orderedRefs.get(start);
  if (!ref) {
    ref = start === 1 ? "docs-ordered" : `docs-ordered-${start}`;
    ctx.orderedRefs.set(start, ref);
  }
  return ref;
}

function imageParagraph(block: Extract<ExportBlock, { kind: "image" }>, ctx: Ctx, scope: Scope) {
  const image = ctx.images.get(block.src);
  if (!image) {
    ctx.missingImages += 1;
    const label = `[Image${block.alt ? `: ${block.alt}` : ""}]`;
    const text = new TextRun({ text: label, italics: true });
    const external = /^https?:/i.test(block.src);
    return new Paragraph({
      ...indentOf(scope),
      children: [
        external
          ? new ExternalHyperlink({
              link: block.src,
              children: [new TextRun({ text: label, italics: true, style: "Hyperlink" })],
            })
          : text,
      ],
    });
  }
  // Displayed size: natural size, capped at the text column (as `max-width: 100%`).
  const maxWidthPx = Math.max(1, (ctx.contentWidthTwips - scope.indent) / TWIPS_PER_PX);
  const scale = Math.min(1, maxWidthPx / image.width);
  return new Paragraph({
    ...indentOf(scope),
    children: [
      new ImageRun({
        type: image.type,
        data: image.bytes,
        transformation: {
          width: Math.max(1, Math.round(image.width * scale)),
          height: Math.max(1, Math.round(image.height * scale)),
        },
        altText: { name: block.alt || "Image", description: block.alt, title: block.title },
      }),
    ],
  });
}

function listBlocks(
  block: Extract<ExportBlock, { kind: "list" }>,
  ctx: Ctx,
  scope: Scope,
): Block[] {
  const level = Math.min(MAX_LIST_LEVEL, scope.listLevel + 1);
  const reference = block.ordered ? orderedRef(ctx, block.start) : BULLET_REF;
  const instance = block.ordered ? ctx.nextInstance++ : 0;
  const inner: Scope = { ...scope, listLevel: level, indent: INDENT_STEP * (level + 1) };
  const out: Block[] = [];
  for (const item of block.items) {
    let numbered = false;
    for (const child of item.blocks) {
      if (!numbered && child.kind === "paragraph") {
        out.push(
          new Paragraph({
            ...quoteOf(scope),
            alignment: child.align ? ALIGN[child.align] : undefined,
            numbering: { reference, level, instance },
            children: inlineChildren(child.runs, scope),
          }),
        );
        numbered = true;
        continue;
      }
      out.push(...blocks([child], ctx, inner));
    }
  }
  return out;
}

function taskListBlocks(
  block: Extract<ExportBlock, { kind: "taskList" }>,
  ctx: Ctx,
  scope: Scope,
): Block[] {
  const level = Math.min(MAX_LIST_LEVEL, scope.listLevel + 1);
  const indent = INDENT_STEP * (level + 1);
  const inner: Scope = { ...scope, listLevel: level, indent };
  const out: Block[] = [];
  for (const item of block.items) {
    let boxed = false;
    for (const child of item.blocks) {
      if (!boxed && child.kind === "paragraph") {
        out.push(
          new Paragraph({
            ...quoteOf(scope),
            indent: { left: indent, hanging: 360 },
            children: [
              new TextRun({ text: `${item.checked ? "☒" : "☐"}\t` }),
              ...inlineChildren(child.runs, scope),
            ],
          }),
        );
        boxed = true;
        continue;
      }
      out.push(...blocks([child], ctx, inner));
    }
  }
  return out;
}

function tableBlock(block: Extract<ExportBlock, { kind: "table" }>, ctx: Ctx, scope: Scope) {
  const columns = Math.max(
    1,
    ...block.rows.map((row) => row.cells.reduce((sum, cell) => sum + cell.colspan, 0)),
  );
  const width = Math.max(1, ctx.contentWidthTwips - scope.indent);
  const columnWidth = Math.floor(width / columns);
  const cellScope: Scope = { indent: 0, listLevel: -1, bold: false, quote: false };
  return new Table({
    width: { size: columnWidth * columns, type: WidthType.DXA },
    columnWidths: Array.from({ length: columns }, () => columnWidth),
    ...(scope.indent > 0 ? { indent: { size: scope.indent, type: WidthType.DXA } } : {}),
    rows: block.rows.map((row) => {
      const header = row.cells.length > 0 && row.cells.every((cell) => cell.header);
      return new TableRow({
        // Only on the real header row: mammoth reads `w:tblHeader w:val="off"` as a header.
        ...(header ? { tableHeader: true } : {}),
        cantSplit: true,
        children: row.cells.map((cell) => {
          const children = blocks(cell.blocks, ctx, { ...cellScope, bold: cell.header });
          return new TableCell({
            width: { size: columnWidth * cell.colspan, type: WidthType.DXA },
            ...(cell.colspan > 1 ? { columnSpan: cell.colspan } : {}),
            ...(cell.rowspan > 1 ? { rowSpan: cell.rowspan } : {}),
            ...(cell.header
              ? { shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } }
              : {}),
            // A cell must end with a paragraph (a table alone is not valid).
            children:
              children.length > 0 && children.at(-1) instanceof Paragraph
                ? children
                : [...children, new Paragraph({})],
          });
        }),
      });
    }),
  });
}

function blocks(list: readonly ExportBlock[], ctx: Ctx, scope: Scope): Block[] {
  return list.flatMap((block): Block[] => {
    switch (block.kind) {
      case "paragraph":
        return [
          new Paragraph({
            ...quoteOf(scope),
            ...indentOf(scope),
            alignment: block.align ? ALIGN[block.align] : undefined,
            children: inlineChildren(block.runs, scope),
          }),
        ];
      case "heading":
        return [
          new Paragraph({
            heading: HEADINGS[block.level - 1],
            ...indentOf(scope),
            alignment: block.align ? ALIGN[block.align] : undefined,
            children: inlineChildren(block.runs, scope),
          }),
        ];
      case "list":
        return listBlocks(block, ctx, scope);
      case "taskList":
        return taskListBlocks(block, ctx, scope);
      case "quote":
        return blocks(block.blocks, ctx, {
          ...scope,
          quote: true,
          indent: scope.indent + INDENT_STEP,
        });
      case "code":
        return [
          new Paragraph({
            style: "Code",
            ...indentOf(scope),
            children: block.text
              .split("\n")
              .map((line, i) => new TextRun({ text: line, ...(i > 0 ? { break: 1 } : {}) })),
          }),
        ];
      case "divider":
        return [new Paragraph({ style: "Divider", ...indentOf(scope), children: [] })];
      case "image":
        return [imageParagraph(block, ctx, scope)];
      case "table":
        // An empty paragraph after a table keeps two tables from merging in Word.
        return [tableBlock(block, ctx, scope), new Paragraph({})];
      case "pageBreak":
        return [new Paragraph({ children: [new PageBreak()] })];
    }
  });
}

function levels(ordered: boolean, start: number): ILevelsOptions[] {
  return Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
    level,
    format: ordered ? ORDERED_FORMATS[level % 3] : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : BULLET_GLYPHS[level % 3],
    alignment: AlignmentType.LEFT,
    ...(ordered && level === 0 ? { start } : {}),
    style: { paragraph: { indent: { left: INDENT_STEP * (level + 1), hanging: 360 } } },
  }));
}

function numbering(ctx: Ctx): INumberingOptions {
  return {
    config: [
      { reference: BULLET_REF, levels: levels(false, 1) },
      ...[...ctx.orderedRefs].map(([start, reference]) => ({
        reference,
        levels: levels(true, start),
      })),
    ],
  };
}

function headingStyle(index: number) {
  return {
    run: { font: BODY_FONT, size: HEADING_SIZES[index], bold: true, color: "000000" },
    // An explicit outline level makes Word's navigation pane and table of contents work.
    paragraph: { outlineLevel: index, keepNext: true, spacing: { before: 240, after: 120 } },
  };
}

export async function writeDocx(
  exportBlocks: readonly ExportBlock[],
  options: DocxWriteOptions,
): Promise<DocxWriteResult> {
  const { page } = options;
  const widthPx = page.landscape ? page.height : page.width;
  const marginTwips = Math.round(page.margin * TWIPS_PER_PX);
  const ctx: Ctx = {
    images: options.images,
    contentWidthTwips: Math.round(widthPx * TWIPS_PER_PX) - 2 * marginTwips,
    orderedRefs: new Map(),
    nextInstance: 1,
    missingImages: 0,
  };
  const children = blocks(exportBlocks, ctx, ROOT);
  // Word wants a paragraph as the last body element.
  if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph({}));

  const doc = new Document({
    title: options.title,
    creator: "WeGotWorkspace",
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        heading1: headingStyle(0),
        heading2: headingStyle(1),
        heading3: headingStyle(2),
        heading4: headingStyle(3),
        heading5: headingStyle(4),
        heading6: headingStyle(5),
      },
      paragraphStyles: [
        {
          id: "Code",
          name: "Code",
          basedOn: "Normal",
          run: { font: MONO_FONT, size: 20 },
          paragraph: {
            shading: { type: ShadingType.CLEAR, fill: "F5F5F5", color: "auto" },
            spacing: { before: 120, after: 120, line: 240 },
          },
        },
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          run: { italics: true, color: "555555" },
          paragraph: {
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BFBFBF", space: 8 } },
          },
        },
        {
          id: "Divider",
          name: "Divider",
          basedOn: "Normal",
          paragraph: {
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
            spacing: { before: 120, after: 240 },
          },
        },
      ],
      characterStyles: [
        {
          id: "InlineCode",
          name: "Inline Code",
          basedOn: "DefaultParagraphFont",
          run: {
            font: MONO_FONT,
            shading: { type: ShadingType.CLEAR, fill: "EFEFEF", color: "auto" },
          },
        },
      ],
    },
    numbering: numbering(ctx),
    sections: [
      {
        properties: {
          page: {
            size: {
              width: Math.round(page.width * TWIPS_PER_PX),
              height: Math.round(page.height * TWIPS_PER_PX),
              orientation: page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: marginTwips,
              bottom: marginTwips,
              left: marginTwips,
              right: marginTwips,
            },
          },
        },
        children,
      },
    ],
  });
  return { blob: await Packer.toBlob(doc), missingImages: ctx.missingImages };
}

#!/usr/bin/env node
// Builds the small .docx fixtures for the Word → Markdown tests (#1619).
// Hand-written WordprocessingML (ECMA-376), zipped with fflate, so the files are
// tiny and reproducible. Run from packages/apps:
//   node src/docs-core/src/docx-import/__tests__/fixtures/build-docx-fixtures.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync, zlibSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date("2026-11-10T00:00:00Z");

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ---------- tiny PNG (solid colour) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(width, height, [r, g, b]) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) raw.set([r, g, b], row + 1 + x * 3);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---------- WordprocessingML helpers ----------
// XML escape for text and attribute values.
const esc = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const run = (text, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (content, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
const styled = (style, text) => para(run(text), `<w:pStyle w:val="${style}"/>`);
const listItem = (numId, level, text) =>
  para(
    run(text),
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
  );

const STYLES = `${XML}<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`,
  )
  .join("\n")}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;

const NUMBERING = `${XML}<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">${[0, 1, 2]
  .map(
    (l) =>
      `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`,
  )
  .join("")}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${[0, 1]
  .map(
    (l) =>
      `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${l ? "lowerLetter" : "decimal"}"/><w:lvlText w:val="%${l + 1}."/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`,
  )
  .join("")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const SECT = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

function imageRun(relId, name, alt, cx, cy) {
  return `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="${name}" descr="${esc(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${name}" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/**
 * Packs one .docx. `parts` maps extra part names to { id, rel, type, xml },
 * `media` maps relationship ids to images, `links` maps ids to external URLs.
 */
function buildDocx({ body, parts = {}, media = {}, links = {} }) {
  const overrides = [
    [
      "/word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    ],
    [
      "/word/styles.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    ],
    [
      "/word/numbering.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
    ],
    ...Object.entries(parts).map(([name, p]) => [`/word/${name}`, p.type]),
  ];
  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join("")}</Types>`;
  const rels = [
    ["rIdStyles", `${REL}/styles`, "styles.xml"],
    ["rIdNumbering", `${REL}/numbering`, "numbering.xml"],
    ...Object.entries(parts).map(([name, p]) => [p.id, p.rel, name]),
    ...Object.entries(media).map(([id, m]) => [id, `${REL}/image`, `media/${m.name}`]),
  ];
  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}${Object.entries(links)
    .map(([id, url]) => linkRel(id, url))
    .join("")}</Relationships>`;
  const files = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(`${XML}<w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(docRels),
    "word/styles.xml": strToU8(STYLES),
    "word/numbering.xml": strToU8(NUMBERING),
  };
  for (const [name, p] of Object.entries(parts)) files[`word/${name}`] = strToU8(p.xml);
  for (const m of Object.values(media)) files[`word/media/${m.name}`] = m.bytes;
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, [data, { mtime: FIXED_DATE }]]),
  );
  return zipSync(entries, { level: 6 });
}

// External hyperlinks need a relationship with TargetMode="External".
const linkRel = (id, url) =>
  `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(url)}" TargetMode="External"/>`;
const hyperlink = (id, text) =>
  `<w:hyperlink r:id="${id}">${run(text, '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`;

// ---------- fixtures ----------
const fixtures = {
  "headings.docx": buildDocx({
    body: [
      styled("Title", "Quarterly letter"),
      styled("Subtitle", "Draft for the board"),
      ...[1, 2, 3, 4, 5, 6].map((n) => styled(`Heading${n}`, `Heading level ${n}`)),
      para(
        run("Plain, ") +
          run("bold", "<w:b/>") +
          run(", ") +
          run("italic", "<w:i/>") +
          run(", ") +
          run("underlined", '<w:u w:val="single"/>') +
          run(" and ") +
          run("struck", "<w:strike/>") +
          run(" text."),
      ),
      para(run("A centred line."), '<w:jc w:val="center"/>'),
      para(run("A quoted line."), '<w:pStyle w:val="Quote"/>'),
      SECT,
    ].join(""),
  }),
  "lists.docx": buildDocx({
    body: [
      para(run("Shopping:")),
      listItem(1, 0, "Fruit"),
      listItem(1, 1, "Apples"),
      listItem(1, 2, "Green apples"),
      listItem(1, 0, "Bread"),
      para(run("Steps:")),
      listItem(2, 0, "Open the box"),
      listItem(2, 1, "Check the parts"),
      listItem(2, 0, "Build it"),
      SECT,
    ].join(""),
  }),
  "table.docx": buildDocx({
    body: [
      para(run("Prices:")),
      `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${[
        ["Item", "Price", true],
        ["Coffee", "€ 3", false],
        ["Tea", "€ 2", false],
      ]
        .map(
          ([a, b, header]) =>
            `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${[a, b]
              .map(
                (t) =>
                  `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${para(run(t, header ? "<w:b/>" : ""))}</w:tc>`,
              )
              .join("")}</w:tr>`,
        )
        .join("")}</w:tbl>`,
      para(run("End of table.")),
      SECT,
    ].join(""),
  }),
  "image-link.docx": buildDocx({
    body: [
      para(run("Our logo:")),
      para(imageRun("rIdImg1", "logo.png", "Blue square logo", 952500, 476250)),
      para(run("Read more on ") + hyperlink("rIdLink1", "the example site") + run(".")),
      SECT,
    ].join(""),
    links: { rIdLink1: "https://example.com/more" },
    media: { rIdImg1: { name: "image1.png", bytes: makePng(40, 20, [30, 90, 200]) } },
  }),
  "report.docx": buildReportFixture(),
  "google-export.docx": buildGoogleExportFixture(),
};

/**
 * Shaped like Google Docs' *File → Download → Microsoft Word (.docx)* (#1615):
 * Arial and black set on every run, Title/Subtitle styles, lists on Normal
 * paragraphs, links coloured 1155CC, comments, and a pending suggestion as a
 * tracked change. Synthetic: replace with a real export when one is at hand.
 */
function buildGoogleExportFixture() {
  const arial = '<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>';
  const gRun = (text, extra = "") => run(text, `${arial}${extra}<w:color w:val="000000"/>`);
  const gPara = (content, style = "Normal", extra = "") =>
    para(
      content,
      `<w:pStyle w:val="${style}"/><w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:spacing w:after="0" w:before="0" w:line="276" w:lineRule="auto"/>${extra}`,
    );
  const gList = (level, text) =>
    gPara(
      gRun(text),
      "Normal",
      `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`,
    );
  const gLink = (id, text) =>
    `<w:hyperlink r:id="${id}">${run(text, `${arial}<w:color w:val="1155cc"/><w:u w:val="single"/>`)}</w:hyperlink>`;
  const gCell = (text) =>
    `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${gPara(gRun(text))}</w:tc>`;
  const body = [
    gPara(gRun("Project brief"), "Title"),
    gPara(gRun("Written in Google Docs"), "Subtitle"),
    gPara(gRun("Goals"), "Heading1"),
    gList(0, "Ship the beta"),
    gList(1, "Invite ten teams"),
    gList(0, "Collect feedback"),
    gPara(gRun("Budget"), "Heading2"),
    gPara(
      gRun("We plan ") +
        '<w:commentRangeStart w:id="0"/>' +
        gRun("three sprints") +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        gRun(" starting in ") +
        `<w:ins w:id="1" w:author="Sam Editor" w:date="2026-11-09T10:00:00Z">${gRun("June")}</w:ins>` +
        `<w:del w:id="2" w:author="Sam Editor" w:date="2026-11-09T10:00:00Z"><w:r><w:rPr>${arial}</w:rPr><w:delText xml:space="preserve">May</w:delText></w:r></w:del>` +
        gRun("."),
    ),
    `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid><w:tr>${gCell("Phase")}${gCell("Weeks")}</w:tr><w:tr>${gCell("Build")}${gCell("6")}</w:tr></w:tbl>`,
    gPara(
      `<w:r><w:rPr>${arial}</w:rPr>${imageRun("rIdImg1", "image1.png", "Team photo", 952500, 476250).slice(5)}`,
    ),
    gPara(gRun("Details on ") + gLink("rIdLink1", "the project site") + gRun(".")),
    SECT,
  ].join("");
  return buildDocx({
    body,
    links: { rIdLink1: "https://example.com/project" },
    media: { rIdImg1: { name: "image1.png", bytes: makePng(40, 20, [200, 60, 30]) } },
    parts: {
      "comments.xml": {
        id: "rIdComments",
        rel: `${REL}/comments`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
        xml: `${XML}<w:comments ${W}><w:comment w:id="0" w:author="Ann Lee" w:date="2026-11-09T09:00:00Z" w:initials="AL">${para(run("Is three enough?"))}</w:comment></w:comments>`,
      },
    },
  });
}

function buildReportFixture() {
  const comment = (id, text) =>
    `<w:comment w:id="${id}" w:author="Reviewer" w:date="2026-11-10T09:00:00Z" w:initials="R">${para(run(text))}</w:comment>`;
  const note = (tag, id, text) => `<w:${tag} w:id="${id}">${para(run(text))}</w:${tag}>`;
  const separators = (tag) =>
    `<w:${tag} w:type="separator" w:id="-1">${para("<w:r><w:separator/></w:r>")}</w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0">${para("<w:r><w:continuationSeparator/></w:r>")}</w:${tag}>`;
  const textBox = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor behindDoc="0" distT="0" distB="0" distL="0" distR="0" simplePos="0" locked="0" layoutInCell="1" allowOverlap="1" relativeHeight="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="457200"/><wp:wrapNone/><wp:docPr id="2" name="Text Box 1"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent>${para(run("Boxed remark"))}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback/></mc:AlternateContent></w:r>`;
  const body = [
    styled("Heading1", "Project plan"),
    para(
      run("Budget is ") +
        '<w:commentRangeStart w:id="0"/>' +
        run("4,600 euro") +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r>' +
        run(" in total") +
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
        run("."),
    ),
    para(
      run("Delivery in ") +
        `<w:ins w:id="10" w:author="Reviewer" w:date="2026-11-10T09:00:00Z">${run("May")}</w:ins>` +
        `<w:del w:id="11" w:author="Reviewer" w:date="2026-11-10T09:00:00Z"><w:r><w:delText xml:space="preserve">April</w:delText></w:r></w:del>` +
        run(".") +
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:endnoteReference w:id="1"/></w:r>',
    ),
    para(
      run(
        "Red Georgia words",
        '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="C00000"/>',
      ) +
        '<w:commentRangeStart w:id="1"/>' +
        run(" and more") +
        '<w:commentRangeEnd w:id="1"/>' +
        '<w:r><w:commentReference w:id="1"/></w:r>',
    ),
    para(textBox),
    para('<w:r><w:br w:type="page"/></w:r>'),
    para(run("After the break.")),
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`,
  ].join("");
  return buildDocx({
    body,
    parts: {
      "comments.xml": {
        id: "rIdComments",
        rel: `${REL}/comments`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
        xml: `${XML}<w:comments ${W}>${comment(0, "Please check this number.")}${comment(1, "Second remark.")}</w:comments>`,
      },
      "footnotes.xml": {
        id: "rIdFootnotes",
        rel: `${REL}/footnotes`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
        xml: `${XML}<w:footnotes ${W}>${separators("footnote")}${note("footnote", 1, "Source: internal estimate.")}</w:footnotes>`,
      },
      "endnotes.xml": {
        id: "rIdEndnotes",
        rel: `${REL}/endnotes`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
        xml: `${XML}<w:endnotes ${W}>${separators("endnote")}${note("endnote", 1, "Dates may move.")}</w:endnotes>`,
      },
      "header1.xml": {
        id: "rIdHeader1",
        rel: `${REL}/header`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
        xml: `${XML}<w:hdr ${W}>${para(run("Company header"))}</w:hdr>`,
      },
      "footer1.xml": {
        id: "rIdFooter1",
        rel: `${REL}/footer`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
        xml: `${XML}<w:ftr ${W}>${para(run("Page footer"))}</w:ftr>`,
      },
    },
  });
}

for (const [name, bytes] of Object.entries(fixtures)) {
  writeFileSync(join(here, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

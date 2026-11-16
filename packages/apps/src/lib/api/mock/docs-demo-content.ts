/** Rich markdown fixture for Docs Storybook and mocks (all major block types). */
export const DOCS_DEMO_MARKDOWN = `
# Product brief

Welcome to **Docs**. This page demonstrates the full editor: typography, lists, tasks, quotes, code, tables, and links.

## Typography

One paragraph with *italic*, **bold**, underline from the toolbar, \`inline code\`, and a [link to WeGotWorkspace](https://example.com).

### Bulleted list

- Discovery notes
- Design review
- Ship to Drive

### Numbered list

1. Draft the outline
2. Edit in Docs
3. Auto-save to your files

### Task list

- [ ] Review legal copy
- [x] Approve table layout

> Blockquotes keep feedback readable without shouting.

---

### Code block

\`\`\`ts
export function wordCount(text: string): number {
  return text.split(/\\s+/).filter(Boolean).length;
}
\`\`\`

### Data table

| Quarter | Revenue | Status   |
| ------- | ------- | -------- |
| Q1      | $120k   | On track |
| Q2      | $148k   | Ahead    |
| Q3      | $162k   | Planned  |

---

*Print this sheet to see letter-sized output without chrome.*
`.trim();

/** Plain-text fixture for `.txt` files in Docs Storybook. */
export const DOCS_DEMO_TEXT = `Meeting notes — 12 May

Attendees: Hana, Marco, Ada

Summary
We agreed to ship plain-text editing with the same sheet as markdown.
Line breaks in the file should round-trip through save.

Next steps
- Finalize copy for the release notes
- Add .txt files to the Drive listing
`.trim();

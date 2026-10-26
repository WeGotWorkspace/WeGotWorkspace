Source: #1534 (body-hash: fe10481e)

# Show who is typing in a note's title

The note title is a plain textarea bound to the `note-title` `Y.Text`. It has no collaboration caret plugin, so a remote edit changes the text with no caret or name. This spec adds remote carets to the title, with the same identity and colors as the body.

## Goal

Each participant publishes the caret of the title textarea in Yjs awareness, as Yjs relative positions in the title `Y.Text`. Every other participant maps those positions back to indexes in the current title text and draws a colored caret with the author's name over the textarea.

The work splits into three parts:

1. A pure mapping module (`text-editor-core/docs-collab/docs-collab-title-selection.ts`). It encodes a local selection to awareness JSON, parses remote JSON at the awareness boundary, decodes it back to absolute indexes, and lists the remote carets to draw.
2. A small awareness hook (`note-detail-view/src/use-note-title-carets.ts`). It publishes the local selection while the title has focus, clears it on blur and unmount, and returns the remote carets.
3. A presentational overlay (`note-detail-view/src/note-title-carets.tsx`), plus a thin layer that measures caret pixel positions with a mirror element.

## Non-goals

- No remote selection highlight in the title. The body draws one; the issue asks for a caret and a name.
- No change to the body caret plugin. The body's own-tab behavior is not changed by this work.
- No caret before the title `Y.Text` exists. Creating the type to anchor a caret would make the next save send an empty title (see `writeNoteTitle`).
- No caret for view-only participants. A read-only title does not publish a selection.

## Affected packages

- packages/apps

## Technical constraints

- Awareness field `noteTitleSelection`, separate from the y-prosemirror `cursor` field so the two never collide.
- Identity comes from the awareness `user` field the body already sets (`name`, `color`). A caret without a usable name or color is not drawn.
- Your own account's other tabs are hidden with the rule the presence chrome uses (`mergeCollabPresencePeers`): a remote state whose trimmed, case-insensitive `user.name` equals the local display name is not drawn.
- Remote awareness JSON is untrusted input: parse it, and drop a caret whose position does not resolve into the title `Y.Text`.
- Reading or decoding must not call `doc.getText(NOTE_TITLE_YTEXT_KEY)` while the type is absent.
- The overlay is decorative: `aria-hidden`, no focus, no pointer events. Motion only under `prefers-reduced-motion: no-preference`.
- The caret position follows the textarea's computed font, padding, width, wrapping, and scroll offset (mirror element).

## Edge cases

- Concurrent inserts before a remote caret move that caret with the text (relative positions).
- A remote caret whose text was deleted collapses to the deletion point.
- A peer that blurs the title, leaves the note, or disconnects clears its field or its awareness state; the caret disappears.
- Two accounts with the same display name hide each other's title carets, as the presence chrome already does.
- The title wraps to more lines or scrolls once it reaches `maxRows`; the layer re-measures on resize, scroll, and text changes.

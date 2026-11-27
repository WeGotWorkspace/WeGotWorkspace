// @vitest-environment jsdom
/**
 * Spike 10 (branch spike/yjs-growth, never main): Docs sidecar growth with the
 * real editor. Drives a TipTap editor bound to a Y.Doc through y-tiptap with
 * the same edit script the raw-Yjs model in prototypes/ycsv runs, so the two
 * can be compared one to one, and measures what a rebuild ("compaction")
 * leaves. Prints one JSON line per checkpoint. Opt-in: RUN_GROWTH=1 pnpm exec vitest run --project unit <this file>
 */
import { gzipSync } from "node:zlib";
import { Editor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import type { Mark, MarkType, Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type DocOp,
  type DocView,
  type BlockType,
  NOTES_MIX,
  runSoloScript,
} from "../../../../../prototypes/ycsv/src/yjs-growth/docs-script";
import { createTextEditorExtensions } from "../src/text-editor-extensions";
import { setTextEditorContent } from "../src/text-editor-content";
import { DocsTrackChangesExtension } from "../src/text-editor-track-changes-marks";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";

const RUN = process.env.RUN_GROWTH === "1";

function editorFor(doc: Y.Doc): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false, underline: false }),
      Collaboration.configure({ document: doc }),
      ...createTextEditorExtensions({ format: "markdown" }).filter(
        (ext) => ext.name !== "starterKit",
      ),
      DocsTrackChangesExtension,
    ],
  });
}

function structStats(doc: Y.Doc) {
  let live = 0;
  let deleted = 0;
  let gc = 0;
  for (const list of doc.store.clients.values()) {
    for (const s of list) {
      if (s instanceof Y.GC) gc += 1;
      else if (s instanceof Y.Item) {
        if (s.deleted) deleted += 1;
        else live += 1;
      }
    }
  }
  return { clients: doc.store.clients.size, liveItems: live, deletedItems: deleted, gcStructs: gc };
}

function sizes(doc: Y.Doc) {
  const v1 = Y.encodeStateAsUpdate(doc);
  const v2 = Y.encodeStateAsUpdateV2(doc);
  return {
    v1: v1.byteLength,
    v2: v2.byteLength,
    v1gz: gzipSync(v1).byteLength,
    v2gz: gzipSync(v2).byteLength,
  };
}

/** Start of block `i`'s node, and of its text. */
function blockPos(node: PMNode, i: number): { start: number; text: number; end: number } {
  let pos = 0;
  for (let k = 0; k < i; k += 1) pos += node.child(k).nodeSize;
  const child = node.child(i);
  return { start: pos, text: pos + 1, end: pos + child.nodeSize };
}

class RealDocs {
  readonly doc = new Y.Doc();
  readonly editor: Editor;
  private suggestion: MarkType | null;

  constructor() {
    this.doc.clientID = 1;
    this.editor = editorFor(this.doc);
    const marks = this.editor.schema.marks;
    this.suggestion = Object.values(marks).find((m) => /insert/i.test(m.name)) ?? null;
  }

  view(): DocView {
    const blocks: DocView["blocks"] = [];
    this.editor.state.doc.forEach((node) => {
      blocks.push({
        type: (node.type.name === "heading" ? "heading" : "paragraph") as BlockType,
        len: node.textContent.length,
      });
    });
    return {
      blocks,
      threads: new Map(this.doc.getMap("comments").entries() as Iterable<[string, never]>),
    };
  }

  private mark(name: string, value: Record<string, string> | null): Mark | MarkType {
    const schema = this.editor.schema;
    const type = name === "suggestion" ? this.suggestion : schema.marks[name];
    if (!type) throw new Error(`no mark ${name}`);
    return value === null
      ? type
      : type.create(
          name === "comment"
            ? { id: value.id }
            : name === "link"
              ? { href: value.href }
              : name === "suggestion"
                ? { id: value.id }
                : {},
        );
  }

  apply(op: DocOp): void {
    const { state } = this.editor;
    const schema = state.schema;
    const tr = state.tr;
    switch (op.k) {
      case "insert": {
        const at = blockPos(state.doc, op.block).text + op.offset;
        if (op.marks) {
          const marks = Object.entries(op.marks).map(
            ([name, v]) => this.mark(name, v ?? {}) as Mark,
          );
          tr.insert(at, schema.text(op.text, marks));
        } else tr.insertText(op.text, at);
        break;
      }
      case "delete": {
        const at = blockPos(state.doc, op.block).text + op.offset;
        tr.delete(at, at + op.len);
        break;
      }
      case "format": {
        const t = blockPos(state.doc, op.block).text;
        const m = this.mark(op.mark, op.value);
        if (op.value === null) tr.removeMark(t + op.from, t + op.to, m as MarkType);
        else tr.addMark(t + op.from, t + op.to, m as Mark);
        break;
      }
      case "setType": {
        const p = blockPos(state.doc, op.block);
        const type = op.type === "heading" ? schema.nodes.heading : schema.nodes.paragraph;
        tr.setBlockType(
          p.start,
          p.end,
          type!,
          op.type === "heading" ? { level: op.level ?? 2 } : {},
        );
        break;
      }
      case "split":
        tr.split(blockPos(state.doc, op.block).text + op.offset, 1, [
          { type: schema.nodes.paragraph! },
        ]);
        break;
      case "join":
        tr.join(blockPos(state.doc, op.block).start);
        break;
      case "newBlock": {
        const at =
          op.at < state.doc.childCount ? blockPos(state.doc, op.at).start : state.doc.content.size;
        const type = op.type === "heading" ? schema.nodes.heading! : schema.nodes.paragraph!;
        tr.insert(
          at,
          type.create(
            op.type === "heading" ? { level: 2 } : null,
            op.text ? schema.text(op.text) : null,
          ),
        );
        break;
      }
      case "deleteBlocks": {
        const a = blockPos(state.doc, op.block).start;
        const b = blockPos(state.doc, op.block + op.count - 1).end;
        tr.delete(a, b);
        break;
      }
      case "thread":
        this.doc.transact(() => {
          if (op.value) this.doc.getMap("comments").set(op.id, op.value);
          else this.doc.getMap("comments").delete(op.id);
        }, "local");
        return;
    }
    this.editor.view.dispatch(tr);
  }
}

/** Compaction: the editor's current content (marks, comment anchors) and the comments map into a fresh doc. */
function rebuild(real: RealDocs): Y.Doc {
  const fresh = new Y.Doc();
  fresh.clientID = 7;
  const editor = editorFor(fresh);
  editor.commands.setContent(real.editor.getJSON());
  fresh.transact(() => {
    for (const [k, v] of real.doc.getMap("comments").entries()) fresh.getMap("comments").set(k, v);
  });
  editor.destroy();
  return fresh;
}

const DAYS = Number(process.env.GROWTH_DAYS ?? 260);

describe.skipIf(!RUN)("spike 10: Docs growth with the real editor", () => {
  for (const profile of [
    { name: "living-doc", seed: 11, blocks: 60, actionsPerDay: 60, mix: undefined },
    { name: "notes", seed: 12, blocks: 20, actionsPerDay: 60, mix: NOTES_MIX },
    // A 240-actions-a-day profile ran out of a 4 GB heap in jsdom; the report
    // extrapolates it from living-doc (growth is linear in actions).
  ]) {
    it(`${profile.name}: sizes over 260 workdays`, () => {
      const real = new RealDocs();
      const rows: unknown[] = [];
      const started = performance.now();
      runSoloScript(
        {
          seed: profile.seed,
          blocks: profile.blocks,
          days: DAYS,
          actionsPerDay: profile.actionsPerDay,
          checkpointEvery: 21,
          mix: profile.mix,
        },
        {
          seed: (blocks) => {
            const md = blocks
              .map((b) => (b.type === "heading" ? `## ${b.text}` : b.text))
              .join("\n\n");
            setTextEditorContent(real.editor, md, "markdown");
          },
          newSession: (id) => {
            real.doc.clientID = id;
          },
          view: () => real.view(),
          apply: (op) => real.apply(op),
          checkpoint: (day, actions) => {
            const markdown = readContentFromYDoc(real.doc, "markdown");
            const compacted = rebuild(real);
            const fromText = new Y.Doc();
            applyContentSeedToYDoc(fromText, markdown, "markdown");
            const row = {
              profile: profile.name,
              day,
              actions,
              blocks: real.editor.state.doc.childCount,
              textBytes: new TextEncoder().encode(markdown).byteLength,
              sidecar: sizes(real.doc),
              compacted: sizes(compacted),
              seedFromText: sizes(fromText),
              stats: structStats(real.doc),
              commentsMapV1: (() => {
                const only = new Y.Doc();
                only.transact(() => {
                  for (const [k, v] of real.doc.getMap("comments").entries())
                    only.getMap("comments").set(k, v);
                });
                return Y.encodeStateAsUpdate(only).byteLength;
              })(),
              ms: Math.round(performance.now() - started),
            };
            rows.push(row);
            console.log(JSON.stringify(row));
          },
        },
      );
      // The app's test lint rule forbids node:fs; the JSON lines printed per
      // checkpoint were copied to prototypes/ycsv/results/growth-docs-real-*.json.
      expect(rows.length).toBeGreaterThan(1);
    }, 3_600_000);
  }
});

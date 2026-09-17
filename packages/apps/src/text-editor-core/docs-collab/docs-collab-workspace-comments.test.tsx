import { act, renderHook } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import {
  shouldAutoOpenCommentsForDraft,
  shouldAutoOpenCommentsForThreads,
  type DocsCommentsLayoutMode,
} from "./use-docs-comments-layout";
import { useTestDocsComments as useDocsComments } from "./docs-threads-test-client";

function createEditor(content = "<p>Hello world</p>") {
  const editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark],
    content,
  });
  editor.commands.setTextSelection({ from: 7, to: 12 });
  return editor;
}

type ExplicitDraftComposeOptions = {
  ydoc: Y.Doc;
  editor: Editor;
  initialReviewPanelOpen?: boolean;
};

/** Mirrors explicit comment compose orchestration in docs-collab-workspace.tsx */
function useExplicitDraftCompose({
  ydoc,
  editor,
  initialReviewPanelOpen = false,
}: ExplicitDraftComposeOptions) {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(initialReviewPanelOpen);

  const comments = useDocsComments({
    ydoc,
    editor,
    currentUser: { id: "u-1", name: "Alex" },
    commentsVisible: reviewPanelOpen,
  });

  const {
    draftThread,
    selectionQualifiesForComment,
    openThreads,
    createThreadFromSelection,
    selectThread,
  } = comments;

  const addCommentFromSelection = useCallback(() => {
    setReviewPanelOpen(true);
    if (draftThread) {
      selectThread(draftThread.id);
      return;
    }
    if (selectionQualifiesForComment) {
      createThreadFromSelection();
    }
  }, [createThreadFromSelection, draftThread, selectThread, selectionQualifiesForComment]);

  useEffect(() => {
    if (shouldAutoOpenCommentsForDraft(draftThread)) {
      setReviewPanelOpen(true);
      return;
    }
    if (!shouldAutoOpenCommentsForThreads("sidebar")) return;
    if (openThreads.length > 0) {
      setReviewPanelOpen(true);
    }
  }, [draftThread, openThreads.length]);

  return {
    reviewPanelOpen,
    draftThread,
    selectionQualifiesForComment,
    addCommentFromSelection,
  };
}

/** Mirrors review panel auto-open orchestration in docs-collab-workspace.tsx */
function useReviewPanelAutoOpen({
  commentsLayout = "sidebar" as DocsCommentsLayoutMode,
  openThreadsCount = 0,
  suggestionsCount = 0,
  draftThread = null as ReturnType<typeof useDocsComments>["draftThread"],
  viewSource = false,
} = {}) {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  useEffect(() => {
    if (viewSource) return;
    if (shouldAutoOpenCommentsForDraft(draftThread)) {
      setReviewPanelOpen(true);
      return;
    }
    if (!shouldAutoOpenCommentsForThreads(commentsLayout)) return;
    if (openThreadsCount > 0 || suggestionsCount > 0) {
      setReviewPanelOpen(true);
    }
  }, [commentsLayout, draftThread, openThreadsCount, suggestionsCount, viewSource]);

  return { reviewPanelOpen };
}

/** Mirrors source/review exclusivity in docs-collab-workspace.tsx */
function useSourceCommentsExclusivity({
  initialViewSource = false,
  initialReviewPanelOpen = false,
  initialDraftThread = null as ReturnType<typeof useDocsComments>["draftThread"],
} = {}) {
  const [viewSource, setViewSource] = useState(initialViewSource);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(initialReviewPanelOpen);
  const [draftThread, setDraftThread] = useState(initialDraftThread);

  const handleReviewClose = useCallback(() => {
    setReviewPanelOpen(false);
    setDraftThread(null);
  }, []);

  useEffect(() => {
    if (!viewSource) return;
    if (reviewPanelOpen || draftThread) {
      handleReviewClose();
    }
  }, [draftThread, handleReviewClose, reviewPanelOpen, viewSource]);

  const handleToggleReview = useCallback(() => {
    if (viewSource) return;
    if (reviewPanelOpen) {
      handleReviewClose();
      return;
    }
    setReviewPanelOpen(true);
  }, [handleReviewClose, reviewPanelOpen, viewSource]);

  const handleToggleSource = useCallback(() => {
    if (reviewPanelOpen) return;
    setViewSource((on) => !on);
  }, [reviewPanelOpen]);

  return {
    viewSource,
    reviewPanelOpen,
    draftThread,
    commentsDisabled: viewSource,
    sourceDisabled: reviewPanelOpen,
    handleToggleReview,
    handleToggleSource,
    setViewSource,
    setReviewPanelOpen,
    setDraftThread,
  };
}

describe("docs-collab-workspace review panel default", () => {
  it("stays closed on sidebar tier when there are no threads or suggestions", () => {
    const { result } = renderHook(() =>
      useReviewPanelAutoOpen({
        commentsLayout: "sidebar",
        openThreadsCount: 0,
        suggestionsCount: 0,
      }),
    );

    expect(result.current.reviewPanelOpen).toBe(false);
  });

  it("auto-opens on sidebar tier when open threads exist on load", () => {
    const { result } = renderHook(() =>
      useReviewPanelAutoOpen({
        commentsLayout: "sidebar",
        openThreadsCount: 2,
      }),
    );

    expect(result.current.reviewPanelOpen).toBe(true);
  });

  it("auto-opens on sidebar tier when pending suggestions exist on load", () => {
    const { result } = renderHook(() =>
      useReviewPanelAutoOpen({
        commentsLayout: "sidebar",
        suggestionsCount: 1,
      }),
    );

    expect(result.current.reviewPanelOpen).toBe(true);
  });

  it("does not auto-open on drawer tier even when threads exist", () => {
    const { result } = renderHook(() =>
      useReviewPanelAutoOpen({
        commentsLayout: "drawer",
        openThreadsCount: 3,
        suggestionsCount: 2,
      }),
    );

    expect(result.current.reviewPanelOpen).toBe(false);
  });
});

describe("docs-collab-workspace source/review exclusivity", () => {
  it("closes review panel when source view is enabled", () => {
    const { result } = renderHook(() =>
      useSourceCommentsExclusivity({
        initialReviewPanelOpen: true,
      }),
    );

    expect(result.current.reviewPanelOpen).toBe(true);
    expect(result.current.sourceDisabled).toBe(true);

    act(() => {
      result.current.setReviewPanelOpen(false);
    });
    expect(result.current.sourceDisabled).toBe(false);

    act(() => {
      result.current.setViewSource(true);
    });

    expect(result.current.viewSource).toBe(true);
    expect(result.current.reviewPanelOpen).toBe(false);
    expect(result.current.commentsDisabled).toBe(true);
  });

  it("does not open review from the toggle while source view is active", () => {
    const { result } = renderHook(() =>
      useSourceCommentsExclusivity({
        initialViewSource: true,
      }),
    );

    expect(result.current.commentsDisabled).toBe(true);

    act(() => {
      result.current.handleToggleReview();
    });

    expect(result.current.reviewPanelOpen).toBe(false);
  });

  it("does not enable source while review panel is open", () => {
    const { result } = renderHook(() =>
      useSourceCommentsExclusivity({
        initialReviewPanelOpen: true,
      }),
    );

    expect(result.current.sourceDisabled).toBe(true);

    act(() => {
      result.current.handleToggleSource();
    });

    expect(result.current.viewSource).toBe(false);
  });

  it("closes review panel when source is enabled while a draft exists", () => {
    const { result } = renderHook(() =>
      useSourceCommentsExclusivity({
        initialReviewPanelOpen: true,
        initialDraftThread: { id: "draft-1" } as ReturnType<typeof useDocsComments>["draftThread"],
      }),
    );

    act(() => {
      result.current.setReviewPanelOpen(false);
      result.current.setViewSource(true);
    });

    expect(result.current.viewSource).toBe(true);
    expect(result.current.reviewPanelOpen).toBe(false);
    expect(result.current.draftThread).toBeNull();
  });
});

describe("docs-collab-workspace draft compose", () => {
  it("does not create a draft when text is selected without clicking Comment", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();

    const { result } = renderHook(() =>
      useExplicitDraftCompose({
        ydoc,
        editor,
        initialReviewPanelOpen: false,
      }),
    );

    expect(result.current.selectionQualifiesForComment).toBe(true);
    expect(result.current.draftThread).toBeNull();
    expect(result.current.reviewPanelOpen).toBe(false);

    act(() => {
      editor.destroy();
    });
  });

  it("creates a draft and opens comments when Comment is clicked (drawer tier)", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();

    const { result } = renderHook(() =>
      useExplicitDraftCompose({
        ydoc,
        editor,
        initialReviewPanelOpen: false,
      }),
    );

    act(() => {
      result.current.addCommentFromSelection();
    });

    expect(result.current.draftThread).not.toBeNull();
    expect(result.current.reviewPanelOpen).toBe(true);

    act(() => {
      editor.destroy();
    });
  });

  it("opens comments and focuses an existing draft when Comment is clicked again", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();

    const { result } = renderHook(() =>
      useExplicitDraftCompose({
        ydoc,
        editor,
        initialReviewPanelOpen: false,
      }),
    );

    act(() => {
      result.current.addCommentFromSelection();
    });

    const draftId = result.current.draftThread?.id;
    expect(draftId).toBeTruthy();

    act(() => {
      result.current.addCommentFromSelection();
    });

    expect(result.current.draftThread?.id).toBe(draftId);
    expect(result.current.reviewPanelOpen).toBe(true);

    act(() => {
      editor.destroy();
    });
  });
});

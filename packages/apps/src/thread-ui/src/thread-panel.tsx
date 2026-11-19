import { useMemo, useState } from "react";
import { Button } from "@/button/src/button";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import { continuesChatRun } from "@/chat-ui/src/chat-message-group";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { threadUiLabels } from "@/thread-ui/src/thread-labels";
import { formatThreadTime } from "@/thread-ui/src/thread-time";
import type { ChatAuthorPresenceMap } from "@/lib/models/chat-types";
import type { ThreadClient, ThreadSubjectAdapter } from "@/lib/models/thread-types";
import { useThread, type ThreadViewEntry } from "@/thread-ui/src/use-thread";
import { threadEntryToChatMessage } from "@/thread-ui/src/thread-entry";
import "@/thread-ui/src/thread-panel.css";

export type ThreadPanelProps = {
  client: ThreadClient;
  adapter: ThreadSubjectAdapter;
  /** Username → online/away for the avatar dots; the app reads it from the suite presence. */
  presence?: ChatAuthorPresenceMap;
  className?: string;
};

/**
 * The thread under a subject (#2173 spec, UI): comments in time order, each
 * with one level of replies, and a composer at the foot. It knows nothing
 * about the subject; the adapter says who may post and who can be mentioned.
 * Comments only for now: activity entries are not shown (2026-11-18).
 */
export function ThreadPanel({ client, adapter, presence, className }: ThreadPanelProps) {
  const thread = useThread(client, adapter);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The text of an edit that did not land, put back in a fresh editor so it is not lost. */
  const [editDraft, setEditDraft] = useState<{ id: string; body: string; attempt: number } | null>(
    null,
  );
  const me = adapter.me.id;
  // Enter sends, as in Chat; Shift+Enter starts a new line.
  const shortcut = "↵";
  const principals = useMemo(
    () => adapter.people.filter((person) => person.id !== me),
    [adapter.people, me],
  );

  const actionsFor = (entry: ThreadViewEntry, isRoot: boolean): ChatMessageAction[] | undefined => {
    if (!thread.canPost || entry.pending || entry.failed || entry.deletedAt) return undefined;
    const actions: ChatMessageAction[] = [];
    if (isRoot) actions.push({ id: "reply", onClick: () => setReplyTo(entry.id) });
    actions.push({ id: "react", onClick: () => {} });
    if (entry.author.username === me) {
      actions.push({ id: "edit", onClick: () => setEditing(entry.id) });
      actions.push({ id: "delete", onClick: () => void thread.remove(entry.id) });
    }
    return actions;
  };

  /** Chat's run rule: a follow-up by the same author within 5 minutes hides avatar and name. */
  const runOf = (siblings: readonly ThreadViewEntry[], index: number) => {
    const at = (i: number) => (siblings[i] ? threadEntryToChatMessage(siblings[i]) : null);
    const message = at(index)!;
    const next = at(index + 1);
    return {
      continuation: continuesChatRun(at(index - 1), message),
      beforeContinuation: next != null && continuesChatRun(message, next),
    };
  };

  /** Comments run on as in Chat, but replies in between break the run. */
  const rootRun = (
    roots: readonly { entry: ThreadViewEntry; replies: unknown[] }[],
    index: number,
  ) => {
    const run = runOf(
      roots.map((root) => root.entry),
      index,
    );
    return {
      continuation: run.continuation && roots[index - 1]!.replies.length === 0,
      beforeContinuation: run.beforeContinuation && roots[index]!.replies.length === 0,
    };
  };

  const renderEntry = (
    entry: ThreadViewEntry,
    isRoot: boolean,
    run: { continuation: boolean; beforeContinuation: boolean } = {
      continuation: false,
      beforeContinuation: false,
    },
  ) => (
    <li key={entry.id} className="thread-panel__entry" data-kind={entry.kind}>
      <ChatMessage
        message={threadEntryToChatMessage(entry)}
        continuation={run.continuation}
        className={run.beforeContinuation ? "chat-message--before-continuation" : undefined}
        currentUserId={me}
        presence={presence?.[entry.author.username]}
        // Roots keep chat-ui's Reply action (it opens the reply box); replies have none.
        allowThread={isRoot}
        actions={actionsFor(entry, isRoot)}
        onToggleReaction={
          thread.canPost && !entry.pending && !entry.failed
            ? (emoji) => void thread.react(entry.id, emoji)
            : undefined
        }
        reactionsReadOnly
        htmlAsText
        formatTime={formatThreadTime}
        editing={editing === entry.id}
        editComposer={
          editing === entry.id ? (
            <ChatComposer
              key={`${entry.id}:${editDraft?.id === entry.id ? editDraft.attempt : 0}`}
              initialContent={editDraft?.id === entry.id ? editDraft.body : (entry.body ?? "")}
              principals={principals}
              onSend={({ body }) => {
                if (body === entry.body) {
                  setEditing(null);
                  return;
                }
                void thread.edit(entry.id, body).then((landed) => {
                  if (landed) {
                    setEditing(null);
                    setEditDraft(null);
                  } else {
                    setEditDraft((previous) => ({
                      id: entry.id,
                      body,
                      attempt: (previous?.attempt ?? 0) + 1,
                    }));
                  }
                });
              }}
              onCancel={() => {
                setEditing(null);
                setEditDraft(null);
                thread.clearWriteError();
              }}
            />
          ) : undefined
        }
      />
      {entry.failed ? (
        <div className="thread-panel__failed" role="alert">
          <span className="thread-panel__failed-reason">
            {threadUiLabels.notSent}: {threadUiLabels.failure[entry.failed]}
          </span>
          {entry.failed === "network" ? (
            <Button variant="ghost" size="sm" onClick={() => void thread.retry(entry.id)}>
              {threadUiLabels.retry}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(entry.body ?? "")}
          >
            {threadUiLabels.copyText}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => thread.discard(entry.id)}>
            {threadUiLabels.discard}
          </Button>
        </div>
      ) : null}
    </li>
  );

  return (
    <section
      className={cn("thread-panel", className)}
      aria-label={threadUiLabels.heading}
      data-can-post={thread.canPost ? "true" : "false"}
    >
      <header className="thread-panel__header">
        <h2 className="thread-panel__heading">{threadUiLabels.heading}</h2>
        {thread.status === "ready" && thread.count > 0 ? (
          <Badge
            variant="secondary"
            className="thread-panel__count"
            aria-label={threadUiLabels.count(thread.count)}
          >
            {thread.count}
          </Badge>
        ) : null}
      </header>

      {thread.status === "loading" ? (
        <p className="thread-panel__state">{threadUiLabels.loading}</p>
      ) : thread.status === "offline" ? (
        <p className="thread-panel__state">{threadUiLabels.offline}</p>
      ) : thread.status === "error" ? (
        <p className="thread-panel__state">
          {threadUiLabels.loadFailed}{" "}
          <Button variant="link" size="sm" onClick={() => void thread.refresh()}>
            {threadUiLabels.retryLoad}
          </Button>
        </p>
      ) : thread.status === "gone" ? null : (
        <>
          {thread.lastUpdated !== null ? (
            <p className="thread-panel__state thread-panel__last-updated">
              {threadUiLabels.lastUpdated(formatThreadTime(thread.lastUpdated))}
            </p>
          ) : null}
          {thread.writeError ? (
            <p className="thread-panel__failed-reason" role="alert">
              {threadUiLabels.notSaved}: {threadUiLabels.failure[thread.writeError]}
            </p>
          ) : null}
          {thread.roots.length === 0 ? (
            <p className="thread-panel__state">{threadUiLabels.empty}</p>
          ) : (
            <ol className="thread-panel__list">
              {thread.roots.map(({ entry, replies }, index, roots) => (
                <li key={entry.id} className="thread-panel__root">
                  <ol className="thread-panel__group">
                    {renderEntry(entry, true, rootRun(roots, index))}
                    {replies.length > 0 || replyTo === entry.id ? (
                      <li className="thread-panel__replies">
                        <ol className="thread-panel__group">
                          {replies.map((reply, index) =>
                            renderEntry(reply, false, runOf(replies, index)),
                          )}
                        </ol>
                        {replyTo === entry.id && thread.canPost ? (
                          <ChatComposer
                            className="thread-panel__reply-composer"
                            principals={principals}
                            placeholder={threadUiLabels.replyPlaceholder}
                            submitLabel={threadUiLabels.reply}
                            submitShortcut={shortcut}
                            onSend={({ body, mentions }) => {
                              setReplyTo(null);
                              void thread.post(body, mentions, entry.id);
                            }}
                            onCancel={() => setReplyTo(null)}
                          />
                        ) : null}
                      </li>
                    ) : null}
                  </ol>
                </li>
              ))}
            </ol>
          )}
          {thread.canPost ? (
            <ChatComposer
              className="thread-panel__composer"
              principals={principals}
              placeholder={threadUiLabels.placeholder}
              submitLabel={threadUiLabels.comment}
              submitShortcut={shortcut}
              leading={
                <UserAvatar
                  displayName={adapter.me.displayName}
                  compact
                  size="md"
                  variant="tint"
                  presence={presence?.[me]}
                />
              }
              onSend={({ body, mentions }) => void thread.post(body, mentions)}
            />
          ) : (
            <p className="thread-panel__state thread-panel__read-only">{threadUiLabels.readOnly}</p>
          )}
        </>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { Button } from "@/button/src/button";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";
import { threadUiLabels } from "@/thread-ui/src/thread-labels";
import { formatThreadTime } from "@/thread-ui/src/thread-time";
import type { ThreadClient, ThreadSubjectAdapter } from "@/lib/models/thread-types";
import { useThread, type ThreadViewEntry } from "@/thread-ui/src/use-thread";
import { sendShortcutLabel, threadEntryToChatMessage } from "@/thread-ui/src/thread-entry";
import "@/thread-ui/src/thread-panel.css";

export type ThreadPanelProps = {
  client: ThreadClient;
  adapter: ThreadSubjectAdapter;
  className?: string;
};

/**
 * The thread under a subject (#2173 spec, UI): comments in time order, each
 * with one level of replies, and a composer at the foot. It knows nothing
 * about the subject; the adapter says who may post and who can be mentioned.
 * Comments only for now: activity entries are not shown (2026-11-18).
 */
export function ThreadPanel({ client, adapter, className }: ThreadPanelProps) {
  const thread = useThread(client, adapter);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const me = adapter.me.id;
  const shortcut = sendShortcutLabel();
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

  const renderEntry = (entry: ThreadViewEntry, isRoot: boolean) => (
    <li key={entry.id} className="thread-panel__entry" data-kind={entry.kind}>
      <ChatMessage
        message={threadEntryToChatMessage(entry)}
        currentUserId={me}
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
              initialContent={entry.body ?? ""}
              principals={principals}
              sendKey="mod-enter"
              onSend={({ body }) => {
                setEditing(null);
                if (body !== entry.body) void thread.edit(entry.id, body);
              }}
              onCancel={() => setEditing(null)}
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
          <span className="thread-panel__count">{threadUiLabels.count(thread.count)}</span>
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
          {thread.roots.length === 0 ? (
            <p className="thread-panel__state">{threadUiLabels.empty}</p>
          ) : (
            <ol className="thread-panel__list">
              {thread.roots.map(({ entry, replies }) => (
                <li key={entry.id} className="thread-panel__root">
                  <ol className="thread-panel__group">
                    {renderEntry(entry, true)}
                    {replies.length > 0 || replyTo === entry.id ? (
                      <li className="thread-panel__replies">
                        <ol className="thread-panel__group">
                          {replies.map((reply) => renderEntry(reply, false))}
                        </ol>
                        {replyTo === entry.id && thread.canPost ? (
                          <ChatComposer
                            className="thread-panel__reply-composer"
                            principals={principals}
                            placeholder={threadUiLabels.replyPlaceholder}
                            sendKey="mod-enter"
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
              sendKey="mod-enter"
              submitLabel={threadUiLabels.comment}
              submitShortcut={shortcut}
              leading={
                <UserAvatar displayName={adapter.me.displayName} compact size="md" variant="tint" />
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

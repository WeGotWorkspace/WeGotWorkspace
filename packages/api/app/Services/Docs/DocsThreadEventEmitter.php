<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Events\EventDispatch;
use App\Services\Notify\DocsThreadActivityNotify;

/**
 * Fires docs.thread_activity into the suite notify pipeline from the thread save-path.
 */
final class DocsThreadEventEmitter
{
    public function __construct(
        private readonly EventDispatch $events,
    ) {}

    /**
     * @param  list<string>  $participantUsernames  prior + current authors (actor still filtered by NotifyListener)
     * @param  list<string>  $mentionUsernames  @principals for auto-subscribe (and future docs.mentioned)
     */
    public function posted(
        string $kind,
        string $path,
        string $threadId,
        string $messageId,
        string $actor,
        bool $isReply = false,
        array $participantUsernames = [],
        array $mentionUsernames = [],
        ?string $snippet = null,
    ): void {
        $owners = DocsThreadActivityNotify::pathAclOwnerUsernames($path);
        $recipients = DocsThreadActivityNotify::unionRecipients($owners, $participantUsernames, $mentionUsernames);
        if ($recipients === []) {
            return;
        }

        $this->events->fireMutation(
            $actor,
            'docs',
            DocsThreadActivityNotify::ACTION,
            $path,
            DocsThreadActivityNotify::eventData(
                DocsThreadActivityNotify::actorLabel($actor),
                $path,
                $threadId,
                $messageId,
                $kind,
                $isReply,
                $recipients,
                $snippet,
            ),
        );
    }
}

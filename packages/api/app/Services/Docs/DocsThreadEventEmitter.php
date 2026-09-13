<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Events\DocsThreadPosted;

/**
 * Fires docs.comment_posted / docs.suggestion_posted from the thread save-path.
 */
final class DocsThreadEventEmitter
{
    public function posted(
        string $kind,
        string $path,
        string $threadId,
        string $messageId,
        string $actor,
    ): void {
        $name = $kind === 'suggestion' ? 'docs.suggestion_posted' : 'docs.comment_posted';
        event(new DocsThreadPosted($name, [
            'path' => $path,
            'threadId' => $threadId,
            'messageId' => $messageId,
            'actor' => $actor,
            'kind' => $kind,
        ]));
    }
}

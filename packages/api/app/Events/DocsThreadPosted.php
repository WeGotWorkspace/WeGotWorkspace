<?php

declare(strict_types=1);

namespace App\Events;

/**
 * Local producer event for a new Docs thread message (root or reply).
 *
 * EventDispatch is not on main yet — consume via Laravel's event dispatcher
 * (swap onto EventDispatch::fire when #741 lands). Not on the notify allow-list.
 *
 * @phpstan-type Payload array{path: string, threadId: string, messageId: string, actor: string, kind: string}
 */
final class DocsThreadPosted
{
    /**
     * @param  Payload  $payload
     */
    public function __construct(
        public readonly string $name,
        public readonly array $payload,
    ) {}
}

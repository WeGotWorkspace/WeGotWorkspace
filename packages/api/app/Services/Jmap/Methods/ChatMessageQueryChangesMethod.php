<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * ChatMessage/queryChanges pairs with ChatMessage/query (canCalculateChanges: false);
 * cannotCalculateChanges is the RFC-sanctioned answer.
 */
final class ChatMessageQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'ChatMessage/queryChanges';
    }

    public function capability(): string
    {
        return JmapCapabilities::CHAT;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        throw new JmapMethodException('cannotCalculateChanges', 'ChatMessage/queryChanges is not supported.');
    }
}

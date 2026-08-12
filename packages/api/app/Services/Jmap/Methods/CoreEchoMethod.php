<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;

/**
 * Core/echo (RFC 8620 §4): echoes the arguments back verbatim. Required by
 * the core capability and doubles as the transport-test stub method.
 */
final class CoreEchoMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'Core/echo';
    }

    public function capability(): string
    {
        return JmapCapabilities::CORE;
    }

    public function requiresAccountId(): bool
    {
        return false;
    }

    public function handle(string $username, array $args): array
    {
        return $args;
    }
}

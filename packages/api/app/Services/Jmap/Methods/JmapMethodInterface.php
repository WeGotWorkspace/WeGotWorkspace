<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

/**
 * A JMAP method call handler behind the /jmap dispatcher.
 */
interface JmapMethodInterface
{
    /**
     * Wire method name, e.g. "CalendarEvent/get".
     */
    public function name(): string;

    /**
     * Capability URN that must be present in the request's `using` array;
     * absent capability renders the method unknown (RFC 8620 §3.2).
     */
    public function capability(): string;

    /**
     * Whether the dispatcher must validate args.accountId against the
     * authenticated principal before dispatching (all data methods; not Core/echo).
     */
    public function requiresAccountId(): bool;

    /**
     * Handles the invocation; returns the response arguments object.
     * Method-level failures are thrown as JmapMethodException.
     *
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function handle(string $username, array $args): array;
}

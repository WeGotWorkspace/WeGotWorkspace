<?php

declare(strict_types=1);

namespace App\Services\Notify;

use Illuminate\Cache\RateLimiter;

/**
 * Caps `tasks.assigned` notices (#2172, security review of 2026-11-18).
 *
 * Re-adding someone supersedes the old notice and marks it unread again, and
 * creating tasks with an assignee sends one notice each, over REST, MCP and
 * CalDAV alike. Three budgets per hour stop that from flooding anyone: one per
 * actor and recipient pair, one per actor, and one per recipient. A notice
 * over a budget is dropped; the assignment itself is always stored.
 */
final class TaskAssignedRateLimiter
{
    public const int PAIR_LIMIT = 10;

    public const int ACTOR_LIMIT = 100;

    public const int RECIPIENT_LIMIT = 60;

    private const int DECAY_SECONDS = 3600;

    public function __construct(private readonly RateLimiter $rateLimiter) {}

    /** True, and counted, when `$actor` may notify `$recipient` once more. */
    public function allow(string $actor, string $recipient): bool
    {
        $actor = strtolower(trim($actor));
        $recipient = strtolower(trim($recipient));
        $budgets = [
            'tasks-assigned-pair:'.$actor.'>'.$recipient => self::PAIR_LIMIT,
            'tasks-assigned-actor:'.$actor => self::ACTOR_LIMIT,
            'tasks-assigned-recipient:'.$recipient => self::RECIPIENT_LIMIT,
        ];
        foreach ($budgets as $key => $limit) {
            if ($this->rateLimiter->tooManyAttempts($key, $limit)) {
                return false;
            }
        }
        foreach (array_keys($budgets) as $key) {
            $this->rateLimiter->hit($key, self::DECAY_SECONDS);
        }

        return true;
    }
}

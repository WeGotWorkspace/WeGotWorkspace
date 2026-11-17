<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use Illuminate\Support\Facades\RateLimiter;

/**
 * Logins a user may make to their stored mailbox from a request (save, test,
 * listing its Mailboxes): ten per ten minutes. Each one dials out to the
 * mail server, and the background poller does not count.
 */
final class ImipMailboxLogins
{
    private const PER_WINDOW = 10;

    private const WINDOW_SECONDS = 600;

    /** Counts one login; null when allowed, else the seconds until the next one may run. */
    public function take(string $username): ?int
    {
        $key = 'calendar-reply-mailbox-test:user:'.$username;
        if (RateLimiter::tooManyAttempts($key, self::PER_WINDOW)) {
            return max(1, RateLimiter::availableIn($key));
        }
        RateLimiter::hit($key, self::WINDOW_SECONDS);

        return null;
    }
}

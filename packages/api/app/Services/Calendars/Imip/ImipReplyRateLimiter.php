<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use Illuminate\Cache\RateLimiter;

/**
 * Applied replies per mailbox and per sender within it, counted in the
 * shared cache so the cap holds across scheduler runs. Keys are the mailbox
 * owner and the verified sender, never an unverified header value.
 */
final class ImipReplyRateLimiter
{
    public const MAILBOX_LIMIT = 30;

    public const SENDER_LIMIT = 10;

    private const DECAY_SECONDS = 3600;

    public function __construct(private readonly RateLimiter $limiter) {}

    public function allows(string $owner, string $sender): bool
    {
        return ! $this->limiter->tooManyAttempts($this->mailboxKey($owner), self::MAILBOX_LIMIT)
            && ! $this->limiter->tooManyAttempts($this->senderKey($owner, $sender), self::SENDER_LIMIT);
    }

    public function hit(string $owner, string $sender): void
    {
        $this->limiter->hit($this->mailboxKey($owner), self::DECAY_SECONDS);
        $this->limiter->hit($this->senderKey($owner, $sender), self::DECAY_SECONDS);
    }

    private function mailboxKey(string $owner): string
    {
        return 'calendar-imip-reply:'.strtolower($owner);
    }

    private function senderKey(string $owner, string $sender): string
    {
        return 'calendar-imip-reply:'.strtolower($owner).':'.hash('sha256', strtolower($sender));
    }
}

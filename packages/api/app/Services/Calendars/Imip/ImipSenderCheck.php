<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Outcome of a sender check: the verified From address, the reason code it
 * was not verified, or a deferral (a DNS lookup failed; try again later).
 * `check` names the evidence used: the receiving server's
 * Authentication-Results header, or the message's own DKIM signature.
 */
final readonly class ImipSenderCheck
{
    public const RECEIVING_SERVER = 'receiving_server';

    public const DKIM = 'dkim';

    private function __construct(
        public ?MailAddress $sender,
        public string $reason,
        public string $check,
        public bool $retry = false,
        public string $replayKey = '',
    ) {}

    /**
     * @param  string  $replayKey  cache key that marks the DKIM signature as used; the poller releases it when the reply could not be handled
     */
    public static function verified(MailAddress $sender, string $check = self::RECEIVING_SERVER, string $replayKey = ''): self
    {
        return new self($sender, '', $check, false, $replayKey);
    }

    public static function refused(string $reason, string $check = self::RECEIVING_SERVER): self
    {
        return new self(null, $reason, $check);
    }

    public static function deferred(string $reason, string $check): self
    {
        return new self(null, $reason, $check, true);
    }

    public function ok(): bool
    {
        return $this->sender !== null;
    }
}

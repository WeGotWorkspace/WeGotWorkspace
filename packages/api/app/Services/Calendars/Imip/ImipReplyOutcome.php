<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * What ingest did with one message: `applied`, `unchanged` (a repeat), or
 * `skipped` with a reason code from {@see ImipReplyIngest}.
 */
final readonly class ImipReplyOutcome
{
    public const APPLIED = 'applied';

    public const UNCHANGED = 'unchanged';

    public const SKIPPED = 'skipped';

    private function __construct(
        public string $status,
        public string $reason = '',
        public string $uid = '',
    ) {}

    public static function applied(string $uid): self
    {
        return new self(self::APPLIED, '', $uid);
    }

    public static function unchanged(string $uid): self
    {
        return new self(self::UNCHANGED, '', $uid);
    }

    public static function skipped(string $reason, string $uid = ''): self
    {
        return new self(self::SKIPPED, $reason, $uid);
    }
}

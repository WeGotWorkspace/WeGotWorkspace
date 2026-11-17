<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * Outcome of {@see DkimVerifier}: a passing signature (its domain, signing
 * time and an id for replay checks), a permanent failure with a reason code,
 * a temporary DNS failure, or no signature that was worth checking.
 */
final readonly class DkimResult
{
    public const PASS = 'pass';

    public const FAIL = 'fail';

    public const TEMPERROR = 'temperror';

    public const NONE = 'none';

    public const NO_SIGNATURE = 'dkim_none';

    public const MALFORMED = 'dkim_malformed';

    public const ALGORITHM = 'dkim_algorithm';

    public const EXPIRED = 'dkim_expired';

    public const PARTIAL_BODY = 'dkim_partial_body';

    public const BODY_HASH = 'dkim_body_hash';

    public const KEY_MISSING = 'dkim_key_missing';

    public const KEY_REVOKED = 'dkim_key_revoked';

    public const KEY_TESTING = 'dkim_key_testing';

    public const KEY_INVALID = 'dkim_key_invalid';

    public const SIGNATURE = 'dkim_signature';

    public const DNS_UNAVAILABLE = 'dkim_dns_unavailable';

    private function __construct(
        public string $status,
        public string $reason,
        public string $domain = '',
        public ?int $signedAt = null,
        public string $signatureId = '',
    ) {}

    /**
     * @param  string  $signatureId  hash of the signature value, for replay checks
     */
    public static function pass(string $domain, ?int $signedAt, string $signatureId): self
    {
        return new self(self::PASS, '', $domain, $signedAt, $signatureId);
    }

    public static function fail(string $reason): self
    {
        return new self(self::FAIL, $reason);
    }

    public static function temperror(): self
    {
        return new self(self::TEMPERROR, self::DNS_UNAVAILABLE);
    }

    public static function none(): self
    {
        return new self(self::NONE, self::NO_SIGNATURE);
    }

    public function passed(): bool
    {
        return $this->status === self::PASS;
    }
}

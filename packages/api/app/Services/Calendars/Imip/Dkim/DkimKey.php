<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * One DKIM key record (RFC 6376 3.6.1, RFC 8463 4). `parse()` returns null
 * for a TXT record that is not a DKIM key at all (no `p=`, or a `v=` other
 * than `DKIM1` in first place); `usableFor()` applies the rules that decide
 * whether this key may verify a given signature.
 */
final readonly class DkimKey
{
    public const RSA = 'rsa';

    public const ED25519 = 'ed25519';

    /**
     * @param  list<string>|null  $hashes  `h=`, null when absent
     * @param  list<string>|null  $services  `s=`, null when absent
     * @param  list<string>  $flags  `t=`
     */
    private function __construct(
        public string $type,
        public string $publicKey,
        public ?array $hashes,
        public ?array $services,
        public array $flags,
    ) {}

    public static function parse(string $record): ?self
    {
        $tags = DkimTagList::parse($record);
        if ($tags === null || ! array_key_exists('p', $tags)) {
            return null;
        }
        if (array_key_exists('v', $tags) && ($tags['v'] !== 'DKIM1' || array_key_first($tags) !== 'v')) {
            return null;
        }

        return new self(
            type: strtolower($tags['k'] ?? self::RSA),
            publicKey: DkimTagList::compact($tags['p']),
            hashes: isset($tags['h']) ? DkimTagList::list($tags['h']) : null,
            services: isset($tags['s']) ? DkimTagList::list($tags['s']) : null,
            flags: DkimTagList::list($tags['t'] ?? ''),
        );
    }

    /** Empty string when usable, otherwise the reason code. */
    public function refusal(DkimSignature $signature): string
    {
        if ($this->publicKey === '') {
            return DkimResult::KEY_REVOKED;
        }
        if (in_array('y', $this->flags, true)) {
            return DkimResult::KEY_TESTING;
        }
        $expected = $signature->algorithm === DkimSignature::ED25519_SHA256 ? self::ED25519 : self::RSA;
        if ($this->type !== $expected
            || ($this->hashes !== null && ! in_array('sha256', $this->hashes, true))
            || ($this->services !== null && ! in_array('*', $this->services, true) && ! in_array('email', $this->services, true))
            || (in_array('s', $this->flags, true) && $signature->identityDomain !== $signature->domain)) {
            return DkimResult::KEY_INVALID;
        }

        return '';
    }
}

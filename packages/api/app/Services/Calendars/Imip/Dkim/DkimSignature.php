<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * One DKIM-Signature field (RFC 6376 3.5), checked for syntax only: every
 * required tag present, `h=` signs `from`, `i=` within `d=`, `q=` allows
 * `dns/txt`, `x=` after `t=`. Algorithm support and key rules are the
 * verifier's job.
 */
final readonly class DkimSignature
{
    public const RSA_SHA256 = 'rsa-sha256';

    public const ED25519_SHA256 = 'ed25519-sha256';

    private const MAX_SIGNED_HEADERS = 100;

    /**
     * @param  list<string>  $signedHeaders  lower-case, in `h=` order
     */
    private function __construct(
        public string $algorithm,
        public string $signature,
        public string $bodyHash,
        public string $headerCanonicalization,
        public string $bodyCanonicalization,
        public string $domain,
        public string $selector,
        public array $signedHeaders,
        public string $identityDomain,
        public ?int $bodyLength,
        public ?int $timestamp,
        public ?int $expires,
    ) {}

    /** Null when the field is not a valid signature. */
    public static function parse(string $rawField): ?self
    {
        $tags = DkimTagList::parse(substr($rawField, (int) strpos($rawField, ':') + 1));
        if ($tags === null) {
            return null;
        }
        foreach (['v', 'a', 'b', 'bh', 'd', 'h', 's'] as $required) {
            if (($tags[$required] ?? '') === '') {
                return null;
            }
        }
        if ($tags['v'] !== '1') {
            return null;
        }
        $signature = base64_decode(DkimTagList::compact($tags['b']), true);
        $bodyHash = base64_decode(DkimTagList::compact($tags['bh']), true);
        $canonicalization = self::canonicalization($tags['c'] ?? 'simple/simple');
        $domain = self::domain($tags['d']);
        $signedHeaders = DkimTagList::list($tags['h']);
        $selector = strtolower(DkimTagList::compact($tags['s']));
        $identityDomain = self::identityDomain($tags['i'] ?? '@'.$domain, $domain);
        $bodyLength = self::number($tags['l'] ?? null);
        $timestamp = self::number($tags['t'] ?? null);
        $expires = self::number($tags['x'] ?? null);
        if ($signature === false || $signature === '' || $bodyHash === false || $bodyHash === ''
            || $canonicalization === null || $domain === '' || $selector === '' || $identityDomain === null
            || ! in_array('from', $signedHeaders, true) || count($signedHeaders) > self::MAX_SIGNED_HEADERS
            || $bodyLength === false || $timestamp === false || $expires === false) {
            return null;
        }
        if (isset($tags['q']) && ! in_array('dns/txt', DkimTagList::list($tags['q']), true)) {
            return null;
        }
        if ($timestamp !== null && $expires !== null && $expires <= $timestamp) {
            return null;
        }

        return new self(
            algorithm: strtolower(DkimTagList::compact($tags['a'])),
            signature: $signature,
            bodyHash: $bodyHash,
            headerCanonicalization: $canonicalization[0],
            bodyCanonicalization: $canonicalization[1],
            domain: $domain,
            selector: $selector,
            signedHeaders: $signedHeaders,
            identityDomain: $identityDomain,
            bodyLength: $bodyLength,
            timestamp: $timestamp,
            expires: $expires,
        );
    }

    /**
     * The field with the `b=` value emptied, as it enters the header hash.
     */
    public static function withoutSignatureValue(string $rawField): string
    {
        $colon = (int) strpos($rawField, ':');
        $value = (string) preg_replace('/(^|;)([ \t\r\n]*b[ \t\r\n]*=)[^;]*/', '$1$2', substr($rawField, $colon + 1), 1);

        return substr($rawField, 0, $colon + 1).$value;
    }

    /** @return array{0: string, 1: string}|null */
    private static function canonicalization(string $value): ?array
    {
        $parts = explode('/', strtolower(DkimTagList::compact($value)));
        $header = $parts[0];
        $body = $parts[1] ?? DkimCanonicalizer::SIMPLE;
        $known = [DkimCanonicalizer::SIMPLE, DkimCanonicalizer::RELAXED];

        return count($parts) <= 2 && in_array($header, $known, true) && in_array($body, $known, true)
            ? [$header, $body]
            : null;
    }

    private static function domain(string $value): string
    {
        return rtrim(strtolower(DkimTagList::compact($value)), '.');
    }

    /** The domain of `i=`, when it is `d=` or a subdomain of it. */
    private static function identityDomain(string $value, string $domain): ?string
    {
        $value = DkimTagList::compact($value);
        $at = strrpos($value, '@');
        if ($at === false) {
            return null;
        }
        $identity = self::domain(substr($value, $at + 1));

        return $identity === $domain || str_ends_with($identity, '.'.$domain) ? $identity : null;
    }

    /** Null when absent, false when not a plain decimal that fits. */
    private static function number(?string $value): int|false|null
    {
        if ($value === null) {
            return null;
        }
        $value = DkimTagList::compact($value);

        return ctype_digit($value) && strlen($value) <= 12 ? (int) $value : false;
    }
}

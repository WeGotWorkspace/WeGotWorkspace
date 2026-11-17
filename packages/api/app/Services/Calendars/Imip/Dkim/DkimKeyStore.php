<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

use Illuminate\Contracts\Cache\Repository;

/**
 * Key records at `<selector>._domainkey.<domain>`, cached in the shared
 * cache: a found record for an hour, no record for ten minutes. A failed
 * lookup is never cached, so the next poll asks again.
 */
class DkimKeyStore
{
    public const FOUND_TTL_SECONDS = 3600;

    public const NONE_TTL_SECONDS = 600;

    private const MAX_NAME_LENGTH = 253;

    private const CACHE_PREFIX = 'calendar-imip-dkim-key:';

    public function __construct(
        private readonly DnsTxtResolver $resolver,
        private readonly Repository $cache,
    ) {}

    /** Null when the selector or domain is not a valid DNS name. */
    public function lookup(string $selector, string $domain): ?DnsTxtAnswer
    {
        $name = self::recordName($selector, $domain);
        if ($name === null) {
            return null;
        }
        $key = self::CACHE_PREFIX.hash('sha256', $name);
        $cached = $this->cache->get($key);
        if (is_array($cached) && isset($cached['status'], $cached['records']) && is_array($cached['records'])) {
            return $cached['status'] === DnsTxtAnswer::FOUND
                ? DnsTxtAnswer::found(array_values(array_map('strval', $cached['records'])))
                : DnsTxtAnswer::none();
        }
        $answer = $this->resolver->txt($name);
        if ($answer->status !== DnsTxtAnswer::ERROR) {
            $this->cache->put(
                $key,
                ['status' => $answer->status, 'records' => $answer->records],
                $answer->status === DnsTxtAnswer::FOUND ? self::FOUND_TTL_SECONDS : self::NONE_TTL_SECONDS,
            );
        }

        return $answer;
    }

    /**
     * `<selector>._domainkey.<domain>`, lower-case, when every label is 1 to
     * 63 letters, digits, hyphens or underscores and the whole name fits.
     */
    public static function recordName(string $selector, string $domain): ?string
    {
        $name = strtolower($selector.'._domainkey.'.rtrim($domain, '.'));
        if (strlen($name) > self::MAX_NAME_LENGTH) {
            return null;
        }
        foreach (explode('.', $name) as $label) {
            if (preg_match('/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/', $label) !== 1) {
                return null;
            }
        }

        return $name;
    }
}

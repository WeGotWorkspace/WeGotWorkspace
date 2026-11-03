<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * HTTPS push endpoints whose host is a known push service.
 *
 * Suffix match, so web.push.apple.com is covered by push.apple.com.
 * The host must be the suffix itself or a dotted subdomain of it.
 *
 * EXACT_HOSTS match the whole host only, never a subdomain. Chromium
 * hands out https://jmt17.google.com/fcm/send/… on every channel except
 * Stable (Beta, Dev, Canary, unbranded builds); see
 * components/push_messaging/push_messaging_constants.cc. A google.com
 * suffix would open far more than a push service, so it stays exact.
 */
final class PushEndpointPolicy
{
    /** @var list<string> */
    private const HOST_SUFFIXES = [
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
        'push.services.mozilla.com',
        'push.apple.com',
        'notify.windows.com',
    ];

    /** @var list<string> */
    private const EXACT_HOSTS = [
        'jmt17.google.com',
    ];

    public function isAllowed(string $url): bool
    {
        $parts = parse_url(trim($url));
        if (! is_array($parts)) {
            return false;
        }
        if (strtolower((string) ($parts['scheme'] ?? '')) !== 'https') {
            return false;
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        if (isset($parts['port']) && (int) $parts['port'] !== 443) {
            return false;
        }

        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($host === '' || str_contains($host, '*')) {
            return false;
        }

        if (in_array($host, self::EXACT_HOSTS, true)) {
            return true;
        }

        foreach (self::HOST_SUFFIXES as $suffix) {
            if ($host === $suffix || str_ends_with($host, '.'.$suffix)) {
                return true;
            }
        }

        return false;
    }
}

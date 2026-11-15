<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Decides whether a message's From address is verified, using only the
 * Authentication-Results header (RFC 8601) of the mailbox's receiving server.
 *
 * - The header used is the first (topmost) one whose authserv-id is the
 *   mailbox's trusted server id. Any other copy is ignored.
 * - The message has exactly one From header with exactly one address.
 * - Verified means `dmarc=pass` for the From domain, or `dkim=pass` / `spf=pass`
 *   for a domain aligned with it. Any `dmarc=fail` in that header refuses.
 */
final class ImipSenderAuthentication
{
    public const NO_SENDER = 'sender_invalid';

    public const NO_RESULTS = 'sender_not_verified';

    public function check(MailHeaders $headers, string $trustedServerId): ImipSenderCheck
    {
        $fromHeaders = $headers->all('from');
        $from = count($fromHeaders) === 1 ? MailAddress::fromHeader($fromHeaders[0]) : null;
        if ($from === null) {
            return ImipSenderCheck::refused(self::NO_SENDER);
        }
        $trusted = strtolower(trim($trustedServerId));
        if ($trusted === '') {
            return ImipSenderCheck::refused(self::NO_RESULTS);
        }
        $results = null;
        foreach ($headers->all('authentication-results') as $value) {
            $parsed = AuthenticationResults::parse($value);
            if ($parsed !== null && $parsed->serverId === $trusted) {
                $results = $parsed;
                break;
            }
        }
        if ($results === null) {
            return ImipSenderCheck::refused(self::NO_RESULTS);
        }

        return $this->passes($results, $from->domain())
            ? ImipSenderCheck::verified($from)
            : ImipSenderCheck::refused(self::NO_RESULTS);
    }

    private function passes(AuthenticationResults $results, string $fromDomain): bool
    {
        foreach ($results->methods as $method) {
            if ($method['method'] === 'dmarc' && $method['result'] === 'fail') {
                return false;
            }
        }
        foreach ($results->methods as $method) {
            if ($method['result'] !== 'pass') {
                continue;
            }
            $props = $method['props'];
            $passes = match ($method['method']) {
                'dmarc' => isset($props['header.from']) && self::domainOf($props['header.from']) === $fromDomain,
                'dkim' => self::aligned(self::domainOf($props['header.d'] ?? ($props['header.i'] ?? '')), $fromDomain),
                'spf' => self::aligned(self::domainOf($props['smtp.mailfrom'] ?? ''), $fromDomain),
                default => false,
            };
            if ($passes) {
                return true;
            }
        }

        return false;
    }

    /** `user@example.com`, `@example.com` and `example.com` all give `example.com`. */
    private static function domainOf(string $value): string
    {
        $value = strtolower(trim($value, " \t\"<>"));
        $at = strrpos($value, '@');

        return rtrim($at === false ? $value : substr($value, $at + 1), '.');
    }

    /**
     * Relaxed alignment without a public suffix list: the same domain, or one
     * a subdomain of the other where the parent still has two labels.
     */
    private static function aligned(string $authenticated, string $fromDomain): bool
    {
        if ($authenticated === '' || $fromDomain === '') {
            return false;
        }
        if ($authenticated === $fromDomain) {
            return true;
        }
        [$child, $parent] = strlen($authenticated) > strlen($fromDomain)
            ? [$authenticated, $fromDomain]
            : [$fromDomain, $authenticated];

        return substr_count($parent, '.') >= 1 && str_ends_with($child, '.'.$parent);
    }
}

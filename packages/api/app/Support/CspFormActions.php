<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Per-request extra `form-action` sources, resolved as a container singleton like
 * {@see CspNonce}. Only the OAuth consent page adds one: CSP checks the redirect
 * after a form POST against `form-action`, so Allow / Deny must be able to land
 * on the client's validated redirect URI.
 */
final class CspFormActions
{
    /** @var list<string> */
    private array $sources = [];

    /**
     * Allow the origin of $url (or its scheme, for a custom-scheme app callback).
     * Anything that is not a plain origin is ignored, so it cannot widen the policy.
     */
    public function allowRedirectTo(string $url): void
    {
        $source = self::sourceFor($url);
        if ($source !== null && ! in_array($source, $this->sources, true)) {
            $this->sources[] = $source;
        }
    }

    /**
     * @return list<string>
     */
    public function sources(): array
    {
        return $this->sources;
    }

    private static function sourceFor(string $url): ?string
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ! isset($parts['scheme'])) {
            return null;
        }
        $scheme = strtolower($parts['scheme']);
        if (preg_match('/^[a-z][a-z0-9+.-]*$/', $scheme) !== 1) {
            return null;
        }
        if ($scheme !== 'http' && $scheme !== 'https') {
            return in_array($scheme, ['javascript', 'data', 'blob', 'filesystem'], true) ? null : $scheme.':';
        }
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (preg_match('/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/', $host) !== 1) {
            return null;
        }
        $source = $scheme.'://'.$host;
        if (isset($parts['port'])) {
            $source .= ':'.$parts['port'];
        }

        return $source;
    }
}

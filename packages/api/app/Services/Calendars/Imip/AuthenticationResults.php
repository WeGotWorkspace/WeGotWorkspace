<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * One Authentication-Results header value (RFC 8601 2.2): the authserv-id
 * and each `method=result` with its `ptype.property=value` pairs. Comments
 * are dropped; a reason (`reason="..."`) is ignored.
 */
final readonly class AuthenticationResults
{
    /**
     * @param  list<array{method: string, result: string, props: array<string, string>}>  $methods
     */
    public function __construct(
        public string $serverId,
        public array $methods,
    ) {}

    public static function parse(string $value): ?self
    {
        $clean = self::stripComments($value);
        if ($clean === null) {
            return null;
        }
        $parts = self::splitOutsideQuotes($clean, ';');
        $head = preg_split('/\s+/', trim(array_shift($parts) ?? '')) ?: [];
        $serverId = strtolower($head[0] ?? '');
        if ($serverId === '' || preg_match('/^[a-z0-9._-]+$/', $serverId) !== 1) {
            return null;
        }
        $methods = [];
        foreach ($parts as $part) {
            $tokens = preg_split('/\s+/', trim($part)) ?: [];
            $first = array_shift($tokens) ?? '';
            if (preg_match('/^([a-z0-9_-]+)(?:\/\d+)?=([a-z0-9_-]+)$/i', $first, $match) !== 1) {
                continue;
            }
            $props = [];
            foreach ($tokens as $token) {
                if (preg_match('/^([a-z0-9_-]+\.[a-z0-9_-]+)=(.+)$/i', $token, $prop) === 1) {
                    $props[strtolower($prop[1])] ??= trim($prop[2], '"');
                }
            }
            $methods[] = [
                'method' => strtolower($match[1]),
                'result' => strtolower($match[2]),
                'props' => $props,
            ];
        }

        return new self($serverId, $methods);
    }

    private static function stripComments(string $value): ?string
    {
        $out = '';
        $depth = 0;
        $quoted = false;
        $length = strlen($value);
        for ($i = 0; $i < $length; $i++) {
            $char = $value[$i];
            if ($char === '\\') {
                if ($depth === 0) {
                    $out .= $char.($value[$i + 1] ?? '');
                }
                $i++;

                continue;
            }
            if ($depth === 0 && $char === '"') {
                $quoted = ! $quoted;
                $out .= $char;

                continue;
            }
            if (! $quoted && $char === '(') {
                $depth++;

                continue;
            }
            if (! $quoted && $char === ')' && $depth > 0) {
                $depth--;
                $out .= ' ';

                continue;
            }
            if ($depth === 0) {
                $out .= $char;
            }
        }

        return ($depth !== 0 || $quoted) ? null : $out;
    }

    /**
     * @return list<string>
     */
    private static function splitOutsideQuotes(string $value, string $separator): array
    {
        $parts = [];
        $current = '';
        $quoted = false;
        $length = strlen($value);
        for ($i = 0; $i < $length; $i++) {
            $char = $value[$i];
            if ($char === '"') {
                $quoted = ! $quoted;
            }
            if (! $quoted && $char === $separator) {
                $parts[] = $current;
                $current = '';

                continue;
            }
            $current .= $char;
        }
        $parts[] = $current;

        return $parts;
    }
}

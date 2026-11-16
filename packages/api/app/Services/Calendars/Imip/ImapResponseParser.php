<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Turns one logical IMAP response line (literals inline, as received) into
 * nested PHP values: lists are arrays, NIL is null, atoms, quoted strings and
 * literals are strings. A `BODY[...]` atom keeps its bracketed section.
 */
final class ImapResponseParser
{
    private const MAX_DEPTH = 32;

    /**
     * @return list<mixed>
     */
    public static function parse(string $raw): array
    {
        $pos = 0;
        $values = self::parseList($raw, $pos, false, 0);
        $pos = strlen($raw);

        return $values;
    }

    /**
     * @return list<mixed>
     */
    private static function parseList(string $raw, int &$pos, bool $nested, int $depth): array
    {
        if ($depth > self::MAX_DEPTH) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server response nests too deeply.');
        }
        $values = [];
        $length = strlen($raw);
        while ($pos < $length) {
            $char = $raw[$pos];
            if ($char === ' ' || $char === "\r" || $char === "\n") {
                $pos++;

                continue;
            }
            if ($char === ')') {
                if (! $nested) {
                    throw new ImapException(ImapException::PROTOCOL_ERROR, 'Unbalanced parenthesis in a mail server response.');
                }
                $pos++;

                return $values;
            }
            if ($char === '(') {
                $pos++;
                $values[] = self::parseList($raw, $pos, true, $depth + 1);

                continue;
            }
            if ($char === '"') {
                $values[] = self::parseQuoted($raw, $pos);

                continue;
            }
            if ($char === '{') {
                $values[] = self::parseLiteral($raw, $pos);

                continue;
            }
            $atom = self::parseAtom($raw, $pos);
            $values[] = strtoupper($atom) === 'NIL' ? null : $atom;
        }
        if ($nested) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'Unbalanced parenthesis in a mail server response.');
        }

        return $values;
    }

    private static function parseQuoted(string $raw, int &$pos): string
    {
        $pos++;
        $out = '';
        $length = strlen($raw);
        while ($pos < $length) {
            $char = $raw[$pos];
            if ($char === '\\' && $pos + 1 < $length) {
                $out .= $raw[$pos + 1];
                $pos += 2;

                continue;
            }
            if ($char === '"') {
                $pos++;

                return $out;
            }
            $out .= $char;
            $pos++;
        }

        throw new ImapException(ImapException::PROTOCOL_ERROR, 'Unterminated string in a mail server response.');
    }

    private static function parseLiteral(string $raw, int &$pos): string
    {
        if (preg_match('/\G\{(\d{1,9})\+?\}\r\n/', $raw, $match, 0, $pos) !== 1) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'Malformed literal in a mail server response.');
        }
        $size = (int) $match[1];
        $start = $pos + strlen($match[0]);
        if ($start + $size > strlen($raw)) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'Truncated literal in a mail server response.');
        }
        $pos = $start + $size;

        return substr($raw, $start, $size);
    }

    private static function parseAtom(string $raw, int &$pos): string
    {
        $start = $pos;
        $length = strlen($raw);
        while ($pos < $length) {
            $char = $raw[$pos];
            if ($char === '[') {
                $close = strpos($raw, ']', $pos);
                if ($close === false) {
                    throw new ImapException(ImapException::PROTOCOL_ERROR, 'Unterminated section in a mail server response.');
                }
                $pos = $close + 1;

                continue;
            }
            if ($char === ' ' || $char === '(' || $char === ')' || $char === "\r" || $char === "\n") {
                break;
            }
            $pos++;
        }

        return substr($raw, $start, $pos - $start);
    }
}

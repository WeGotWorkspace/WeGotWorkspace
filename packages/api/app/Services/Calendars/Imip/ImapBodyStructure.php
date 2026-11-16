<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Finds the calendar part in a parsed BODYSTRUCTURE (RFC 3501 7.4.2), so
 * only that section is downloaded. Attached messages (`message/rfc822`) are
 * not searched: a forwarded reply is not a reply from its forwarder.
 */
final class ImapBodyStructure
{
    private const MAX_PARTS = 64;

    /**
     * @param  array<mixed>  $structure
     */
    public static function calendarPart(array $structure): ?ImapCalendarPart
    {
        $found = null;
        $budget = self::MAX_PARTS;
        self::walk($structure, '', $found, $budget);

        return $found;
    }

    /**
     * @param  array<mixed>  $node
     */
    private static function walk(array $node, string $prefix, ?ImapCalendarPart &$found, int &$budget): void
    {
        if ($found !== null || --$budget < 0) {
            return;
        }
        if (is_array($node[0] ?? null)) {
            $index = 1;
            foreach ($node as $child) {
                if (! is_array($child)) {
                    break;
                }
                self::walk($child, $prefix === '' ? (string) $index : $prefix.'.'.$index, $found, $budget);
                $index++;
            }

            return;
        }

        $type = strtolower(is_string($node[0] ?? null) ? $node[0] : '');
        $subtype = strtolower(is_string($node[1] ?? null) ? $node[1] : '');
        $isCalendar = ($type === 'text' && $subtype === 'calendar')
            || ($type === 'application' && $subtype === 'ics');
        if (! $isCalendar) {
            return;
        }
        $params = self::params($node[2] ?? null);
        $found = new ImapCalendarPart(
            section: $prefix === '' ? '1' : $prefix,
            encoding: strtolower(is_string($node[5] ?? null) ? $node[5] : '7bit'),
            charset: strtolower($params['charset'] ?? 'utf-8'),
            method: strtoupper($params['method'] ?? ''),
            size: is_string($node[6] ?? null) && ctype_digit($node[6]) ? (int) $node[6] : 0,
        );
    }

    /**
     * @return array<string, string>
     */
    private static function params(mixed $list): array
    {
        if (! is_array($list)) {
            return [];
        }
        $params = [];
        for ($i = 0; $i + 1 < count($list); $i += 2) {
            if (is_string($list[$i]) && is_string($list[$i + 1])) {
                $params[strtolower($list[$i])] = $list[$i + 1];
            }
        }

        return $params;
    }
}

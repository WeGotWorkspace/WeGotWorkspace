<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * One bundled admin notice per day when peers could not get a direct path.
 * Facts are usernames and Meet, Docs, or Presence. Network class stays out.
 */
final class RtcDirectConnectNotify
{
    public const DOMAIN = 'rtc';

    public const ACTION = 'direct_connect';

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $count = is_numeric($data['count'] ?? null) ? (int) $data['count'] : 0;
        $parts = [];
        $people = $data['people'] ?? [];
        if (is_array($people)) {
            foreach ($people as $person) {
                if (! is_array($person)) {
                    continue;
                }
                $name = trim((string) ($person['name'] ?? ''));
                $where = trim((string) ($person['where'] ?? ''));
                if ($name === '' || $where === '') {
                    continue;
                }
                $parts[] = $name.' ('.$where.')';
            }
        }

        return [
            'title' => $count." people couldn't connect directly to a call or document today.",
            'body' => $parts === [] ? null : implode(', ', $parts),
        ];
    }
}

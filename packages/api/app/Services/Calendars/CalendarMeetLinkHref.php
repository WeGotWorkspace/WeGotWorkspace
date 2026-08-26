<?php

declare(strict_types=1);

namespace App\Services\Calendars;

/**
 * Same-origin Meet guest/join URL parse. Origin equality only — no includes/startsWith.
 */
final class CalendarMeetLinkHref
{
    public const ROOM_CODE_PATTERN = '/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/';

    /** @var list<string> */
    private const JOIN_PATHS = ['/meet/guest', '/meet/join'];

    public function workspaceOrigin(): ?string
    {
        return $this->origin((string) config('app.url'));
    }

    public function origin(string $url): ?string
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }
        $scheme = strtolower((string) $parts['scheme']);
        $host = strtolower((string) $parts['host']);
        if ($scheme === '' || $host === '') {
            return null;
        }
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';

        return $scheme.'://'.$host.$port;
    }

    public function parseWgwRoom(string $href): ?string
    {
        $hrefOrigin = $this->origin($href);
        $configured = $this->workspaceOrigin();
        if ($hrefOrigin === null || $configured === null || $hrefOrigin !== $configured) {
            return null;
        }

        $parts = parse_url($href);
        if (! is_array($parts)) {
            return null;
        }

        $path = '/'.trim((string) ($parts['path'] ?? ''), '/');
        if (! in_array($path, self::JOIN_PATHS, true)) {
            return null;
        }

        $query = [];
        parse_str((string) ($parts['query'] ?? ''), $query);
        $room = isset($query['room']) && is_string($query['room']) ? strtolower(trim($query['room'])) : '';
        if ($room === '' || preg_match(self::ROOM_CODE_PATTERN, $room) !== 1) {
            return null;
        }

        return $room;
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * TXT lookups through the system resolver (`dns_get_record`). It works
 * under `open_basedir` and needs no extension. It has no per-call timeout:
 * the system resolver's own timeout applies, and the poller stops at the
 * first failed lookup, so one poll waits on at most one of them.
 *
 * `false` from `dns_get_record` is a resolver failure (temporary or not);
 * an empty array is no record. A CNAME is followed by the resolver, and
 * only the TXT records of the answer are returned.
 */
final class SystemDnsTxtResolver implements DnsTxtResolver
{
    public function txt(string $name): DnsTxtAnswer
    {
        try {
            $records = @dns_get_record($name.'.', DNS_TXT);
        } catch (\Throwable) {
            return DnsTxtAnswer::error();
        }
        if ($records === false) {
            return DnsTxtAnswer::error();
        }
        $texts = [];
        foreach ($records as $record) {
            if (($record['type'] ?? null) !== 'TXT') {
                continue;
            }
            $entries = $record['entries'] ?? null;
            $texts[] = is_array($entries)
                ? implode('', array_map('strval', $entries))
                : (string) ($record['txt'] ?? '');
        }

        return DnsTxtAnswer::found($texts);
    }
}

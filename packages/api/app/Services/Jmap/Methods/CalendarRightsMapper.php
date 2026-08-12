<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

/**
 * Maps the REST layer's 4-property myRights (backed by Sabre's 3-level
 * access column) onto the JMAP calendars draft's 8-property CalendarRights
 * (spec §6). The REST flags fully determine the 8-property row:
 * read-only (access=2) has mayWrite=false; read-write (access=3) and owner
 * differ only in mayDelete; mayShare is always false today.
 */
final class CalendarRightsMapper
{
    /**
     * @param  array<string, mixed>  $calendar  REST-shaped calendar object
     * @return array<string, mixed>
     */
    public static function remap(array $calendar): array
    {
        $rest = is_array($calendar['myRights'] ?? null) ? $calendar['myRights'] : [];
        $mayWrite = (bool) ($rest['mayWrite'] ?? false);

        $calendar['myRights'] = [
            'mayReadFreeBusy' => true,
            'mayReadItems' => true,
            'mayWriteAll' => $mayWrite,
            'mayWriteOwn' => $mayWrite,
            'mayUpdatePrivate' => $mayWrite,
            'mayRSVP' => $mayWrite,
            'mayShare' => (bool) ($rest['mayShare'] ?? false),
            'mayDelete' => (bool) ($rest['mayDelete'] ?? false),
        ];

        return $calendar;
    }
}

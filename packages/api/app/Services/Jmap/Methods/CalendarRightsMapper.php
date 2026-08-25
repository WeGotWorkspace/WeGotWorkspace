<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

/**
 * Maps the REST layer's 4-property myRights (backed by Sabre's 3-level
 * access column) onto the JMAP calendars draft's 8-property CalendarRights
 * (spec §6). The REST flags fully determine the 8-property row:
 * read-only (access=2) has mayWrite=false; read-write (access=3) and owner
 * differ in mayShare (personal owners only) and mayDelete.
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
        $calendar['myRights'] = self::jmapRights($rest);

        $shareWith = $calendar['shareWith'] ?? null;
        if (is_array($shareWith)) {
            $mapped = [];
            foreach ($shareWith as $id => $rights) {
                $mapped[$id] = is_array($rights) ? self::jmapRights($rights) : $rights;
            }
            $calendar['shareWith'] = $mapped;
        }

        return $calendar;
    }

    /**
     * @param  array<string, mixed>  $rest
     * @return array<string, bool>
     */
    private static function jmapRights(array $rest): array
    {
        $mayWrite = (bool) ($rest['mayWrite'] ?? $rest['mayWriteAll'] ?? false);

        return [
            'mayReadFreeBusy' => true,
            'mayReadItems' => true,
            'mayWriteAll' => $mayWrite,
            'mayWriteOwn' => $mayWrite,
            'mayUpdatePrivate' => $mayWrite,
            'mayRSVP' => $mayWrite,
            'mayShare' => (bool) ($rest['mayShare'] ?? false),
            'mayDelete' => (bool) ($rest['mayDelete'] ?? false),
        ];
    }
}

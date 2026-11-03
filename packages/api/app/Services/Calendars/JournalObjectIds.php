<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarObject;

/**
 * Id-only listing of the VJOURNAL objects in one calendar collection, for
 * the Note/query and ChatMessage/query id pages. Reads the `uid` column the
 * explicit-id `/get` paths look objects up by, without parsing any body.
 */
final class JournalObjectIds
{
    /**
     * @return list<string> uids in storage order (object id)
     */
    public function inCalendar(int $calendarId): array
    {
        $ids = [];
        $uids = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('componenttype', 'VJOURNAL')
            ->orderBy('id')
            ->pluck('uid');
        foreach ($uids as $uid) {
            if (is_string($uid) && $uid !== '') {
                $ids[] = $uid;
            }
        }

        return $ids;
    }
}

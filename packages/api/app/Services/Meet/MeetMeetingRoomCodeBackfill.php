<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Services\Calendars\CalendarMeetLinkHref;
use App\Services\Chat\ChatCollectionUris;
use RuntimeException;

/**
 * Assigns an ad-hoc room code to meeting channels that only have a name slug.
 * The collection uri stays put (`chat-standup`); hosts share the new
 * `/meet/meetings/{code}` link. The old slug stays members-only.
 */
final class MeetMeetingRoomCodeBackfill
{
    public function assignMissing(): int
    {
        $ids = ChatChannelMeta::query()
            ->where('kind', ChatChannelMeta::KIND_MEETING)
            ->where(function ($query): void {
                $query->whereNull('room_code')->orWhere('room_code', '');
            })
            ->pluck('calendarid');

        $assigned = 0;
        foreach ($ids as $calendarId) {
            $code = $this->mint();
            $updated = ChatChannelMeta::query()
                ->where('calendarid', $calendarId)
                ->where(function ($query): void {
                    $query->whereNull('room_code')->orWhere('room_code', '');
                })
                ->update(['room_code' => $code]);
            $assigned += $updated;
        }

        return $assigned;
    }

    private function mint(): string
    {
        $alphabet = CalendarMeetLinkHref::ROOM_CODE_ALPHABET;
        $last = strlen($alphabet) - 1;
        for ($attempt = 0; $attempt < 8; $attempt++) {
            $raw = '';
            for ($i = 0; $i < 12; $i++) {
                $raw .= $alphabet[random_int(0, $last)];
            }
            $code = substr($raw, 0, 4).'-'.substr($raw, 4, 4).'-'.substr($raw, 8, 4);
            $uri = ChatCollectionUris::PREFIX_CHANNEL.$code;
            $codeTaken = ChatChannelMeta::query()->where('room_code', $code)->exists();
            $uriTaken = CalendarInstance::query()->where('uri', $uri)->exists();
            if (! $codeTaken && ! $uriTaken) {
                return $code;
            }
        }

        throw new RuntimeException('Could not allocate a meeting room code.');
    }
}

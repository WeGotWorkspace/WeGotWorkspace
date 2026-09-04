<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Object-level changes for one chat collection on top of Sabre's
 * getChangesForCalendar — the same path NoteRepository::changes uses, but with
 * honest paging: chat volume can exceed one page, so hasMoreChanges reflects
 * the backend's `result_truncated` flag instead of Notes' hardcoded false.
 *
 * Paging contract (verified by ChatChangesFeedSpikeTest): the backend fetches
 * limit+1 changelog rows ordered by synctoken, flags truncation, and returns a
 * syncToken that resumes exactly after the last processed row — so repeating
 * the request with newState until hasMoreChanges is false drains the feed
 * without loss or duplication.
 */
final class ChatChangesFeed
{
    public const DEFAULT_LIMIT = 200;

    /**
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>, hasMoreChanges: bool}
     */
    public function changes(CalendarInstance $instance, ?string $since, int $limit = self::DEFAULT_LIMIT): array
    {
        $syncToken = $this->normalizeSyncToken($since);

        $changes = $this->calBackend()->getChangesForCalendar(
            [(int) $instance->calendarid, (int) $instance->id],
            $syncToken,
            1,
            $limit,
        );
        if ($changes === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return [
            'oldState' => ($since === null || $since === '') ? '0' : $since,
            'newState' => (string) $changes['syncToken'],
            'created' => $this->uidsForUris((int) $instance->calendarid, $changes['added'] ?? []),
            'updated' => $this->uidsForUris((int) $instance->calendarid, $changes['modified'] ?? []),
            'destroyed' => $this->destroyedUids($changes['deleted'] ?? []),
            'hasMoreChanges' => ($changes['result_truncated'] ?? false) === true,
        ];
    }

    private function normalizeSyncToken(?string $since): ?int
    {
        if ($since === null || $since === '' || $since === '0') {
            return null;
        }
        if (! ctype_digit($since)) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return (int) $since;
    }

    /**
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function uidsForUris(int $calendarId, array $uris): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $object = CalendarObject::query()
                ->where('calendarid', $calendarId)
                ->where('uri', $uri)
                ->first(['uid']);
            if ($object !== null && is_string($object->uid) && $object->uid !== '') {
                $uids[] = (string) $object->uid;
            }
        }

        return $uids;
    }

    /**
     * Deleted objects are gone; uid is recovered from the `{uid}.ics` href
     * (chat creates always write that convenience name, like Notes).
     *
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function destroyedUids(array $uris): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $uids[] = str_ends_with($uri, '.ics') ? substr($uri, 0, -4) : $uri;
        }

        return array_values(array_unique($uids));
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}

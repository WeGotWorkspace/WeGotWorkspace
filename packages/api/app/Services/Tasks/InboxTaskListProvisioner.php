<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\CalendarColorPalette;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Ensures each user principal has a VTODO-only Inbox task list ({@see self::URI}).
 */
final class InboxTaskListProvisioner
{
    public const URI = 'inbox';

    public const DISPLAY_NAME = 'Inbox';

    /**
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllUsers(): array
    {
        if (! Schema::connection('wgw')->hasTable('users') || ! Schema::connection('wgw')->hasTable('calendars')) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        User::query()
            ->orderBy('id')
            ->pluck('username')
            ->each(function (mixed $username) use (&$scanned, &$created, &$skipped): void {
                $username = strtolower(trim((string) $username));
                if ($username === '') {
                    return;
                }

                $scanned++;
                if ($this->ensureForPrincipal('principals/'.$username)) {
                    $created++;
                } else {
                    $skipped++;
                }
            });

        return [
            'scanned' => $scanned,
            'created' => $created,
            'skipped' => $skipped,
        ];
    }

    public function ensureForPrincipal(string $principalUri): bool
    {
        if (! Schema::connection('wgw')->hasTable('calendars')) {
            return false;
        }

        if ($this->hasInboxCalendar($principalUri)) {
            return false;
        }

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, self::URI, [
            '{DAV:}displayname' => self::DISPLAY_NAME,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
            CalendarColorPalette::PROPERTY => CalendarColorPalette::forUri(self::URI),
        ]);

        return true;
    }

    public function hasInboxCalendar(string $principalUri): bool
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());

        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            if (($calendar['uri'] ?? '') === self::URI) {
                return true;
            }
        }

        return false;
    }

    /**
     * Resolve a user principal URI from a username, or null when no principal row exists.
     */
    public function principalUriForUsername(string $username): ?string
    {
        $principal = Principal::forUsername($username);

        return $principal !== null ? (string) $principal->uri : null;
    }
}

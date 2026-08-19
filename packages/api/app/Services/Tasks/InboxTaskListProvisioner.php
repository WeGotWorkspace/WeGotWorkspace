<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Ensures each user principal has a VTODO-only Inbox task list ({@see self::URI}).
 *
 * The CalDAV collection uri is {@see CalendarCollectionUris::TASK_INBOX} (`tasks-inbox`).
 * REST still exposes {@code role: inbox}. Sabre reserves the name {@code inbox} for the
 * RFC 6638 schedule-inbox.
 */
final class InboxTaskListProvisioner
{
    public const URI = CalendarCollectionUris::TASK_INBOX;

    public const LEGACY_URI = CalendarCollectionUris::LEGACY_TASK_INBOX;

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

        $this->migrateLegacyInboxUri($principalUri);

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

    /**
     * Rename a pre-#482 VTODO collection uri {@see self::LEGACY_URI} to {@see self::URI}.
     */
    public function migrateLegacyInboxUri(string $principalUri): bool
    {
        if (! Schema::connection('wgw')->hasTable('calendarinstances')) {
            return false;
        }

        if ($this->hasInboxCalendar($principalUri)) {
            return false;
        }

        $legacy = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', self::LEGACY_URI)
            ->first();

        if ($legacy === null || $legacy->calendar === null || ! $legacy->calendar->isVtodoOnly()) {
            return false;
        }

        $legacy->uri = self::URI;
        $legacy->save();

        return true;
    }

    /**
     * Reverse {@see self::migrateLegacyInboxUri}: {@see self::URI} → {@see self::LEGACY_URI}.
     * Skips when {@see self::LEGACY_URI} already exists (collision — keep tasks visible).
     */
    public function revertTasksInboxUri(string $principalUri): bool
    {
        if (! Schema::connection('wgw')->hasTable('calendarinstances')) {
            return false;
        }

        $current = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', self::URI)
            ->first();

        if ($current === null || $current->calendar === null || ! $current->calendar->isVtodoOnly()) {
            return false;
        }

        $collision = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', self::LEGACY_URI)
            ->exists();
        if ($collision) {
            return false;
        }

        $current->uri = self::LEGACY_URI;
        $current->save();

        return true;
    }

    /**
     * @return array{scanned: int, reverted: int, skipped: int}
     */
    public function revertForAllUsers(): array
    {
        if (! Schema::connection('wgw')->hasTable('users') || ! Schema::connection('wgw')->hasTable('calendarinstances')) {
            return ['scanned' => 0, 'reverted' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $reverted = 0;
        $skipped = 0;

        User::query()
            ->orderBy('id')
            ->pluck('username')
            ->each(function (mixed $username) use (&$scanned, &$reverted, &$skipped): void {
                $username = strtolower(trim((string) $username));
                if ($username === '') {
                    return;
                }

                $scanned++;
                if ($this->revertTasksInboxUri('principals/'.$username)) {
                    $reverted++;
                } else {
                    $skipped++;
                }
            });

        return [
            'scanned' => $scanned,
            'reverted' => $reverted,
            'skipped' => $skipped,
        ];
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

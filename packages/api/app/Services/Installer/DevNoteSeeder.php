<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Models\User;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\Conversion\NoteJournalConverter;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Writes deterministic VJOURNAL notes onto a local-dev user's notebooks.
 *
 * Uses CalDAV PDO (not NoteRepository) so search indexing stays best-effort and
 * create stays fast for ~1000 rows — same approach as {@see DevCalendarEventSeeder}.
 */
final class DevNoteSeeder
{
    private const COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    public function __construct(
        private readonly DevNoteCatalog $catalog,
        private readonly NoteJournalConverter $converter,
        private readonly UserCalendarCollectionsProvisioner $collections,
        private readonly DevSeedGuard $guard,
    ) {}

    public function isAllowed(): bool
    {
        return $this->guard->isAllowed();
    }

    /**
     * @return array{created: int, skipped: int, deleted: int, starred: int, notebooks: int}
     */
    public function seed(
        string $username,
        string $profile = DevNoteCatalog::PROFILE_FULL,
        bool $force = false,
        ?DateTimeImmutable $now = null,
    ): array {
        $this->guard->assertAllowed('notes');

        $username = strtolower(trim($username));
        if ($username === '' || User::query()->where('username', $username)->doesntExist()) {
            throw new RuntimeException('Cannot seed notes: user '.$username.' was not found.');
        }

        if (! in_array($profile, [DevNoteCatalog::PROFILE_FULL, DevNoteCatalog::PROFILE_COMPACT], true)) {
            throw new RuntimeException('Unknown notes seed profile: '.$profile);
        }

        $this->collections->ensureForPrincipal('principals/'.$username);
        $notebooksEnsured = $this->ensureExtraNotebooks($username);

        $deleted = 0;
        if ($force) {
            $deleted = $this->deleteSeededObjects($username);
        }

        $now ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $created = 0;
        $skipped = 0;
        $starred = 0;

        foreach ($this->catalog->notes($profile, $now) as $item) {
            $backendId = $this->backendIdFor($username, $item['notebookUri']);
            if (! $force && $this->objectExists((int) $backendId[0], $item['objectUri'])) {
                $skipped++;

                continue;
            }

            $ics = $this->converter->toIcs($item['note']);
            $this->caldav()->createCalendarObject($backendId, $item['objectUri'], $ics);
            $created++;

            if ($item['starred']) {
                $object = CalendarObject::query()
                    ->where('calendarid', (int) $backendId[0])
                    ->where('uri', $item['objectUri'])
                    ->first();
                if ($object !== null) {
                    NoteStar::query()->firstOrCreate([
                        'username' => $username,
                        'calendar_object_id' => (int) $object->id,
                        'note_uid' => $item['uid'],
                    ]);
                    $starred++;
                }
            }
        }

        return [
            'created' => $created,
            'skipped' => $skipped,
            'deleted' => $deleted,
            'starred' => $starred,
            'notebooks' => $notebooksEnsured,
        ];
    }

    private function ensureExtraNotebooks(string $username): int
    {
        $principalUri = 'principals/'.$username;
        $caldav = $this->caldav();
        $existing = [];
        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            $uri = (string) ($calendar['uri'] ?? '');
            if ($uri !== '') {
                $existing[$uri] = true;
            }
        }

        $created = 0;
        foreach (DevNoteCatalog::EXTRA_NOTEBOOKS as $uri => $meta) {
            if (isset($existing[$uri])) {
                continue;
            }

            $caldav->createCalendar($principalUri, $uri, [
                '{DAV:}displayname' => $meta['name'],
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
                self::COLOR_PROPERTY => $meta['color'],
            ]);
            $created++;
        }

        return $created;
    }

    private function deleteSeededObjects(string $username): int
    {
        $deleted = 0;
        $instances = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->whereIn('uri', DevNoteCatalog::NOTEBOOK_URIS)
            ->get();

        foreach ($instances as $instance) {
            $objects = CalendarObject::query()
                ->where('calendarid', $instance->calendarid)
                ->where('uri', 'like', DevNoteCatalog::URI_PREFIX.'%')
                ->get();

            $backendId = [(int) $instance->calendarid, (int) $instance->id];
            foreach ($objects as $object) {
                NoteStar::query()
                    ->where('calendar_object_id', (int) $object->id)
                    ->delete();
                $this->caldav()->deleteCalendarObject($backendId, (string) $object->uri);
                $deleted++;
            }
        }

        return $deleted;
    }

    private function objectExists(int $calendarId, string $objectUri): bool
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uri', $objectUri)
            ->exists();
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function backendIdFor(string $username, string $notebookUri): array
    {
        foreach ($this->caldav()->getCalendarsForUser('principals/'.$username) as $calendar) {
            if (($calendar['uri'] ?? '') !== $notebookUri) {
                continue;
            }

            $id = $calendar['id'] ?? null;
            if (is_array($id) && isset($id[0], $id[1])) {
                return [(int) $id[0], (int) $id[1]];
            }
        }

        throw new RuntimeException('Notebook '.$notebookUri.' was not found for '.$username.'.');
    }

    private function caldav(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}

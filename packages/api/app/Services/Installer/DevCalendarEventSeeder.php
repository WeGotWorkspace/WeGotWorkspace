<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\User;
use App\Services\Calendars\CalendarEventMapper;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Writes deterministic ICS events onto a local-dev user's VEVENT calendars.
 *
 * Uses CalDAV PDO (not CalendarEventRepository) so iTIP scheduling does not fire.
 */
final class DevCalendarEventSeeder
{
    public function __construct(
        private readonly DevCalendarEventCatalog $catalog,
        private readonly CalendarEventMapper $mapper,
        private readonly UserCalendarCollectionsProvisioner $collections,
    ) {}

    public function isAllowed(): bool
    {
        if (app()->environment('testing')) {
            return true;
        }

        if (! app()->environment('local')) {
            return false;
        }

        if (in_array($this->installChannel(), ['docker', 'zip'], true)) {
            return false;
        }

        return $this->isMonorepoCheckout();
    }

    /**
     * @return array{created: int, skipped: int, deleted: int}
     */
    public function seed(
        string $username,
        string $profile = DevCalendarEventCatalog::PROFILE_FULL,
        bool $force = false,
        ?DateTimeImmutable $now = null,
    ): array {
        $this->assertAllowed();

        $username = strtolower(trim($username));
        if ($username === '' || User::query()->where('username', $username)->doesntExist()) {
            throw new RuntimeException('Cannot seed calendar events: user '.$username.' was not found.');
        }

        if (! in_array($profile, [DevCalendarEventCatalog::PROFILE_FULL, DevCalendarEventCatalog::PROFILE_COMPACT], true)) {
            throw new RuntimeException('Unknown calendar seed profile: '.$profile);
        }

        $this->collections->ensureForPrincipal('principals/'.$username);

        $deleted = 0;
        if ($force) {
            $deleted = $this->deleteSeededObjects($username);
        }

        $now ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $created = 0;
        $skipped = 0;

        foreach ($this->catalog->events($profile, $now) as $item) {
            $backendId = $this->backendIdFor($username, $item['calendarUri']);
            if (! $force && $this->objectExists((int) $backendId[0], $item['objectUri'])) {
                $skipped++;

                continue;
            }

            $ics = $this->mapper->toIcs($item['event']);
            $this->caldav()->createCalendarObject($backendId, $item['objectUri'], $ics);
            $created++;
        }

        return [
            'created' => $created,
            'skipped' => $skipped,
            'deleted' => $deleted,
        ];
    }

    private function assertAllowed(): void
    {
        if ($this->isAllowed()) {
            return;
        }

        if (! app()->environment(['local', 'testing'])) {
            throw new RuntimeException('Refusing to seed calendar events outside local/testing.');
        }

        if (in_array($this->installChannel(), ['docker', 'zip'], true)) {
            throw new RuntimeException('Refusing to seed calendar events on a '.$this->installChannel().' install channel.');
        }

        throw new RuntimeException('Refusing to seed calendar events outside a monorepo checkout (ZIP extracts stay empty).');
    }

    private function isMonorepoCheckout(): bool
    {
        $dir = rtrim(str_replace('\\', '/', (string) base_path()), '/');
        for ($i = 0; $i < 5; $i++) {
            if (is_file($dir.'/pnpm-workspace.yaml')) {
                return true;
            }

            $parent = dirname($dir);
            if ($parent === $dir) {
                break;
            }
            $dir = $parent;
        }

        return false;
    }

    private function installChannel(): string
    {
        $configured = config('wgw.install_channel');
        if (is_string($configured) && trim($configured) !== '') {
            return strtolower(trim($configured));
        }

        return strtolower(trim((string) (getenv('WGW_INSTALL_CHANNEL') ?: '')));
    }

    private function deleteSeededObjects(string $username): int
    {
        $deleted = 0;
        $instances = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->whereIn('uri', DevCalendarEventCatalog::EVENT_CALENDAR_URIS)
            ->get();

        foreach ($instances as $instance) {
            $objects = CalendarObject::query()
                ->where('calendarid', $instance->calendarid)
                ->where('uri', 'like', DevCalendarEventCatalog::URI_PREFIX.'%')
                ->get();

            $backendId = [(int) $instance->calendarid, (int) $instance->id];
            foreach ($objects as $object) {
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
    private function backendIdFor(string $username, string $calendarUri): array
    {
        foreach ($this->caldav()->getCalendarsForUser('principals/'.$username) as $calendar) {
            if (($calendar['uri'] ?? '') !== $calendarUri) {
                continue;
            }

            $id = $calendar['id'] ?? null;
            if (is_array($id) && isset($id[0], $id[1])) {
                return [(int) $id[0], (int) $id[1]];
            }
        }

        throw new RuntimeException('Calendar '.$calendarUri.' was not found for '.$username.'.');
    }

    private function caldav(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}

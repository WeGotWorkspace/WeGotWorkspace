<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Shared CalDAV PDO fixtures for Tasks REST feature tests.
 */
trait TasksTestFixtures
{
    use WgwRoleFixtures;

    protected function setUpTasksFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
        $this->seedTasksRoleMatrix();
    }

    protected function seedTasksRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(LegacyAdministratorsTeam::URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);
        $this->grantAdminRole($alice);

        $this->seedInboxTaskListFor('bob');
        $this->seedInboxTaskListFor('carol');
    }

    protected function seedInboxTaskListFor(string $username): void
    {
        $principalUri = 'principals/'.$username;
        app(InboxTaskListProvisioner::class)->ensureForPrincipal($principalUri);
    }

    /** @deprecated Use seedInboxTaskListFor() */
    protected function seedDefaultTaskListFor(string $username): void
    {
        $this->seedInboxTaskListFor($username);
    }

    protected function seedTaskViaPdo(
        string $username,
        string $objectUri,
        string $ics,
        string $listUri = InboxTaskListProvisioner::URI,
    ): string {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $this->resolveCalendarIdPair($username, $listUri);
        $caldav->createCalendarObject($calendarId, $objectUri, $ics);

        return self::taskIdFromObjectUri($objectUri, $ics);
    }

    protected function updateTaskViaPdo(
        string $username,
        string $objectUri,
        string $ics,
        string $listUri = InboxTaskListProvisioner::URI,
    ): void {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $this->resolveCalendarIdPair($username, $listUri);
        $objectUri = str_ends_with($objectUri, '.ics') ? $objectUri : $objectUri.'.ics';
        $caldav->updateCalendarObject($calendarId, $objectUri, $ics);
    }

    protected function sampleTodoIcs(
        string $summary = 'Sample task',
        ?string $uid = null,
        string $status = 'NEEDS-ACTION',
    ): string {
        $uid ??= 'urn:uuid:'.Str::uuid()->toString();

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WeGotWorkspace//Tasks Test//EN\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nSTATUS:{$status}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
    }

    /** @deprecated Use sampleTodoIcs() */
    protected function sampleVtodoIcs(
        string $summary = 'Sample task',
        ?string $uid = null,
        string $status = 'NEEDS-ACTION',
    ): string {
        return $this->sampleTodoIcs($summary, $uid, $status);
    }

    /**
     * @return array<string, mixed>
     */
    protected function sampleTaskCreatePayload(string $listId = InboxTaskListProvisioner::URI): array
    {
        return [
            'taskListIds' => [$listId => true],
            'title' => 'New Task',
            'due' => '2026-06-15T09:00:00',
        ];
    }

    /** @deprecated Use sampleTaskCreatePayload() */
    protected function sampleTaskPayload(string $listId = InboxTaskListProvisioner::URI): array
    {
        return $this->sampleTaskCreatePayload($listId);
    }

    public static function taskIdFromObjectUri(string $objectUri, string $ics): string
    {
        $baseId = str_ends_with($objectUri, '.ics') ? substr($objectUri, 0, -4) : $objectUri;
        if (! str_contains($ics, 'BEGIN:VTODO')) {
            return $baseId;
        }

        $count = substr_count($ics, 'BEGIN:VTODO');
        if ($count <= 1) {
            return $baseId;
        }

        if (preg_match('/UID:([^\r\n]+)/', $ics, $matches) === 1) {
            return $baseId.'#'.trim($matches[1]);
        }

        return $baseId;
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function resolveCalendarIdPair(string $username, string $listUri): array
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        foreach ($caldav->getCalendarsForUser('principals/'.$username) as $calendar) {
            if (($calendar['uri'] ?? '') === $listUri) {
                $id = $calendar['id'] ?? null;
                if (is_array($id) && count($id) === 2) {
                    return [(int) $id[0], (int) $id[1]];
                }
            }
        }

        throw new \RuntimeException("Task list {$listUri} not found for {$username}.");
    }
}

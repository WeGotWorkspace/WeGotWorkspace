<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Group-owned channels and collections: any member may rename, only an
 * instance admin may delete. Sharee dismiss and protected defaults stay put.
 */
final class GroupCollectionDeleteAuthorizationTest extends WgwDatabaseTestCase
{
    private const GROUP = 'crew';

    private const ADMIN_ONLY = 'Only an instance admin can delete a group collection.';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);

        $admins = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($admins, $alice);
        $crew = $this->seedWgwGroup('principals/groups/'.self::GROUP, 'Crew');
        $this->addPrincipalToGroup($crew, $alice);
        $this->addPrincipalToGroup($crew, $bob);
    }

    public function test_group_channel_delete_is_admin_only(): void
    {
        $personal = (string) $this->asUser('bob')->postJson('/api/v1/chat/channels', [
            'name' => 'Solo', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('bob')->deleteJson('/api/v1/chat/channels/'.$personal)->assertOk();

        $this->asUser('bob')->getJson('/api/v1/chat/channels')->assertOk();
        $defaultId = ChatCollectionUris::groupDefaultUri(self::GROUP);
        $this->assertProtectedRest('bob', '/api/v1/chat/channels/'.$defaultId, 'Group default channels cannot be deleted.');
        $this->assertProtectedRest('alice', '/api/v1/chat/channels/'.$defaultId, 'Group default channels cannot be deleted.');

        $created = $this->asUser('bob')->postJson('/api/v1/chat/channels', [
            'name' => 'Crew talk', 'kind' => 'channel', 'groupSlug' => self::GROUP,
        ])->assertCreated()->json();
        $channelId = (string) $created['id'];
        $this->assertFalse($created['myRights']['mayDelete']);
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)
            ->assertOk()
            ->assertJsonPath('myRights.mayDelete', true);
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channelId, ['name' => 'Crew talk renamed'])
            ->assertOk()
            ->assertJsonPath('name', 'Crew talk renamed');

        $this->assertAdminOnlyRest('bob', '/api/v1/chat/channels/'.$channelId);
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();
        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$channelId)->assertOk();
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertNotFound();

        $shared = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Shared', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$shared, [
            'shareWith' => ['carol' => ['mayWriteAll' => true]],
        ])->assertOk();
        $this->asUser('carol')->deleteJson('/api/v1/chat/channels/'.$shared)->assertOk();
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$shared)->assertOk();
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$shared)->assertNotFound();
    }

    public function test_group_notebook_delete_is_admin_only(): void
    {
        $personal = (string) $this->asUser('bob')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Solo',
        ])->assertCreated()->json('id');
        $this->asUser('bob')->deleteJson('/api/v1/notes/notebooks/'.$personal)->assertOk();

        $this->asUser('bob')->getJson('/api/v1/notes/notebooks')->assertOk();
        $general = '/api/v1/notes/notebooks/'.CalendarCollectionUris::NOTE_GENERAL;
        $provisioned = '/api/v1/notes/notebooks/'.CalendarCollectionUris::groupNotebookApiId(self::GROUP);
        $this->assertProtectedRest('bob', $general, 'The General notebook cannot be deleted.');
        $this->assertProtectedRest('bob', $provisioned, 'The group notebook cannot be deleted.');
        $this->assertProtectedRest('alice', $provisioned, 'The group notebook cannot be deleted.');

        $created = $this->asUser('bob')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Crew notes', 'groupSlug' => self::GROUP,
        ])->assertCreated()->json();
        $notebookId = (string) $created['id'];
        $this->assertFalse($created['myRights']['mayDelete']);
        $this->asUser('alice')->getJson('/api/v1/notes/notebooks/'.$notebookId)
            ->assertOk()
            ->assertJsonPath('myRights.mayDelete', true);
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$notebookId, ['name' => 'Crew notes renamed'])
            ->assertOk()
            ->assertJsonPath('name', 'Crew notes renamed');

        $this->assertAdminOnlyRest('bob', '/api/v1/notes/notebooks/'.$notebookId);
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$notebookId)->assertOk();
        $this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$notebookId)->assertOk();
        $this->asUser('alice')->getJson('/api/v1/notes/notebooks/'.$notebookId)->assertNotFound();

        $sharedId = (string) $this->asUser('bob')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Leave Me',
        ])->assertCreated()->json('id');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$sharedId, [
            'shareWith' => ['carol' => ['mayReadItems' => true]],
        ])->assertOk();
        $shared = $this->namedRow('carol', '/api/v1/notes/notebooks', 'Leave Me');
        $this->assertTrue($shared['myRights']['mayDelete']);
        $this->asUser('carol')->deleteJson('/api/v1/notes/notebooks/'.$shared['id'])->assertOk();
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$sharedId)->assertOk();
        $this->assertNull($this->namedRowOrNull('carol', '/api/v1/notes/notebooks', 'Leave Me'));
    }

    public function test_group_task_list_delete_is_admin_only(): void
    {
        $personal = (string) $this->asUser('bob')->postJson('/api/v1/tasks/tasklists', [
            'name' => 'Solo',
        ])->assertCreated()->json('id');
        $this->asUser('bob')->deleteJson('/api/v1/tasks/tasklists/'.$personal)->assertOk();

        $this->asUser('bob')->getJson('/api/v1/tasks/tasklists')->assertOk();
        $inbox = '/api/v1/tasks/tasklists/'.CalendarCollectionUris::TASK_INBOX;
        $provisioned = '/api/v1/tasks/tasklists/'.CalendarCollectionUris::groupTaskListApiId(self::GROUP);
        $this->assertProtectedRest('bob', $inbox, 'The Inbox task list cannot be deleted.');
        $this->assertProtectedRest('bob', $provisioned, 'The group task list cannot be deleted.');
        $this->assertProtectedRest('alice', $provisioned, 'The group task list cannot be deleted.');

        $created = $this->asUser('bob')->postJson('/api/v1/tasks/tasklists', [
            'name' => 'Crew tasks', 'groupSlug' => self::GROUP,
        ])->assertCreated()->json();
        $listId = (string) $created['id'];
        $this->assertFalse($created['myRights']['mayDelete']);
        $this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$listId)
            ->assertOk()
            ->assertJsonPath('myRights.mayDelete', true);
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$listId, ['name' => 'Crew tasks renamed'])
            ->assertOk()
            ->assertJsonPath('name', 'Crew tasks renamed');

        $this->assertAdminOnlyRest('bob', '/api/v1/tasks/tasklists/'.$listId);
        $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk();
        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$listId)->assertOk();
        $this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertNotFound();

        $sharedId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/tasklists', [
            'name' => 'Leave Me',
        ])->assertCreated()->json('id');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$sharedId, [
            'shareWith' => ['carol' => ['mayReadItems' => true]],
        ])->assertOk();
        $shared = $this->namedRow('carol', '/api/v1/tasks/tasklists', 'Leave Me');
        $this->assertTrue($shared['myRights']['mayDelete']);
        $this->asUser('carol')->deleteJson('/api/v1/tasks/tasklists/'.$shared['id'])->assertOk();
        $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();
        $this->assertNull($this->namedRowOrNull('carol', '/api/v1/tasks/tasklists', 'Leave Me'));
    }

    public function test_group_calendar_delete_is_admin_only(): void
    {
        $personal = $this->jmapCreate('bob', ['name' => 'Solo', 'id' => 'solo']);
        $destroyed = $this->jmap('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$personal]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$personal], $destroyed['destroyed']);

        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal(
            'principals/groups/'.self::GROUP,
            'Crew',
        );
        $this->assertProtectedCalendar('bob', CalendarCollectionUris::EVENT_DEFAULT, 'The default calendar cannot be deleted.');
        $provisioned = CalendarCollectionUris::groupCalendarApiId(self::GROUP);
        $this->assertProtectedCalendar('bob', $provisioned, 'The group calendar cannot be deleted.');
        $this->assertProtectedCalendar('alice', $provisioned, 'The group calendar cannot be deleted.');

        $calendarId = $this->jmapCreate('bob', ['name' => 'Crew calendar', 'groupSlug' => self::GROUP]);
        $member = $this->jmapCalendar('bob', $calendarId);
        $this->assertFalse($member['myRights']['mayDelete']);
        $admin = $this->jmapCalendar('alice', $calendarId);
        $this->assertTrue($admin['myRights']['mayDelete']);

        $renamed = $this->jmap('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => ['name' => 'Crew calendar renamed']]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();
        $this->assertNull($renamed->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $this->assertSame('Crew calendar renamed', $renamed->json('methodResponses.1.1.list.0.name'));

        $denied = $this->jmap('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([], $denied['destroyed']);
        $this->assertSame('forbidden', $denied['notDestroyed'][$calendarId]['type']);
        $this->assertSame(self::ADMIN_ONLY, $denied['notDestroyed'][$calendarId]['description']);
        $this->assertSame('Crew calendar renamed', $this->jmapCalendar('bob', $calendarId)['name']);

        $removed = $this->jmap('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$calendarId], $removed['destroyed']);

        $sharedId = $this->jmapCreate('bob', ['name' => 'Leave Me', 'id' => 'leave-me']);
        $sharedUpdate = $this->jmap('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$sharedId => [
                'shareWith' => ['carol' => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNull($sharedUpdate['notUpdated'][$sharedId] ?? null);
        $shared = $this->jmapCalendarNamed('carol', 'Leave Me');
        $shareeId = (string) $shared['id'];
        $this->assertTrue($shared['myRights']['mayDelete']);
        $dismissed = $this->jmap('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'destroy' => [$shareeId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$shareeId], $dismissed['destroyed']);
        $this->assertSame('Leave Me', $this->jmapCalendar('bob', $sharedId)['name']);
        $this->assertNull($this->jmapCalendarNamedOrNull('carol', 'Leave Me'));
    }

    public function test_is_admin_is_memoized_on_the_resolver_instance(): void
    {
        $resolver = new AdminRoleResolver;
        $connection = DB::connection('wgw');
        $connection->flushQueryLog();
        $connection->enableQueryLog();

        $this->assertFalse($resolver->isAdmin('bob'));
        $this->assertFalse($resolver->isAdmin('bob'));
        $this->assertTrue($resolver->isAdmin('alice'));
        $this->assertTrue($resolver->isAdmin('alice'));

        $this->assertCount(2, $connection->getQueryLog());
    }

    private function assertAdminOnlyRest(string $username, string $path): void
    {
        $this->asUser($username)->deleteJson($path)
            ->assertForbidden()
            ->assertJsonPath('code', 'group_delete_admin_only')
            ->assertJsonPath('error', self::ADMIN_ONLY);
    }

    private function assertProtectedRest(string $username, string $path, string $message): void
    {
        $this->asUser($username)->deleteJson($path)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden')
            ->assertJsonPath('error', $message);
    }

    private function assertProtectedCalendar(string $username, string $calendarId, string $message): void
    {
        $args = $this->jmap($username, [
            ['Calendar/set', ['accountId' => $username, 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['destroyed']);
        $this->assertSame('forbidden', $args['notDestroyed'][$calendarId]['type']);
        $this->assertSame($message, $args['notDestroyed'][$calendarId]['description']);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function jmapCreate(string $username, array $payload): string
    {
        $created = $this->jmap($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => $payload]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');
        $this->assertIsArray($created);

        return (string) $created['id'];
    }

    /**
     * @return array<string, mixed>
     */
    private function jmapCalendarNamed(string $username, string $name): array
    {
        $calendar = $this->jmapCalendarNamedOrNull($username, $name);
        $this->assertIsArray($calendar, "Expected {$username} to see calendar {$name}");

        return $calendar;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function jmapCalendarNamedOrNull(string $username, string $name): ?array
    {
        $list = $this->jmap($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertIsArray($list);
        foreach ($list as $row) {
            if (is_array($row) && ($row['name'] ?? null) === $name) {
                return $row;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function jmapCalendar(string $username, string $calendarId): array
    {
        $calendar = $this->jmap($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertIsArray($calendar);

        return $calendar;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function namedRow(string $username, string $path, string $name): array
    {
        $row = $this->namedRowOrNull($username, $path, $name);
        $this->assertIsArray($row);

        return $row;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function namedRowOrNull(string $username, string $path, string $name): ?array
    {
        $list = $this->asUser($username)->getJson($path)->assertOk()->json('list');
        $this->assertIsArray($list);
        foreach ($list as $row) {
            if (is_array($row) && ($row['name'] ?? null) === $name) {
                return $row;
            }
        }

        return null;
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

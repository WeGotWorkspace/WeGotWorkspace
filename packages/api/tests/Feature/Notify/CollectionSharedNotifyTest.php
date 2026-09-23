<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Add-only collection shareWith → suite inbox (Task #797).
 */
final class CollectionSharedNotifyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private ?string $notebookId = null;

    private ?string $taskListId = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
        $this->seedDefaultCalendarFor('alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/carol');
        app(InboxTaskListProvisioner::class)->ensureForPrincipal('principals/bob');
        app(InboxTaskListProvisioner::class)->ensureForPrincipal('principals/alice');
        app(InboxTaskListProvisioner::class)->ensureForPrincipal('principals/carol');
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: string}>
     */
    public static function domainProvider(): array
    {
        return [
            'calendar' => ['calendar', 'shared', '/calendar'],
            'notes' => ['notes', 'shared', '/notes'],
            'tasks' => ['tasks', 'list_shared', '/tasks'],
        ];
    }

    #[DataProvider('domainProvider')]
    public function test_newly_granted_sharee_is_notified_and_actor_is_not(
        string $domain,
        string $action,
        string $navigate,
    ): void {
        $this->shareCollection($domain, 'alice');

        $this->assertSame(1, Notification::query()->where('principal', 'alice')->where('domain', $domain)->where('action', $action)->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('domain', $domain)->where('action', $action)->count());

        $row = Notification::query()->where('principal', 'alice')->where('domain', $domain)->where('action', $action)->first();
        $this->assertNotNull($row);
        $this->assertSame($navigate, $row->navigate);
        $this->assertIsArray($row->data);
        $this->assertSame('Bob', $row->data['actor'] ?? null);
        $this->assertStringContainsString('shared', (string) $row->title);
    }

    #[DataProvider('domainProvider')]
    public function test_revoke_only_does_not_notify(
        string $domain,
        string $action,
        string $_navigate,
    ): void {
        $this->shareCollection($domain, 'alice');
        Notification::query()->delete();

        $this->revokeCollection($domain, 'alice');

        $this->assertSame(0, Notification::query()->where('domain', $domain)->where('action', $action)->count());
    }

    #[DataProvider('domainProvider')]
    public function test_patch_delta_notifies_only_newly_added_sharee(
        string $domain,
        string $action,
        string $navigate,
    ): void {
        $this->shareCollection($domain, 'alice');
        Notification::query()->delete();

        $this->shareCollection($domain, 'carol');

        $this->assertSame(0, Notification::query()->where('principal', 'alice')->where('domain', $domain)->where('action', $action)->count());
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('domain', $domain)->where('action', $action)->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('domain', $domain)->where('action', $action)->count());

        $row = Notification::query()->where('principal', 'carol')->where('domain', $domain)->where('action', $action)->first();
        $this->assertNotNull($row);
        $this->assertSame($navigate, $row->navigate);
    }

    private function shareCollection(string $domain, string $sharee): void
    {
        match ($domain) {
            'calendar' => $this->shareCalendar($sharee),
            'notes' => $this->shareNotebook($sharee),
            'tasks' => $this->shareTaskList($sharee),
            default => $this->fail('unknown domain '.$domain),
        };
    }

    private function revokeCollection(string $domain, string $sharee): void
    {
        match ($domain) {
            'calendar' => $this->jmapAs('bob', [
                ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => [
                    'shareWith' => [$sharee => null],
                ]]], 'c0'],
                ['Calendar/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
            ])->assertOk(),
            'notes' => $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$this->notebookId(), [
                'shareWith' => [$sharee => null],
            ])->assertOk(),
            'tasks' => $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->taskListId(), [
                'shareWith' => [$sharee => null],
            ])->assertOk(),
            default => $this->fail('unknown domain '.$domain),
        };
    }

    private function shareCalendar(string $sharee): void
    {
        $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => [$sharee => ['mayReadItems' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();
    }

    private function shareNotebook(string $sharee): void
    {
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$this->notebookId(), [
            'shareWith' => [$sharee => ['mayReadItems' => true]],
        ])->assertOk();
    }

    private function shareTaskList(string $sharee): void
    {
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->taskListId(), [
            'shareWith' => [$sharee => ['mayReadItems' => true]],
        ])->assertOk();
    }

    private function notebookId(): string
    {
        if ($this->notebookId === null) {
            $this->notebookId = (string) $this->asUser('bob')
                ->postJson('/api/v1/notes/notebooks', ['name' => 'Shared Notes'])
                ->assertCreated()
                ->json('id');
        }

        return $this->notebookId;
    }

    private function taskListId(): string
    {
        if ($this->taskListId === null) {
            $this->taskListId = (string) $this->asUser('bob')
                ->postJson('/api/v1/tasks/tasklists', ['name' => 'Shared Projects'])
                ->assertCreated()
                ->json('id');
        }

        return $this->taskListId;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function asUser(string $username)
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }
}

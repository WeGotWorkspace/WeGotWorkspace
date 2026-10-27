<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\Notification;
use App\Services\Notify\NotificationInboxMarkers;
use Illuminate\Support\Facades\Cache;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `Notification` push state (#1660): a per-principal inbox marker that
 * create, supersede, clear and read all move, for the recipient only.
 */
final class JmapEventSourceNotificationTest extends WgwDatabaseTestCase
{
    use InteractsWithJmapEventSource;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');
        Cache::flush();
    }

    public function test_an_empty_inbox_is_state_zero(): void
    {
        $changed = $this->changedStates($this->readEventSource($this->issueBearerTokenFor('alice'), 'Notification'), 'alice');

        $this->assertSame(['Notification' => '0'], $changed);
    }

    public function test_create_supersede_read_and_clear_each_move_the_recipient_state_only(): void
    {
        $alice = $this->issueBearerTokenFor('alice');
        $carol = $this->issueBearerTokenFor('carol');
        $carolStart = $this->readEventSource($carol, 'Notification');
        $states = [];

        $start = $this->readEventSource($alice, 'Notification');
        $states[] = $this->changedStates($start, 'alice')['Notification'];

        // Create.
        $this->notify(['dedupe_key' => 'doc-1', 'title' => 'First']);
        $created = $this->readEventSource($alice, 'Notification', $start['id']);
        $states[] = $this->changedStates($created, 'alice')['Notification'];

        // Supersede rewrites the row in place.
        $this->notify(['dedupe_key' => 'doc-1', 'title' => 'Second', 'supersede' => true]);
        $superseded = $this->readEventSource($alice, 'Notification', $created['id']);
        $states[] = $this->changedStates($superseded, 'alice')['Notification'];

        // Read (ack).
        $id = (string) Notification::query()->where('principal', 'alice')->value('id');
        $this->withBearer($alice)->postJson('/api/v1/notifications/'.$id.'/ack')->assertOk();
        $read = $this->readEventSource($alice, 'Notification', $superseded['id']);
        $states[] = $this->changedStates($read, 'alice')['Notification'];

        // A second ack changes nothing, so nothing is pushed.
        $this->withBearer($alice)->postJson('/api/v1/notifications/'.$id.'/ack')->assertOk();
        $this->assertSame("retry: 3000\n\n", $this->eventSource($alice, 'Notification', $read['id'])->getContent());

        // Clear deletes the row.
        $this->notify(['dedupe_key' => 'doc-1', 'clear' => true]);
        $this->assertSame(0, Notification::query()->where('principal', 'alice')->count());
        $cleared = $this->readEventSource($alice, 'Notification', $read['id']);
        $states[] = $this->changedStates($cleared, 'alice')['Notification'];

        $this->assertSame(['0', '1', '2', '3', '4'], $states);
        $this->assertSame(4, app(NotificationInboxMarkers::class)->markerFor('alice'));

        // Carol got nothing, and bob (the actor) is never a recipient of his own event.
        $this->assertSame("retry: 3000\n\n", $this->eventSource($carol, 'Notification', $carolStart['id'])->getContent());
        $this->assertSame(0, app(NotificationInboxMarkers::class)->markerFor('bob'));
    }

    public function test_a_supersede_without_the_flag_keeps_the_row_and_the_state(): void
    {
        $alice = $this->issueBearerTokenFor('alice');
        $this->notify(['dedupe_key' => 'doc-2', 'title' => 'Only']);
        $before = $this->readEventSource($alice, 'Notification');

        $this->notify(['dedupe_key' => 'doc-2', 'title' => 'Ignored']);

        $this->assertSame("retry: 3000\n\n", $this->eventSource($alice, 'Notification', $before['id'])->getContent());
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function notify(array $data): void
    {
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'docs',
            action: 'shared',
            target: '/users/bob/doc.md',
            data: array_merge([
                'recipients' => ['alice', 'bob'],
                'title' => 'doc.md was shared with you',
                'navigate' => '/docs',
            ], $data),
        ));
    }
}

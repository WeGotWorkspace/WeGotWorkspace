<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Models\NotificationMarker;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\SeedsInboxNotifications;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `POST /notifications/ack`: opening a Meet channel or "Mark all read" marks
 * every matching row read in one request, whatever their number (#2154).
 */
final class NotificationAckBatchTest extends WgwDatabaseTestCase
{
    use SeedsInboxNotifications;

    private const URL = '/api/v1/notifications/ack';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    public function test_requires_a_signed_in_user(): void
    {
        $id = $this->seedNotification('alice', 'one');

        $this->postJson(self::URL, ['ids' => [$id]])->assertUnauthorized();

        $this->assertNull($this->readAt($id));
    }

    public function test_marks_every_listed_row_read_in_one_request(): void
    {
        $ids = array_map(fn (int $i): string => $this->seedNotification('alice', 'row'.$i), range(1, 32));
        $token = $this->issueBearerTokenFor('alice');

        $this->withBearer($token)
            ->postJson(self::URL, ['ids' => $ids])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        $this->assertSame(0, Notification::query()->where('principal', 'alice')->whereNull('read_at')->count());
        foreach ($ids as $id) {
            // Like the single ack: a read row needs no push either.
            $this->assertNotNull($this->localDelivery($id)->acked_at);
        }
        $this->withBearer($token)
            ->getJson('/api/v1/notifications?unread=1')
            ->assertOk()
            ->assertJsonPath('unreadCount', 0)
            ->assertJsonCount(0, 'list');
    }

    public function test_moves_the_inbox_push_state_once(): void
    {
        $ids = [$this->seedNotification('alice', 'one'), $this->seedNotification('alice', 'two')];
        $before = $this->marker('alice');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => $ids])
            ->assertOk();

        // Other tabs and devices hear about the read through the `Notification` state.
        $this->assertSame($before + 1, $this->marker('alice'));
    }

    public function test_leaves_other_users_rows_alone(): void
    {
        $own = $this->seedNotification('alice', 'mine');
        $bobs = $this->seedNotification('bob', 'his');
        $bobsMarker = $this->marker('bob');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => [$own, $bobs, '01UNKNOWNNOTIFICATIONID000']])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        $this->assertNotNull($this->readAt($own));
        $this->assertNull($this->readAt($bobs));
        $this->assertNull($this->localDelivery($bobs)->acked_at);
        $this->assertSame($bobsMarker, $this->marker('bob'));
    }

    public function test_is_idempotent_and_keeps_the_first_read_time(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-14T01:00:00Z'));
        $id = $this->seedNotification('alice', 'one');
        $token = $this->issueBearerTokenFor('alice');

        $this->withBearer($token)->postJson(self::URL, ['ids' => [$id]])->assertOk();
        $first = $this->readAt($id);
        $this->assertNotNull($first);
        $marker = $this->marker('alice');

        Carbon::setTestNow(Carbon::parse('2026-11-14T01:00:05Z'));
        $this->withBearer($token)->postJson(self::URL, ['ids' => [$id]])->assertOk();

        $this->assertTrue($first->equalTo($this->readAt($id)));
        // Nothing changed, so nothing to tell other tabs.
        $this->assertSame($marker, $this->marker('alice'));
        Carbon::setTestNow();
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidBodies(): iterable
    {
        yield 'missing ids' => [[]];
        yield 'empty list' => [['ids' => []]];
        yield 'duplicate ids' => [['ids' => ['abc', 'abc']]];
        yield 'over the cap' => [['ids' => array_map(static fn (int $i): string => 'id'.$i, range(1, 101))]];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    #[DataProvider('invalidBodies')]
    public function test_refuses_a_malformed_body(array $body): void
    {
        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, $body)
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_single_row_ack_still_answers_404_for_a_foreign_row(): void
    {
        $bobs = $this->seedNotification('bob', 'his');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/notifications/'.$bobs.'/ack')
            ->assertNotFound();

        $this->assertNull($this->readAt($bobs));
    }

    private function readAt(string $id): ?Carbon
    {
        $row = Notification::query()->find($id);
        $this->assertNotNull($row);
        $value = $row->read_at;

        return $value === null ? null : Carbon::parse($value);
    }

    private function marker(string $principal): int
    {
        return (int) NotificationMarker::query()->where('principal', $principal)->value('marker');
    }
}

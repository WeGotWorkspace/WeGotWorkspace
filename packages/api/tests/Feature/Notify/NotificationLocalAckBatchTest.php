<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\SeedsInboxNotifications;
use Tests\Support\WgwDatabaseTestCase;

/** `POST /notifications/local-ack`: one request acks every unread row a window showed (#1826). */
final class NotificationLocalAckBatchTest extends WgwDatabaseTestCase
{
    use SeedsInboxNotifications;

    private const URL = '/api/v1/notifications/local-ack';

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

        $this->assertNull($this->localDelivery($id)->acked_at);
    }

    public function test_acks_every_listed_row_in_one_request(): void
    {
        $ids = [
            $this->seedNotification('alice', 'one'),
            $this->seedNotification('alice', 'two'),
            $this->seedNotification('alice', 'three'),
        ];

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => $ids])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        foreach ($ids as $id) {
            $this->assertNotNull($this->localDelivery($id)->acked_at);
        }
        // A local ack is not a read: the rows stay unread in the inbox.
        $this->assertSame(3, Notification::query()->where('principal', 'alice')->whereNull('read_at')->count());
    }

    public function test_ignores_ids_that_are_not_the_callers_rows(): void
    {
        $own = $this->seedNotification('alice', 'mine');
        $bobs = $this->seedNotification('bob', 'his');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => [$own, $bobs, '01UNKNOWNNOTIFICATIONID000']])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        $this->assertNotNull($this->localDelivery($own)->acked_at);
        $this->assertNull($this->localDelivery($bobs)->acked_at);
    }

    public function test_only_foreign_ids_still_answers_ok(): void
    {
        $bobs = $this->seedNotification('bob', 'his');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => [$bobs]])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        $this->assertNull($this->localDelivery($bobs)->acked_at);
    }

    public function test_is_idempotent(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-03T01:00:00Z'));
        $id = $this->seedNotification('alice', 'one');
        $token = $this->issueBearerTokenFor('alice');

        $this->withBearer($token)->postJson(self::URL, ['ids' => [$id]])->assertOk();
        $first = $this->localDelivery($id)->acked_at;
        $this->assertNotNull($first);

        Carbon::setTestNow(Carbon::parse('2026-11-03T01:00:05Z'));
        $this->withBearer($token)->postJson(self::URL, ['ids' => [$id]])->assertOk();

        $this->assertTrue($first->equalTo($this->localDelivery($id)->acked_at));
        Carbon::setTestNow();
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidBodies(): iterable
    {
        yield 'missing ids' => [[]];
        yield 'empty list' => [['ids' => []]];
        yield 'not a list' => [['ids' => 'abc']];
        yield 'keyed object' => [['ids' => ['a' => 'abc']]];
        yield 'non-string id' => [['ids' => [['nested']]]];
        yield 'empty id' => [['ids' => ['']]];
        yield 'overlong id' => [['ids' => [str_repeat('x', 65)]]];
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

    public function test_accepts_a_full_inbox_page(): void
    {
        $ids = array_map(static fn (int $i): string => 'id'.$i, range(1, 100));

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson(self::URL, ['ids' => $ids])
            ->assertOk();
    }

    public function test_single_row_local_ack_still_answers_404_for_a_foreign_row(): void
    {
        $bobs = $this->seedNotification('bob', 'his');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/notifications/'.$bobs.'/local-ack')
            ->assertNotFound();

        $this->assertNull($this->localDelivery($bobs)->acked_at);
    }
}

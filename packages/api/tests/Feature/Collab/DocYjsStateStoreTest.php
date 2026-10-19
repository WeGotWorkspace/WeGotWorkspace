<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DocYjsState;
use App\Services\Collab\DocYjsStateStore;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The move and delete that follow a document are best-effort: a database
 * failure is logged and must not fail the file operation that triggered it.
 */
final class DocYjsStateStoreTest extends WgwDatabaseTestCase
{
    private const KEY = 'users/alice/together.md';

    private DocYjsStateStore $store;

    private bool $armed = false;

    /** @var list<array{0: string, 1: array<string, mixed>}> */
    private array $warnings = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = app(DocYjsStateStore::class);
        $this->store->record(self::KEY, "# doc\n", 'history');

        DB::connection('wgw')->beforeExecuting(function (string $sql): void {
            if ($this->armed && str_contains($sql, 'doc_yjs_state')) {
                $this->armed = false;
                throw new \RuntimeException('forced doc_yjs_state failure');
            }
        });
        Log::listen(function (MessageLogged $event): void {
            if ($event->level === 'warning') {
                $this->warnings[] = [$event->message, $event->context];
            }
        });
    }

    protected function tearDown(): void
    {
        $this->armed = false;

        parent::tearDown();
    }

    public function test_moving_onto_the_same_key_keeps_the_row(): void
    {
        $this->store->moveWithDocument(self::KEY, self::KEY);

        $this->assertTrue($this->rowExists(self::KEY));
        $this->assertSame([], $this->warnings);
    }

    public function test_a_failed_move_is_logged_and_keeps_the_row(): void
    {
        $this->armed = true;
        $this->store->moveWithDocument(self::KEY, 'users/alice/renamed.md');

        $this->assertTrue($this->rowExists(self::KEY));
        $this->assertFalse($this->rowExists('users/alice/renamed.md'));
        $this->assertSyncFailureLogged('move');
    }

    public function test_a_failed_delete_is_logged_and_keeps_the_row(): void
    {
        $this->armed = true;
        $this->store->deleteWithDocument(self::KEY);

        $this->assertTrue($this->rowExists(self::KEY));
        $this->assertSyncFailureLogged('delete');
    }

    private function rowExists(string $key): bool
    {
        return DocYjsState::query()->where('storage_key', $key)->exists();
    }

    private function assertSyncFailureLogged(string $op): void
    {
        $this->assertCount(1, $this->warnings);
        $this->assertSame('doc_yjs_state_sync_failed', $this->warnings[0][0]);
        $this->assertSame($op, $this->warnings[0][1]['op'] ?? null);
        $this->assertSame('forced doc_yjs_state failure', $this->warnings[0][1]['error'] ?? null);
    }
}

<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Services\Collab\CollabSidecarMover;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class CollabSidecarMoverTest extends TestCase
{
    private CollabSidecarMover $mover;

    /** @var list<array{0: string, 1: array<string, mixed>}> */
    private array $warnings = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('wgw_files');
        $this->mover = new CollabSidecarMover(new WgwStorage(new StoragePaths), new StoragePaths);
    }

    public function test_same_principal_rename_moves_the_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/together.md', '# doc');
        $disk->put('users/alice/.together.md.yjs', 'history');

        $this->mover->moveWithDocument('users/alice/together.md', 'users/alice/renamed.md');

        $this->assertSame('history', $disk->get('users/alice/.renamed.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/.together.md.yjs'));
        $this->assertSame('# doc', $disk->get('users/alice/together.md'));
    }

    public function test_cross_principal_move_moves_the_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $disk->makeDirectory('groups/team');

        $this->mover->moveWithDocument('users/alice/together.md', 'groups/team/together.md');

        $this->assertSame('history', $disk->get('groups/team/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/.together.md.yjs'));
    }

    public function test_delete_removes_only_the_sibling_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/together.md', '# doc');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $disk->put('users/alice/.other.md.yjs', 'orphan');

        $this->mover->deleteWithDocument('users/alice/together.md');

        $this->assertFalse($disk->exists('users/alice/.together.md.yjs'));
        $this->assertSame('orphan', $disk->get('users/alice/.other.md.yjs'));
        $this->assertSame('# doc', $disk->get('users/alice/together.md'));
    }

    public function test_missing_sidecar_is_a_no_op(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/plain.md', 'plain');

        $this->mover->moveWithDocument('users/alice/plain.md', 'users/alice/renamed.md');
        $this->mover->deleteWithDocument('users/alice/plain.md');

        $this->assertFalse($disk->exists('users/alice/.renamed.md.yjs'));
        $this->assertSame('plain', $disk->get('users/alice/plain.md'));
    }

    public function test_move_without_a_source_sidecar_leaves_a_destination_orphan(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.renamed.md.yjs', 'orphan');

        $this->mover->moveWithDocument('users/alice/together.md', 'users/alice/renamed.md');

        $this->assertSame('orphan', $disk->get('users/alice/.renamed.md.yjs'));
    }

    public function test_move_replaces_a_destination_orphan_when_the_source_has_history(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $disk->put('users/alice/.renamed.md.yjs', 'orphan');

        $this->mover->moveWithDocument('users/alice/together.md', 'users/alice/renamed.md');

        $this->assertSame('history', $disk->get('users/alice/.renamed.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/.together.md.yjs'));
    }

    public function test_a_sidecar_key_is_not_treated_as_a_document(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/together.md', '# doc');
        $disk->put('users/alice/.together.md.yjs', 'history');

        $this->mover->deleteWithDocument('users/alice/.together.md.yjs');
        $this->mover->moveWithDocument('users/alice/.together.md.yjs', 'users/alice/.other.md.yjs');

        $this->assertSame('# doc', $disk->get('users/alice/together.md'));
        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/.other.md.yjs'));
    }

    public function test_parent_traversal_does_not_move_or_delete_another_file(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('secret.txt', 'secret');
        $disk->put('users/alice/.together.md.yjs', 'history');

        $this->mover->deleteWithDocument('users/alice/../../secret.txt');
        $this->mover->moveWithDocument('users/../secret.txt', 'users/alice/renamed.md');

        $this->assertSame('secret', $disk->get('secret.txt'));
        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/.renamed.md.yjs'));
    }

    public function test_moving_onto_the_same_key_leaves_the_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');

        $this->mover->moveWithDocument('users/alice/together.md', 'users/alice/together.md');

        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
    }

    public function test_a_nul_byte_in_the_key_is_rejected(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');

        $this->mover->deleteWithDocument("users/alice/together.md\0");

        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
    }

    public function test_a_failed_delete_is_logged_and_does_not_throw(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $this->captureWarnings();

        $this->withReadOnlyDirectory('users/alice', function (): void {
            $this->mover->deleteWithDocument('users/alice/together.md');
        });

        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
        $this->assertSidecarFailureLogged('delete');
    }

    public function test_a_failed_move_is_logged_and_keeps_the_source(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $disk->makeDirectory('groups/team');
        $this->captureWarnings();

        $this->withReadOnlyDirectory('groups/team', function (): void {
            $this->mover->moveWithDocument('users/alice/together.md', 'groups/team/together.md');
        });

        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
        $this->assertFalse($disk->exists('groups/team/.together.md.yjs'));
        $this->assertSidecarFailureLogged('move');
    }

    public function test_a_destination_that_cannot_be_replaced_keeps_both_sidecars(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->put('users/alice/.together.md.yjs', 'history');
        $disk->put('groups/team/.together.md.yjs', 'orphan');
        $this->captureWarnings();

        $this->withReadOnlyDirectory('groups/team', function (): void {
            $this->mover->moveWithDocument('users/alice/together.md', 'groups/team/together.md');
        });

        $this->assertSame('history', $disk->get('users/alice/.together.md.yjs'));
        $this->assertSame('orphan', $disk->get('groups/team/.together.md.yjs'));
        $this->assertSidecarFailureLogged('move');
    }

    private function withReadOnlyDirectory(string $directory, \Closure $action): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('The root user can still write a mode 0555 directory.');
        }

        $path = Storage::disk('wgw_files')->path($directory);
        chmod($path, 0555);
        try {
            $action();
        } finally {
            chmod($path, 0755);
        }
    }

    private function captureWarnings(): void
    {
        Log::listen(function (MessageLogged $event): void {
            if ($event->level === 'warning') {
                $this->warnings[] = [$event->message, $event->context];
            }
        });
    }

    private function assertSidecarFailureLogged(string $op): void
    {
        $this->assertCount(1, $this->warnings);
        $this->assertSame('collab_yjs_sidecar_failed', $this->warnings[0][0]);
        $this->assertSame($op, $this->warnings[0][1]['op'] ?? null);
    }
}

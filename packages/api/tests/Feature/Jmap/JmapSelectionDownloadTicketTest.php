<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\DriveFolderDownloadTicket;
use Illuminate\Support\Carbon;
use Tests\Support\DriveTestFixtures;
use Tests\Support\FolderZipTicketHelpers;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\ZipArchiveInspector;

/**
 * Several selected items as one zip (#1905): a ticket bound to a list of
 * node ids, each checked for read rights when issued and again when the zip
 * streams, all under one top folder.
 */
final class JmapSelectionDownloadTicketTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use FolderZipTicketHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config([
            'wgw.jmap.download_ticket_idle_minutes' => 30,
            'wgw.jmap.download_ticket_lifetime_hours' => 24,
        ]);
        // Users here share with each other; Epic #1915 only lets colleagues share.
        $this->seedSharedTeamForEveryone();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        if ($this->zipPath !== '' && is_file($this->zipPath)) {
            unlink($this->zipPath);
        }
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_mixed_selection_zips_files_and_folders_under_one_top_folder(): void
    {
        $this->writeDriveFile('users/bob/readme.txt', 'read me');
        $this->writeDriveFile('users/bob/Project/Design/deep/leaf.txt', 'leaf');
        $this->writeDriveFile('users/bob/Project/.hidden', 'hidden');
        $this->disk()->makeDirectory('users/bob/Project/Empty');
        $this->writeDriveFile('users/bob/Other/not-selected.txt', 'no');

        $issued = $this->issueSelection(
            $this->userBearerToken(),
            [$this->nodeId('users/bob/readme.txt'), $this->nodeId('users/bob/Project')],
            'Personal',
        );
        $this->assertSame('Personal.zip', $issued['name']);
        $this->assertStringEndsWith('/Personal.zip', $issued['url']);

        $this->flushHeaders();
        $response = $this->get($this->path($issued))->assertOk();
        $this->assertSame('application/zip', $response->headers->get('Content-Type'));
        $this->assertSame('attachment; filename="Personal.zip"; filename*=UTF-8\'\'Personal.zip', $response->headers->get('Content-Disposition'));
        $this->save($response->streamedContent());

        $this->assertSame([
            'Personal/' => null,
            'Personal/Project/' => null,
            'Personal/Project/Design/' => null,
            'Personal/Project/Design/deep/' => null,
            'Personal/Project/Design/deep/leaf.txt' => 'leaf',
            'Personal/Project/Empty/' => null,
            'Personal/readme.txt' => 'read me',
        ], $this->sortedEntries());
    }

    public function test_an_item_inside_another_selected_folder_is_stored_once(): void
    {
        $this->writeDriveFile('users/bob/Project/readme.txt', 'read me');
        $this->writeDriveFile('users/bob/Project/Sub/b.txt', 'b');
        $token = $this->userBearerToken();

        $this->assertSame([
            'Search/' => null,
            'Search/Project/' => null,
            'Search/Project/Sub/' => null,
            'Search/Project/Sub/b.txt' => 'b',
            'Search/Project/readme.txt' => 'read me',
        ], $this->downloadSelection($token, [
            $this->nodeId('users/bob/Project/readme.txt'),
            $this->nodeId('users/bob/Project'),
            $this->nodeId('users/bob/Project/Sub'),
        ], 'Search'));
    }

    public function test_colliding_names_are_numbered_and_the_name_is_made_safe(): void
    {
        $this->writeDriveFile('users/bob/A/notes.txt', 'from A');
        $this->writeDriveFile('users/bob/B/Notes.txt', 'from B');
        $token = $this->userBearerToken();
        $ids = [$this->nodeId('users/bob/A/notes.txt'), $this->nodeId('users/bob/B/Notes.txt')];

        $this->assertSame([
            'Recent/' => null,
            'Recent/Notes (2).txt' => 'from B',
            'Recent/notes.txt' => 'from A',
        ], $this->downloadSelection($token, $ids, 'Recent'));

        $this->assertSame('Download.zip', $this->issueSelection($token, $ids, null)['name']);
        $this->assertSame('Download.zip', $this->issueSelection($token, $ids, '   ')['name']);
        $this->assertSame('a_b.zip', $this->issueSelection($token, $ids, 'a/b')['name']);
        $this->assertSame(str_repeat('x', 120).'.zip', $this->issueSelection($token, $ids, str_repeat('x', 300))['name']);
        $this->assertSame('_.zip', $this->issueSelection($token, $ids, '..')['name']);
        $this->assertSame('_.zip', $this->issueSelection($token, $ids, '.')['name']);
        $this->assertSame('_.zip', $this->issueSelection($token, $ids, '..'.str_repeat(' ', 118).'x')['name']);
        $this->assertSame('_.zip', $this->issueSelection($token, $ids, '.'.str_repeat(' ', 119).'x')['name']);
        $this->assertSame([
            '_/' => null,
            '_/Notes (2).txt' => 'from B',
            '_/notes.txt' => 'from A',
        ], $this->downloadSelection($token, $ids, '..'.str_repeat(' ', 118).'x'));
    }

    public function test_hidden_trashed_unknown_and_unreadable_items_refuse_the_whole_ticket(): void
    {
        $this->writeDriveFile('users/bob/ok.txt', 'ok');
        $this->writeDriveFile('users/bob/.Trash/old.txt', 'old');
        $this->writeDriveFile('users/bob/Private/p.txt', 'private');
        $bob = $this->userBearerToken();
        $ok = $this->nodeId('users/bob/ok.txt');
        $before = DriveFolderDownloadTicket::query()->count();

        foreach ([
            // Hidden files have no index row; the trash folder itself is hidden-named.
            $this->nodeId('users/bob/.Trash'),
            $this->nodeId('users/bob/.Trash/old.txt'),
            'fn-'.str_repeat('0', 32),
        ] as $bad) {
            $this->flushHeaders();
            $this->withBearer($bob)
                ->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeIds' => [$ok, $bad]])
                ->assertNotFound();
        }

        // Carol cannot read Bob's files: neither the private folder nor the file.
        $carol = $this->carolBearerToken();
        $this->flushHeaders();
        $this->withBearer($carol)
            ->postJson('/api/v1/jmap/folder-download-tickets/carol', ['nodeIds' => [$ok, $this->nodeId('users/bob/Private')]])
            ->assertNotFound();
        // Nor ask on Bob's account.
        $this->flushHeaders();
        $this->withBearer($carol)
            ->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeIds' => [$ok]])
            ->assertNotFound();

        $this->assertSame($before, DriveFolderDownloadTicket::query()->count());
    }

    public function test_items_whose_share_is_withdrawn_are_left_out_until_none_is_left(): void
    {
        $this->writeDriveFile('users/bob/One/a.txt', 'one');
        $this->writeDriveFile('users/bob/Two/b.txt', 'two');
        $bob = $this->userBearerToken();
        $shareOne = $this->share($bob, '/users/bob/One');
        $shareTwo = $this->share($bob, '/users/bob/Two');
        $carol = $this->carolBearerToken();

        $issued = $this->issueSelection($carol, [$this->nodeId('users/bob/One'), $this->nodeId('users/bob/Two')], 'Shared with me', 'carol');
        $this->flushHeaders();
        $this->save($this->get($this->path($issued))->assertOk()->streamedContent());
        $this->assertSame([
            'Shared with me/' => null,
            'Shared with me/One/' => null,
            'Shared with me/One/a.txt' => 'one',
            'Shared with me/Two/' => null,
            'Shared with me/Two/b.txt' => 'two',
        ], $this->sortedEntries());

        $this->flushHeaders();
        $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareOne)->assertOk();
        $this->flushHeaders();
        $this->save($this->get($this->path($issued))->assertOk()->streamedContent());
        $this->assertSame([
            'Shared with me/' => null,
            'Shared with me/Two/' => null,
            'Shared with me/Two/b.txt' => 'two',
        ], $this->sortedEntries());

        $this->flushHeaders();
        $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareTwo)->assertOk();
        $this->flushHeaders();
        $this->get($this->path($issued))->assertNotFound();
    }

    public function test_the_ticket_stores_its_node_ids_and_the_first_as_node_id(): void
    {
        $this->writeDriveFile('users/bob/a.txt', 'a');
        $this->writeDriveFile('users/bob/b.txt', 'b');
        $ids = [$this->nodeId('users/bob/a.txt'), $this->nodeId('users/bob/b.txt')];

        // A repeated id counts once.
        $this->issueSelection($this->userBearerToken(), [$ids[0], $ids[1], $ids[0]], 'Personal');

        $ticket = DriveFolderDownloadTicket::query()->latest('id')->firstOrFail();
        $this->assertSame($ids, $ticket->node_ids);
        $this->assertSame($ids[0], $ticket->node_id);
        $this->assertSame('Personal.zip', $ticket->zip_name);
    }

    public function test_malformed_selections_are_bad_requests(): void
    {
        $this->writeDriveFile('users/bob/a.txt', 'a');
        $token = $this->userBearerToken();
        $id = $this->nodeId('users/bob/a.txt');

        foreach ([
            ['nodeId' => $id, 'nodeIds' => [$id]],
            ['nodeIds' => []],
            ['nodeIds' => ['x' => $id]],
            ['nodeIds' => $id],
            ['nodeIds' => [$id, 'fn-XYZ']],
            ['nodeIds' => [$id, 7]],
            ['nodeIds' => array_fill(0, 1001, $id)],
            ['nodeIds' => [$id], 'name' => ['Personal']],
        ] as $body) {
            $this->flushHeaders();
            $this->withBearer($token)
                ->postJson('/api/v1/jmap/folder-download-tickets/bob', $body)
                ->assertStatus(400);
        }
    }

    /**
     * @param  list<string>  $nodeIds
     * @return array<string, string|null>
     */
    private function downloadSelection(string $token, array $nodeIds, ?string $name): array
    {
        $issued = $this->issueSelection($token, $nodeIds, $name);
        $this->flushHeaders();
        $this->save($this->get($this->path($issued))->assertOk()->streamedContent());

        return $this->sortedEntries();
    }

    /**
     * @param  list<string>  $nodeIds
     * @return array{url: string, name: string, idleExpires: string, absoluteExpires: string}
     */
    private function issueSelection(string $token, array $nodeIds, ?string $name, string $account = 'bob'): array
    {
        $this->flushHeaders();
        $body = ['nodeIds' => $nodeIds];
        if ($name !== null) {
            $body['name'] = $name;
        }

        /** @var array{url: string, name: string, idleExpires: string, absoluteExpires: string} $issued */
        $issued = $this->withBearer($token)
            ->postJson('/api/v1/jmap/folder-download-tickets/'.$account, $body)
            ->assertCreated()
            ->json();

        return $issued;
    }

    /**
     * @return array<string, string|null>
     */
    private function sortedEntries(): array
    {
        $entries = ZipArchiveInspector::contents($this->zipPath);
        ksort($entries);

        return $entries;
    }
}

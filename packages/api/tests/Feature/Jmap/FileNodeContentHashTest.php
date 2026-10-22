<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapContentHashJob;
use App\Models\JmapFileNode;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeHashJobRunner;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * One meaning for content_sha256 (#1500): every write path stores the true
 * sha256 (DAV PUT hashed while streaming, COPY carried across without file
 * reads), discovered files are hashed in the walk or marked hash-pending
 * with a provisional id, hash jobs run in budgeted steps and bump
 * change_seq, and a byte-identical rewrite keeps its id.
 */
final class FileNodeContentHashTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    private string $basic = '';

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-content-hash-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->configureWgwJwtKeys();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);
        config(['wgw.jmap.maintenance_share' => 0]);

        $this->basic = 'Basic '.base64_encode('bob:secret');
        $this->token = $this->issueBearerTokenFor('bob');
    }

    private function files(): Filesystem
    {
        return Storage::disk('wgw_files');
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $method, string $uri, ?string $content = null, array $server = []): TestResponse
    {
        return $this->call($method, $uri, [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => $this->basic,
            'CONTENT_TYPE' => 'application/octet-stream',
        ], $server), $content);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     * @param  list<string>  $extra
     */
    private function jmap(array $calls, array $extra = []): TestResponse
    {
        return $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE, ...$extra],
            'methodCalls' => $calls,
        ]);
    }

    /**
     * @param  list<string>  $extra
     * @return array<string, array<string, mixed>> FileNodes by name
     */
    private function nodesByName(array $extra = []): array
    {
        $list = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']], $extra)->assertOk()->json('methodResponses.0.1.list');

        return collect($list)->keyBy('name')->all();
    }

    private function row(string $key): JmapFileNode
    {
        $row = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($row, $key);

        return $row;
    }

    public function test_dav_put_stores_the_hash_computed_while_streaming(): void
    {
        $body = random_bytes(300_000);
        $this->dav('PUT', '/files/users/bob/photo.raw', $body)->assertSuccessful();

        $row = $this->row('users/bob/photo.raw');
        $this->assertSame(hash('sha256', $body), $row->content_sha256);
        $this->assertFalse($row->hash_pending);
    }

    public function test_a_byte_identical_rewrite_keeps_the_blob_id(): void
    {
        $this->dav('PUT', '/files/users/bob/same.txt', 'unchanged bytes')->assertSuccessful();
        $before = $this->nodesByName()['same.txt']['blobId'];

        $this->dav('PUT', '/files/users/bob/same.txt', 'unchanged bytes')->assertSuccessful();
        $this->assertSame($before, $this->nodesByName()['same.txt']['blobId']);

        $this->dav('PUT', '/files/users/bob/same.txt', 'changed bytes')->assertSuccessful();
        $this->assertSame(substr(hash('sha256', 'changed bytes'), 0, 8), substr((string) $this->nodesByName()['same.txt']['blobId'], -8));
    }

    public function test_mkcol_keeps_a_null_hash(): void
    {
        $this->dav('MKCOL', '/files/users/bob/folder')->assertSuccessful();

        $this->assertNull($this->row('users/bob/folder')->content_sha256);
    }

    public function test_dav_copy_carries_the_source_hash_without_reading_the_file(): void
    {
        $this->dav('PUT', '/files/users/bob/a.txt', 'source bytes')->assertSuccessful();
        // A marker value proves the destination hash is copied from the
        // source row, not computed from the file.
        $marker = str_repeat('ab', 32);
        JmapFileNode::query()->where('storage_key', 'users/bob/a.txt')->update(['content_sha256' => $marker]);

        $this->dav('COPY', '/files/users/bob/a.txt', null, ['HTTP_DESTINATION' => '/files/users/bob/b.txt'])->assertSuccessful();

        $copy = $this->row('users/bob/b.txt');
        $this->assertSame($marker, $copy->content_sha256);
        $this->assertSame(strlen('source bytes'), $copy->size_bytes);
        $this->assertNotSame($this->row('users/bob/a.txt')->node_id, $copy->node_id);
    }

    public function test_a_folder_copy_inserts_the_subtree_with_hashes(): void
    {
        $this->dav('MKCOL', '/files/users/bob/my_src')->assertSuccessful();
        $this->dav('MKCOL', '/files/users/bob/my_src/inner')->assertSuccessful();
        $this->dav('PUT', '/files/users/bob/my_src/one.txt', 'one')->assertSuccessful();
        $this->dav('PUT', '/files/users/bob/my_src/inner/two.txt', 'two')->assertSuccessful();
        JmapFileNode::query()->where('storage_key', 'users/bob/my_src/inner/two.txt')->update(['content_sha256' => str_repeat('cd', 32)]);

        $this->dav('COPY', '/files/users/bob/my_src', null, ['HTTP_DESTINATION' => '/files/users/bob/dst', 'HTTP_DEPTH' => 'infinity'])->assertSuccessful();

        // Indexed at COPY time: no listing of dst has happened.
        $dst = $this->row('users/bob/dst');
        $inner = $this->row('users/bob/dst/inner');
        $one = $this->row('users/bob/dst/one.txt');
        $two = $this->row('users/bob/dst/inner/two.txt');
        $this->assertSame($dst->node_id, $inner->parent_node_id);
        $this->assertSame($dst->node_id, $one->parent_node_id);
        $this->assertSame($inner->node_id, $two->parent_node_id);
        $this->assertSame(hash('sha256', 'one'), $one->content_sha256);
        $this->assertSame(str_repeat('cd', 32), $two->content_sha256);
        $this->assertNull($inner->content_sha256);
        $this->assertSame($this->row('users/bob')->node_id, $dst->parent_node_id);
    }

    public function test_small_discovered_files_are_hashed_in_the_walk(): void
    {
        $this->files()->put('users/bob/sftp-small.txt', 'dropped over sftp');

        $node = $this->nodesByName([JmapCapabilities::FILENODE_VERSION_CHECK])['sftp-small.txt'];

        $this->assertSame(substr(hash('sha256', 'dropped over sftp'), 0, 8), substr((string) $node['blobId'], -8));
        $this->assertFalse($node['contentHashPending']);
        $this->assertSame(hash('sha256', 'dropped over sftp'), $this->row('users/bob/sftp-small.txt')->content_sha256);
    }

    public function test_large_discovered_files_are_hash_pending_with_a_provisional_id(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 1000]);
        $this->files()->put('users/bob/backup.tar', random_bytes(5000));

        $nodes = $this->nodesByName([JmapCapabilities::FILENODE_VERSION_CHECK]);
        $node = $nodes['backup.tar'];
        $row = $this->row('users/bob/backup.tar');

        $this->assertTrue($node['contentHashPending']);
        $this->assertTrue($row->hash_pending);
        $this->assertNull($row->content_sha256);
        $this->assertMatchesRegularExpression('/^fnb-fn-[0-9a-f]{32}-[0-9a-f]{8}$/', (string) $node['blobId']);
        $basis = '5000:'.$this->files()->lastModified('users/bob/backup.tar');
        $this->assertSame('fnb-'.$row->node_id.'-'.substr(hash('sha256', $basis), 0, 8), $node['blobId']);
        $this->assertSame(1, JmapContentHashJob::query()->where('node_id', $row->node_id)->count());

        // The property is only shown to clients that use the extension.
        $this->assertArrayNotHasKey('contentHashPending', $this->nodesByName()['backup.tar']);
    }

    public function test_the_resolver_accepts_a_provisional_id_only_while_it_is_current(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 1000]);
        $this->files()->put('users/bob/movie.mkv', str_repeat('m', 4000));
        $provisional = (string) $this->nodesByName()['movie.mkv']['blobId'];

        $this->withBearer($this->token)->get('/api/v1/jmap/download/bob/'.$provisional.'/movie.mkv')->assertOk();

        // Out-of-band overwrite (new size): the old provisional id is a miss.
        $this->files()->put('users/bob/movie.mkv', str_repeat('n', 4100));
        $this->withBearer($this->token)->get('/api/v1/jmap/download/bob/'.$provisional.'/movie.mkv')->assertNotFound();
    }

    public function test_hash_jobs_run_in_budgeted_steps_and_bump_change_seq(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 1000, 'wgw.jmap.step_throughput_bytes' => 1]);
        $bytes = random_bytes(2_500_000);
        $this->files()->put('users/bob/big.iso', $bytes);
        $provisional = (string) $this->nodesByName()['big.iso']['blobId'];
        $state = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => []], 'g']])->json('methodResponses.0.1.state');
        $row = $this->row('users/bob/big.iso');

        $runner = app(FileNodeHashJobRunner::class);
        $runner->advance();
        $job = JmapContentHashJob::query()->where('node_id', $row->node_id)->firstOrFail();
        $this->assertSame(1024 * 1024, $job->hashed_bytes, 'one budget per call');
        $this->assertTrue($this->row('users/bob/big.iso')->hash_pending);

        $runner->advance();
        $this->assertSame(['hashed' => 1, 'advanced' => 1], $runner->advance());

        $row->refresh();
        $this->assertFalse($row->hash_pending);
        $this->assertSame(hash('sha256', $bytes), $row->content_sha256);
        $this->assertSame(0, JmapContentHashJob::query()->count());

        $true = 'fnb-'.$row->node_id.'-'.substr(hash('sha256', $bytes), 0, 8);
        $this->assertSame($true, $this->nodesByName()['big.iso']['blobId']);
        $changes = $this->jmap([['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c']])->json('methodResponses.0.1');
        $this->assertContains((string) $row->node_id, $changes['updated']);
        // Once the true hash is stored, the provisional id is a normal stale id.
        $this->withBearer($this->token)->get('/api/v1/jmap/download/bob/'.$provisional.'/big.iso')->assertNotFound();
    }

    public function test_a_hash_job_restarts_when_the_file_changes_under_it(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 1000, 'wgw.jmap.step_throughput_bytes' => 1]);
        $this->files()->put('users/bob/live.log', random_bytes(1_500_000));
        $this->nodesByName();
        $runner = app(FileNodeHashJobRunner::class);
        $runner->advance();

        $final = random_bytes(1_600_000);
        $this->files()->put('users/bob/live.log', $final);
        $runner->advance();
        $runner->advance();

        $this->assertSame(hash('sha256', $final), $this->row('users/bob/live.log')->content_sha256);
    }

    public function test_legacy_rows_never_hash_a_large_file_inside_a_request(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 1000]);
        $this->dav('PUT', '/files/users/bob/legacy.bin', random_bytes(5000))->assertSuccessful();
        JmapFileNode::query()->where('storage_key', 'users/bob/legacy.bin')->update(['content_sha256' => null]);

        $node = $this->nodesByName([JmapCapabilities::FILENODE_VERSION_CHECK])['legacy.bin'];

        $this->assertTrue($node['contentHashPending']);
        $this->assertNull($this->row('users/bob/legacy.bin')->content_sha256);
    }

    public function test_the_lazy_index_path_and_a_hashless_content_write_never_null_the_hash(): void
    {
        $this->files()->put('users/bob/lazy.txt', 'lazy bytes');
        $index = app(FileNodeIndexService::class);

        $index->recordCreate('users/bob/lazy.txt');
        $this->assertSame(hash('sha256', 'lazy bytes'), $this->row('users/bob/lazy.txt')->content_sha256);

        // Existing row, no hash given (the lazy-index path): hashed, not nulled.
        $index->recordCreate('users/bob/lazy.txt');
        $index->recordContentWrite('users/bob/lazy.txt');
        $this->assertSame(hash('sha256', 'lazy bytes'), $this->row('users/bob/lazy.txt')->content_sha256);
    }

    public function test_the_drive_text_write_path_stores_the_true_hash(): void
    {
        $drive = app(DriveService::class);
        $drive->writeText(['username' => 'bob', 'role' => 'admin'], '/users/bob/mcp-note.md', '# written by a tool');

        $this->assertSame(hash('sha256', '# written by a tool'), $this->row('users/bob/mcp-note.md')->content_sha256);
    }
}

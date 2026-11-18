<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\Principal;
use App\Services\Update\HostingQuotaProbe;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\LegacyAdministratorsTeam;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class UpdateStateEndpointTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-update-state-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/updates');
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedAdminAlice();
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_update_state_exposes_recent_progress_without_lock_file(): void
    {
        $token = $this->adminToken();
        $recentAt = date('c');

        app(WgwStorage::class)->data()->put(
            'updates/state.json',
            json_encode([
                'phase' => 'extracting',
                'current' => ['from' => '0.1.42', 'to' => '0.1.43', 'at' => $recentAt],
                'phase_progress' => [
                    'completed' => 100,
                    'total' => 200,
                    'percent' => 50,
                    'updatedAt' => $recentAt,
                ],
            ], JSON_UNESCAPED_SLASHES)."\n",
        );

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('inProgress', true)
            ->assertJsonPath('phase', 'extracting')
            ->assertJsonPath('phaseProgress.completed', 100)
            ->assertJsonPath('phaseProgress.total', 200);
    }

    public function test_update_state_clears_stale_orphan_progress_without_lock_file(): void
    {
        $token = $this->adminToken();
        $staleAt = date('c', time() - 600);

        app(WgwStorage::class)->data()->put(
            'updates/state.json',
            json_encode([
                'phase' => 'extracting',
                'current' => ['from' => '0.1.42', 'to' => '0.1.43', 'at' => $staleAt],
                'phase_progress' => [
                    'completed' => 6392,
                    'total' => 17564,
                    'percent' => 36,
                    'updatedAt' => $staleAt,
                ],
            ], JSON_UNESCAPED_SLASHES)."\n",
        );

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('inProgress', false)
            ->assertJsonPath('phase', null)
            ->assertJsonPath('phaseProgress', null);

        $raw = app(WgwStorage::class)->data()->get('updates/state.json');
        $decoded = json_decode($raw, true);
        $this->assertIsArray($decoded);
        $this->assertArrayNotHasKey('phase', $decoded);
    }

    public function test_polling_the_update_state_runs_the_quota_command_once_per_cache_window(): void
    {
        $runs = $this->fakeQuotaCommand();
        $token = $this->adminToken();

        foreach (range(1, 5) as $_) {
            $this->assertSame('1.5 GB', $this->quotaRow($this->withBearer($token)->getJson('/api/v1/admin/updates/state')->assertOk()->json('checks'))['detail']);
        }
        $this->withBearer($token)->getJson('/api/v1/admin/state')->assertOk();
        // Six polls, one shell (#2150).
        $this->assertSame(1, $this->countRuns($runs));

        $this->travel(HostingQuotaProbe::CACHE_SECONDS + 1)->seconds();
        $this->withBearer($token)->getJson('/api/v1/admin/updates/state')->assertOk();
        $this->assertSame(2, $this->countRuns($runs));
    }

    public function test_the_docker_channel_never_runs_the_quota_command(): void
    {
        config(['wgw.install_channel' => 'docker']);
        $runs = $this->fakeQuotaCommand();
        $token = $this->adminToken();

        $checks = $this->withBearer($token)->getJson('/api/v1/admin/updates/state')->assertOk()->json('checks');

        $this->assertSame(0, $this->countRuns($runs));
        $this->assertSame('unknown', $this->quotaRow($checks)['status']);
        $this->assertSame('Unknown (quota command unavailable on this host)', $this->quotaRow($checks)['detail']);
    }

    public function test_update_progress_returns_only_lock_phase_and_progress(): void
    {
        $token = $this->adminToken();
        $recentAt = date('c');
        $data = app(WgwStorage::class)->data();
        $data->put('updates/state.json', json_encode([
            'phase' => 'downloading',
            'current' => ['from' => '0.1.42', 'to' => '0.1.43', 'at' => $recentAt],
            'download' => ['downloadedBytes' => 10, 'totalBytes' => 40, 'percent' => 25, 'updatedAt' => $recentAt],
            'latest' => ['version' => '0.1.43'],
        ], JSON_UNESCAPED_SLASHES)."\n");

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/progress')
            ->assertOk()
            ->assertExactJson([
                'inProgress' => true,
                'phase' => 'downloading',
                'current' => ['from' => '0.1.42', 'to' => '0.1.43', 'at' => $recentAt],
                'download' => ['downloadedBytes' => 10, 'totalBytes' => 40, 'percent' => 25, 'updatedAt' => $recentAt],
                'phaseProgress' => null,
                'cancelRequested' => false,
                'cancelAllowed' => true,
            ]);
    }

    public function test_polling_update_progress_runs_no_checks_and_lists_no_backups(): void
    {
        $runs = $this->fakeQuotaCommand();
        $token = $this->adminToken();
        File::ensureDirectoryExists($this->dataDir.'/updates/backup');
        file_put_contents($this->dataDir.'/updates/backup/wgw-backup-1.zip', 'zip');

        foreach (range(1, 5) as $_) {
            $progress = $this->withBearer($token)->getJson('/api/v1/admin/updates/progress')->assertOk()->json();
            $this->assertIsArray($progress);
            $this->assertFalse($progress['inProgress']);
            $this->assertArrayNotHasKey('checks', $progress);
            $this->assertArrayNotHasKey('backups', $progress);
        }
        $this->assertSame(0, $this->countRuns($runs));

        // The full state still lists the backup and runs the capacity checks.
        $state = $this->withBearer($token)->getJson('/api/v1/admin/updates/state')->assertOk();
        $this->assertNotSame([], $state->json('backups'));
        $this->assertSame(1, $this->countRuns($runs));
    }

    public function test_update_progress_clears_stale_orphan_progress(): void
    {
        $token = $this->adminToken();
        $staleAt = date('c', time() - 600);
        app(WgwStorage::class)->data()->put('updates/state.json', json_encode([
            'phase' => 'extracting',
            'current' => ['from' => '0.1.42', 'to' => '0.1.43', 'at' => $staleAt],
        ], JSON_UNESCAPED_SLASHES)."\n");

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/progress')
            ->assertOk()
            ->assertJsonPath('inProgress', false)
            ->assertJsonPath('phase', null)
            ->assertJsonPath('current', null);
    }

    /**
     * Swaps `quota -s` for a script that logs each run and reports 512 MiB
     * used of a 2 GiB limit.
     *
     * @return string the run log
     */
    private function fakeQuotaCommand(): string
    {
        $log = $this->dataDir.'/quota-runs.log';
        $script = $this->dataDir.'/quota.sh';
        file_put_contents($script, 'echo run >> '.escapeshellarg($log)."\n"
            ."echo 'Disk quotas for user wgw (uid 1000):'\n"
            ."echo '     Filesystem   space   quota   limit   grace   files   quota   limit   grace'\n"
            ."echo '      /dev/sda1    512M   2048M   2048M            1000       0       0'\n");
        $this->app->instance(HostingQuotaProbe::class, new HostingQuotaProbe('sh '.escapeshellarg($script)));

        return $log;
    }

    private function countRuns(string $log): int
    {
        return is_file($log) ? count(file($log, FILE_IGNORE_NEW_LINES) ?: []) : 0;
    }

    /**
     * @return array<string, mixed>
     */
    private function quotaRow(mixed $checks): array
    {
        $this->assertIsArray($checks);
        foreach ($checks as $check) {
            if (is_array($check) && ($check['label'] ?? null) === 'Hosting quota free space') {
                return $check;
            }
        }
        $this->fail('No hosting quota row in the update checks.');
    }

    private function adminToken(): string
    {
        return (string) $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->json('access_token');
    }

    private function seedAdminAlice(): void
    {
        $this->seedWgwUser('alice', displayName: 'Alice');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $group = $this->seedWgwGroup(LegacyAdministratorsTeam::URI, 'Administrators');
        $this->addPrincipalToGroup($group, $alice);
        $this->grantAdminRole($alice);
    }
}

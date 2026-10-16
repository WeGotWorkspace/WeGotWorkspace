<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Update\UpdateStateStore;
use App\Storage\WgwStorage;
use App\Support\AppVersion;
use App\Support\WgwInstallConfig;
use Illuminate\Support\Facades\File;
use Tests\Support\AdminTestFixtures;
use Tests\Support\Update\FakeHttps;
use Tests\Support\WgwDatabaseTestCase;

final class AdminUpdatesTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_can_read_update_state(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonStructure([
                'installChannel',
                'installedVersion',
                'schemaVersion',
                'backups',
                'compatible',
                'updateAvailable',
            ]);
    }

    public function test_update_state_exposes_install_channel_from_env(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('installChannel', 'docker');
    }

    public function test_docker_channel_blocks_web_update_check(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/update-jobs', ['type' => 'check'])
            ->assertForbidden();
    }

    public function test_docker_channel_blocks_web_update_apply(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/update-jobs', ['type' => 'apply'])
            ->assertForbidden();
    }

    public function test_docker_channel_installed_version_uses_version_file_not_stale_job_state(): void
    {
        $installRoot = storage_path('framework/testing/wgw-docker-version-'.uniqid('', true));
        File::ensureDirectoryExists($installRoot);
        File::put($installRoot.'/VERSION', "0.1.80\n");

        $previousAppRoot = getenv('WGW_APP_ROOT') ?: '';
        putenv('WGW_APP_ROOT='.$installRoot);
        $_ENV['WGW_APP_ROOT'] = $installRoot;
        putenv('WGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:0.1.80');
        $_ENV['WGW_IMAGE'] = 'ghcr.io/wegotworkspace/wegotworkspace:0.1.80';
        $this->app->forgetInstance(WgwInstallConfig::class);
        $this->app->forgetInstance(AppVersion::class);

        config(['wgw.install_channel' => 'docker']);

        $recentAt = date('c');
        app(WgwStorage::class)->data()->put(
            'updates/state.json',
            json_encode([
                'phase' => 'extracting',
                'current' => ['from' => '0.1.70', 'to' => '0.1.71', 'at' => $recentAt],
                'phase_progress' => [
                    'completed' => 100,
                    'total' => 200,
                    'percent' => 50,
                    'updatedAt' => $recentAt,
                ],
            ], JSON_UNESCAPED_SLASHES)."\n",
        );

        try {
            $this->withBearer($this->adminBearerToken())
                ->getJson('/api/v1/admin/updates/state')
                ->assertOk()
                ->assertJsonPath('installChannel', 'docker')
                ->assertJsonPath('installedVersion', '0.1.80')
                ->assertJsonPath('imageTag', '0.1.80')
                ->assertJsonPath('inProgress', false)
                ->assertJsonPath('phase', null);
        } finally {
            if ($previousAppRoot !== '') {
                putenv('WGW_APP_ROOT='.$previousAppRoot);
                $_ENV['WGW_APP_ROOT'] = $previousAppRoot;
            } else {
                putenv('WGW_APP_ROOT');
                unset($_ENV['WGW_APP_ROOT']);
            }
            putenv('WGW_IMAGE');
            unset($_ENV['WGW_IMAGE']);
            $this->app->forgetInstance(WgwInstallConfig::class);
            $this->app->forgetInstance(AppVersion::class);
            if (File::isDirectory($installRoot)) {
                File::deleteDirectory($installRoot);
            }
        }
    }

    public function test_admin_can_round_trip_update_log(): void
    {
        $token = $this->adminBearerToken();

        app(WgwStorage::class)->data()->put('updates/process.log', "[2026-01-01T00:00:00+00:00] test line\n");

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/log')
            ->assertOk()
            ->assertJsonPath('lines.0', '[2026-01-01T00:00:00+00:00] test line');

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/updates/log')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('lines', []);
    }

    public function test_invalid_update_job_type_returns_bad_request(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/update-jobs', ['type' => 'unknown'])
            ->assertBadRequest()
            ->assertJsonPath('error', 'Invalid update job type.');
    }

    public function test_update_check_job_can_be_triggered(): void
    {
        $feed = 'https://updates.test/manifest.json';
        config(['wgw.update_feed_url' => $feed]);
        FakeHttps::install();
        FakeHttps::$bodies[$feed] = (string) json_encode([
            'version' => '9.9.9',
            'package_url' => 'https://updates.test/pkg.zip',
            'checksum_sha256' => str_repeat('ab', 32),
            'checksum_signature' => 'c2ln',
        ], JSON_UNESCAPED_SLASHES);
        $store = app(UpdateStateStore::class);
        $state = $store->read();
        unset($state['last_check_at']);
        $store->write($state);

        try {
            $this->withBearer($this->adminBearerToken())
                ->postJson('/api/v1/admin/update-jobs', ['type' => 'check'])
                ->assertAccepted()
                ->assertJsonStructure(['installedVersion', 'schemaVersion', 'backups'])
                ->assertJsonPath('latest.version', '9.9.9');
        } finally {
            FakeHttps::remove();
        }
    }

    public function test_non_admin_cannot_trigger_update_job(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/admin/update-jobs', ['type' => 'check'])
            ->assertForbidden();
    }
}

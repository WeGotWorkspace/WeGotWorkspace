<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Storage\WgwStorage;
use App\Support\UpdateFeedDefaults;
use Illuminate\Support\Facades\File;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class AdminUpdateChannelTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    private string $envDir = '';

    private string $dataDir = '';

    private string $originalEnvPath = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
        $this->dataDir = storage_path('framework/testing/wgw-update-channel-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/updates');
        WgwTestDisks::refresh($this->dataDir);
        $this->originalEnvPath = $this->app->environmentPath();
        $this->envDir = sys_get_temp_dir().'/wgw-update-channel-'.uniqid('', true);
        mkdir($this->envDir, 0775, true);
        file_put_contents($this->envDir.'/.env', 'WGW_UPDATE_FEED_URL='.UpdateFeedDefaults::MANIFEST_URL."\n");
        $this->app->useEnvironmentPath($this->envDir);
        config(['wgw.update_channel' => 'stable', 'wgw.update_feed_url' => UpdateFeedDefaults::MANIFEST_URL]);
    }

    protected function tearDown(): void
    {
        if ($this->originalEnvPath !== '') {
            $this->app->useEnvironmentPath($this->originalEnvPath);
        }
        File::deleteDirectory($this->envDir);
        File::deleteDirectory($this->dataDir);
        config(['wgw.install_channel' => null]);
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_user_cannot_change_the_update_channel(): void
    {
        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertForbidden();

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
    }

    public function test_admin_switches_to_beta_and_the_state_reports_it(): void
    {
        $token = $this->adminBearerToken();
        app(WgwStorage::class)->data()->put('updates/state.json', (string) json_encode([
            'latest' => ['version' => '9.9.9'],
            'last_checked_at' => date('c'),
        ]));

        $this->withBearer($token)
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertOk()
            ->assertJsonPath('channel', 'beta');

        $this->assertStringContainsString("WGW_UPDATE_CHANNEL=beta\n", $this->envFile());
        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('updateChannel', 'beta')
            ->assertJsonPath('latest', null)
            ->assertJsonPath('lastCheckedAt', null);
    }

    public function test_switching_again_replaces_the_line(): void
    {
        $token = $this->adminBearerToken();
        $this->withBearer($token)->putJson('/api/v1/admin/updates/channel', ['channel' => 'edge'])->assertOk();
        $this->withBearer($token)->putJson('/api/v1/admin/updates/channel', ['channel' => 'stable'])->assertOk();

        $this->assertSame(1, substr_count($this->envFile(), 'WGW_UPDATE_CHANNEL='));
        $this->assertStringContainsString("WGW_UPDATE_CHANNEL=stable\n", $this->envFile());
    }

    public function test_unknown_channel_is_rejected(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'nightly'])
            ->assertStatus(422);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
    }

    public function test_docker_installs_choose_the_channel_on_the_host(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertStatus(409)
            ->assertSee('setup.sh upgrade --channel beta', false);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
    }

    private function envFile(): string
    {
        return (string) file_get_contents($this->envDir.'/.env');
    }
}

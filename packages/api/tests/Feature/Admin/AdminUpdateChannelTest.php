<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;
use App\Services\Update\UpdateChannelSettingService;
use App\Services\Update\UpdateStateStore;
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
        if (is_dir($this->envDir)) {
            chmod($this->envDir, 0775);
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
        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
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

        $this->assertSame('beta', AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('updateChannel', 'beta')
            ->assertJsonPath('latest', null)
            ->assertJsonPath('lastCheckedAt', null);
    }

    public function test_switching_again_replaces_the_stored_channel(): void
    {
        $token = $this->adminBearerToken();
        $this->withBearer($token)->putJson('/api/v1/admin/updates/channel', ['channel' => 'edge'])->assertOk();
        $this->withBearer($token)->putJson('/api/v1/admin/updates/channel', ['channel' => 'stable'])->assertOk();

        $this->assertSame('stable', AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
    }

    public function test_admin_saves_the_channel_when_the_env_file_is_read_only(): void
    {
        $before = $this->envFile();
        chmod($this->envDir.'/.env', 0444);
        chmod($this->envDir, 0555);

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertOk()
            ->assertJsonPath('channel', 'beta');

        $this->assertSame($before, $this->envFile());
        $this->assertSame('beta', app(UpdateChannelSettingService::class)->current());
    }

    public function test_without_a_stored_channel_the_env_value_is_used(): void
    {
        config(['wgw.update_channel' => 'beta']);

        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('updateChannel', 'beta');
        $this->assertSame(UpdateFeedDefaults::manifestUrlFor('beta'), app(UpdateChannelSettingService::class)->feedUrl());
    }

    public function test_the_stored_channel_picks_the_release_feed(): void
    {
        AppSetting::setValue(SettingKeys::UPDATE_CHANNEL, 'edge');

        $this->assertSame(UpdateFeedDefaults::manifestUrlFor('edge'), app(UpdateChannelSettingService::class)->feedUrl());
    }

    public function test_an_explicit_feed_url_still_wins_over_the_channel(): void
    {
        AppSetting::setValue(SettingKeys::UPDATE_CHANNEL, 'edge');
        config(['wgw.update_feed_url' => 'https://feed.example.test/manifest.json']);

        $this->assertSame('https://feed.example.test/manifest.json', app(UpdateChannelSettingService::class)->feedUrl());
    }

    public function test_an_invalid_stored_channel_falls_back_to_the_env_value(): void
    {
        AppSetting::setValue(SettingKeys::UPDATE_CHANNEL, 'nightly');
        config(['wgw.update_channel' => 'beta']);

        $this->assertSame('beta', app(UpdateChannelSettingService::class)->current());
    }

    public function test_docker_ignores_a_stored_channel(): void
    {
        // A ZIP install moved to Docker: the host's setup.sh choice wins.
        AppSetting::setValue(SettingKeys::UPDATE_CHANNEL, 'edge');
        config(['wgw.install_channel' => 'docker', 'wgw.update_channel' => 'beta']);

        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonPath('updateChannel', 'beta');
        $this->assertSame(UpdateFeedDefaults::manifestUrlFor('beta'), app(UpdateChannelSettingService::class)->feedUrl());
    }

    public function test_the_general_settings_route_cannot_set_the_channel(): void
    {
        // That route skips the Docker and running-update checks.
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings', ['values' => [SettingKeys::UPDATE_CHANNEL => 'edge']])
            ->assertOk();

        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
    }

    public function test_unknown_channel_is_rejected(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'nightly'])
            ->assertStatus(422);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
    }

    public function test_channel_must_be_lowercase_as_documented(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'BETA'])
            ->assertStatus(422);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
    }

    public function test_channel_cannot_change_while_an_update_runs(): void
    {
        app(WgwStorage::class)->data()->put(app(UpdateStateStore::class)->lockPath(), '');

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertStatus(409)
            ->assertSee('An update is running', false);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
    }

    public function test_docker_installs_choose_the_channel_on_the_host(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/updates/channel', ['channel' => 'beta'])
            ->assertStatus(409)
            ->assertSee('setup.sh upgrade --channel beta', false);

        $this->assertStringNotContainsString('WGW_UPDATE_CHANNEL', $this->envFile());
        $this->assertNull(AppSetting::getValue(SettingKeys::UPDATE_CHANNEL));
    }

    private function envFile(): string
    {
        return (string) file_get_contents($this->envDir.'/.env');
    }
}

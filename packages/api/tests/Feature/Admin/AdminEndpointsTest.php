<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Storage\WgwStorage;
use App\Support\AppPaths;
use App\Support\WgwSettings;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class AdminEndpointsTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-admin-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/updates/backup');
        File::ensureDirectoryExists($this->dataDir.'/install-root');
        WgwInstallFixture::bindInstallRoot($this->dataDir.'/install-root');
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedAdminAlice();
        $this->seedBobUser();
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_admin_state_log_and_group_membership(): void
    {
        $token = $this->adminToken();

        app(WgwStorage::class)->data()->put('updates/process.log', "[2026-01-01T00:00:00+00:00] test line\n");

        $state = $this->withBearer($token)
            ->getJson('/api/v1/admin/state');
        $state->assertOk()
            ->assertJsonPath('currentUser', 'alice')
            ->assertJsonStructure([
                'users',
                'groups',
                'mail',
                'mailDelivery' => ['config', 'capability', 'lastTestSend'],
                'rtc',
                'apps',
                'webdav',
                'updates' => ['installedVersion', 'schemaVersion', 'backups'],
                'logoutUrl',
            ]);

        $log = $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/log');
        $log->assertOk()->assertJsonPath('lines.0', '[2026-01-01T00:00:00+00:00] test line');

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/updates/log')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('lines', []);

        $this->withBearer($token)
            ->getJson('/api/v1/admin/updates/state')
            ->assertOk()
            ->assertJsonStructure([
                'installedVersion',
                'schemaVersion',
                'backups',
                'compatible',
                'updateAvailable',
            ]);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => ['timezone' => 'Europe/Amsterdam'],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonFragment(['saved' => ['timezone']]);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    'rtc_stun_url' => 'stun:stun.example.test:3478,stuns:stun-backup.example.test:5349',
                    'rtc_turn_url' => 'turn:turn.example.test:3478?transport=udp,turns:turn-backup.example.test:5349?transport=tcp',
                    'rtc_turn_username' => 'rtc-user',
                    'rtc_turn_credential' => 'rtc-secret',
                ],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnUsername', 'rtc-user')
            ->assertJsonPath('rtc.turnPassword', 'rtc-secret')
            ->assertJsonPath('rtc.stunUrls', 'stun:stun.example.test:3478, stuns:stun-backup.example.test:5349')
            ->assertJsonPath('rtc.turnUrls', 'turn:turn.example.test:3478?transport=udp, turns:turn-backup.example.test:5349?transport=tcp');

        $this->withBearer($token)
            ->putJson('/api/v1/admin/groups/administrators/members/bob')
            ->assertOk()
            ->assertJsonPath('ok', true);

        $state->assertOk();
        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonFragment(['username' => 'bob']);
    }

    public function test_admin_users_and_groups_crud(): void
    {
        $this->setAppSettings([
            WgwSettings::CALENDAR_ENABLED => false,
            WgwSettings::CONTACTS_ENABLED => false,
        ]);

        $token = $this->adminToken();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/users', [
                'username' => 'carol',
                'password' => 'carol-secret',
                'displayName' => 'Carol',
                'email' => 'carol@example.test',
                'groups' => [],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/users/carol', [
                'displayName' => 'Carol Updated',
                'email' => 'carol.updated@example.test',
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->postJson('/api/v1/admin/groups', [
                'name' => 'Support Team',
                'displayName' => 'Support Team',
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/groups/support-team', [
                'displayName' => 'Support',
                'members' => ['bob', 'carol'],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $state = $this->withBearer($token)
            ->getJson('/api/v1/admin/state');
        $state->assertOk();
        $usernames = array_column($state->json('users'), 'username');
        $this->assertContains('carol', $usernames);
        $groupIds = array_column($state->json('groups'), 'id');
        $this->assertContains('principals/groups/support-team', $groupIds);

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/users/carol')
            ->assertOk();

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/groups/support-team')
            ->assertOk();
    }

    public function test_non_admin_cannot_access_admin_routes(): void
    {
        $token = (string) $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->json('access_token');

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertForbidden();
    }

    public function test_admin_can_install_plugin_zip(): void
    {
        $token = $this->adminToken();
        $zipPath = $this->dataDir.'/demo-plugin.zip';
        $sourceRoot = $this->dataDir.'/plugin-source/demo-plugin';
        File::ensureDirectoryExists($sourceRoot.'/assets');
        File::put($sourceRoot.'/assets/index.html', '<!doctype html><title>Plugin</title>');
        File::put($sourceRoot.'/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'drive' => [
                'openFileExtensions' => ['docx'],
            ],
        ], JSON_THROW_ON_ERROR));

        $zip = new \ZipArchive;
        $opened = $zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        $this->assertSame(true, $opened);
        $zip->addFile($sourceRoot.'/plugin.json', 'demo-plugin/plugin.json');
        $zip->addFile($sourceRoot.'/assets/index.html', 'demo-plugin/assets/index.html');
        $zip->close();

        $upload = new UploadedFile($zipPath, 'demo-plugin.zip', 'application/zip', null, true);

        $this->withBearer($token)
            ->post('/api/v1/admin/plugins', ['plugin' => $upload])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('plugin.id', 'demo-plugin')
            ->assertJsonPath('plugin.active', true);

        $pluginsRoot = app(AppPaths::class)->pluginsRoot();
        $this->assertFileExists($pluginsRoot.'/demo-plugin/plugin.json');
        $this->assertFileExists($pluginsRoot.'/demo-plugin/assets/index.html');
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
        $group = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($group, $alice);
    }

    private function seedBobUser(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
    }
}

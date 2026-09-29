<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AppPassword;
use App\Services\Auth\AppPasswordService;
use App\Support\WgwSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class AppPasswordEndpointsTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-app-pass-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_main_password_without_totp_is_accepted_on_dav(): void
    {
        Storage::disk('wgw_files')->put('users/alice/note.txt', 'hello');

        $response = $this->call('PROPFIND', '/files/users/alice/', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:secret'),
            'HTTP_DEPTH' => '0',
        ]);

        $response->assertStatus(207);
    }

    public function test_app_password_is_accepted_on_dav_and_revoked_password_is_rejected(): void
    {
        Storage::disk('wgw_files')->put('users/alice/note.txt', 'hello');
        $token = $this->issueBearerToken();
        $created = $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Thunderbird',
            'password' => 'secret',
        ]);
        $created->assertCreated();
        $this->flushHeaders();
        $plain = (string) $created->json('password');
        $this->assertMatchesRegularExpression('/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/', $plain);

        $ok = $this->call('PROPFIND', '/files/users/alice/', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:'.$plain),
            'HTTP_DEPTH' => '0',
            'HTTP_USER_AGENT' => 'Thunderbird/115',
        ]);
        $ok->assertStatus(207);

        $id = (int) $created->json('item.id');
        $this->withBearer($token)->deleteJson('/api/v1/settings/app-passwords/'.$id)->assertOk();
        $this->flushHeaders();

        $denied = $this->call('PROPFIND', '/files', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:'.$plain),
            'HTTP_DEPTH' => '0',
        ]);
        $denied->assertStatus(401);
    }

    public function test_last_used_at_is_not_written_twice_inside_five_minutes(): void
    {
        Storage::disk('wgw_files')->put('users/alice/note.txt', 'hello');
        $plain = 'abcd-efgh-ijkl-mnop';
        AppPassword::query()->create([
            'username' => 'alice',
            'name' => 'Phone',
            'token_hash' => AppPasswordService::hashNormalized(AppPasswordService::normalize($plain)),
            'created_at' => Carbon::parse('2026-09-29 10:00:00'),
        ]);

        Carbon::setTestNow(Carbon::parse('2026-09-29 10:01:00'));
        $this->propfindWith($plain);
        $first = AppPassword::query()->where('username', 'alice')->first();
        $this->assertNotNull($first?->last_used_at);
        $stamp = $first->last_used_at->toIso8601String();

        Carbon::setTestNow(Carbon::parse('2026-09-29 10:03:00'));
        $this->propfindWith($plain);
        $second = AppPassword::query()->where('username', 'alice')->first();
        $this->assertSame($stamp, $second?->last_used_at?->toIso8601String());

        Carbon::setTestNow(Carbon::parse('2026-09-29 10:07:00'));
        $this->propfindWith($plain);
        $third = AppPassword::query()->where('username', 'alice')->first();
        $this->assertNotSame($stamp, $third?->last_used_at?->toIso8601String());
        Carbon::setTestNow();
    }

    public function test_create_rejects_a_wrong_account_password(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Laptop',
            'password' => 'not-the-password',
        ])->assertUnauthorized();
    }

    private function propfindWith(string $password): void
    {
        $this->call('PROPFIND', '/files/users/alice/', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:'.$password),
            'HTTP_DEPTH' => '0',
            'HTTP_USER_AGENT' => 'DAVx5',
        ])->assertStatus(207);
    }
}

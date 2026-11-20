<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Dav\Auth\VerifiedPasswordMemory;
use App\Exceptions\ApiHttpException;
use App\Models\AppPassword;
use App\Models\User;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Mcp\ConsentIntent;
use App\Services\Meet\MeetRequestAuth;
use App\Support\WgwSettings;
use Illuminate\Cache\Events\KeyWritten;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

/**
 * App passwords for DAV and Meet Basic (#2271): the settings routes, both
 * Basic callers, and every route that must refuse them.
 */
final class AppPasswordTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    /** @var list<string|null> */
    private array $rememberedIn = [];

    protected function setUp(): void
    {
        parent::setUp();

        Event::listen(KeyWritten::class, function (KeyWritten $event): void {
            if (str_starts_with($event->key, 'dav-basic-verified:')) {
                $this->rememberedIn[] = $event->storeName;
            }
        });

        $this->app['env'] = 'production';
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $installRoot = sys_get_temp_dir().'/wgw-app-passwords-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users', 0775, true);
        mkdir($dataDir.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        $this->setAppSetting(WgwSettings::AUTH_REALM, 'SabreDAV');
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
        unset($_COOKIE['sabre_ui_auth']);
    }

    // ---- Settings routes ---------------------------------------------------

    public function test_create_returns_the_plaintext_once_and_stores_only_its_hash(): void
    {
        $token = $this->issueBearerTokenFor('bob');

        $created = $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => '  Phone calendar  ',
            'currentPassword' => 'secret',
        ])->assertCreated()
            ->assertJsonPath('appPassword.name', 'Phone calendar')
            ->assertJsonPath('appPassword.lastUsedAt', null)
            ->assertJsonPath('appPassword.lastUsedClient', null);

        $plain = (string) $created->json('password');
        $this->assertMatchesRegularExpression('/^[a-z]{16}$/', $plain);

        $row = AppPassword::query()->sole();
        $this->assertSame('bob', $row->username);
        $this->assertSame(AppPasswordService::hashNormalized($plain), $row->token_hash);
        $this->assertSame(hash('sha256', $plain), $row->token_hash);
        $this->assertStringNotContainsString($plain, json_encode($row->getAttributes(), JSON_THROW_ON_ERROR));

        $list = $this->withBearer($token)->getJson('/api/v1/settings/app-passwords')
            ->assertOk()
            ->assertJsonCount(1, 'appPasswords')
            ->assertJsonPath('appPasswords.0.id', $created->json('appPassword.id'));
        $this->assertStringNotContainsString($plain, (string) $list->getContent());
        $this->assertStringNotContainsString($row->token_hash, (string) $list->getContent());
        $this->assertSame(['id', 'name', 'createdAt', 'lastUsedAt', 'lastUsedClient'], array_keys((array) $list->json('appPasswords.0')));
    }

    public function test_create_requires_the_account_password(): void
    {
        $token = $this->issueBearerTokenFor('bob');

        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', ['name' => 'Phone'])
            ->assertBadRequest();
        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Phone',
            'currentPassword' => 'wrong',
        ])->assertForbidden()->assertJsonPath('code', 'current_password_invalid');

        $this->assertSame(0, AppPassword::query()->count());
    }

    public function test_an_app_password_is_not_the_current_password(): void
    {
        $plain = $this->createAppPassword('bob');
        $token = $this->issueBearerTokenFor('bob');

        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Second',
            'currentPassword' => $plain,
        ])->assertForbidden()->assertJsonPath('code', 'current_password_invalid');

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'a-new-password',
            'currentPassword' => $plain,
        ])->assertForbidden()->assertJsonPath('code', 'current_password_invalid');
    }

    public function test_create_shares_the_sign_in_rate_limit(): void
    {
        $token = $this->issueBearerTokenFor('bob');
        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT; $attempt++) {
            $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
                'name' => 'Phone',
                'currentPassword' => 'wrong',
            ])->assertForbidden();
        }

        // The next attempt is refused before the password is checked, even a correct one ...
        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Phone',
            'currentPassword' => 'secret',
        ])->assertStatus(429)->assertJsonPath('code', 'throttled');

        // ... and the web sign-in of the same user from the same address is on the same counter.
        $this->postJson('/api/v1/auth/token', ['username' => 'bob', 'password' => 'secret'])
            ->assertStatus(429);
        $this->assertSame(0, AppPassword::query()->count());
    }

    public function test_name_is_required_and_at_most_sixty_characters(): void
    {
        $token = $this->issueBearerTokenFor('bob');

        foreach (['', '   ', str_repeat('x', 61)] as $name) {
            $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
                'name' => $name,
                'currentPassword' => 'secret',
            ])->assertBadRequest();
        }
        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => str_repeat('x', 60),
            'currentPassword' => 'secret',
        ])->assertCreated();
    }

    public function test_active_app_passwords_are_capped(): void
    {
        for ($i = 0; $i < AppPasswordService::MAX_ACTIVE; $i++) {
            $this->createAppPassword('bob', 'Client '.$i);
        }
        $token = $this->issueBearerTokenFor('bob');

        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'One too many',
            'currentPassword' => 'secret',
        ])->assertUnprocessable()->assertJsonPath('code', 'app_password_limit');

        // A revoked one frees its place.
        $id = (int) AppPassword::query()->where('username', 'bob')->value('id');
        $this->withBearer($token)->deleteJson('/api/v1/settings/app-passwords/'.$id)->assertOk();
        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Now it fits',
            'currentPassword' => 'secret',
        ])->assertCreated();
    }

    public function test_revoking_another_users_app_password_is_not_found_and_leaves_it_working(): void
    {
        $carolPassword = $this->createAppPassword('carol');
        $carolId = (int) AppPassword::query()->where('username', 'carol')->value('id');
        $bobToken = $this->issueBearerTokenFor('bob');

        $this->withBearer($bobToken)->deleteJson('/api/v1/settings/app-passwords/'.$carolId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
        $this->withBearer($bobToken)->postJson('/api/v1/settings/app-passwords/revocations')->assertOk();
        $this->withBearer($bobToken)->getJson('/api/v1/settings/app-passwords')->assertOk()->assertJsonCount(0, 'appPasswords');

        $this->assertNull(AppPassword::query()->whereKey($carolId)->value('revoked_at'));
        $this->dav('carol', $carolPassword)->assertStatus(207);
    }

    public function test_revoked_app_passwords_stop_working_and_leave_the_list(): void
    {
        $one = $this->createAppPassword('bob', 'One');
        $two = $this->createAppPassword('bob', 'Two');
        $three = $this->createAppPassword('bob', 'Three');
        $token = $this->issueBearerTokenFor('bob');
        $oneId = (int) AppPassword::query()->where('name', 'One')->value('id');

        $this->withBearer($token)->deleteJson('/api/v1/settings/app-passwords/'.$oneId)->assertOk();
        $this->withBearer($token)->deleteJson('/api/v1/settings/app-passwords/'.$oneId)->assertNotFound();
        $this->dav('bob', $one)->assertStatus(401);
        $this->dav('bob', $two)->assertStatus(207);
        $this->withBearer($token)->getJson('/api/v1/settings/app-passwords')
            ->assertOk()
            ->assertJsonPath('appPasswords.0.name', 'Three')
            ->assertJsonPath('appPasswords.1.name', 'Two')
            ->assertJsonCount(2, 'appPasswords');

        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords/revocations')
            ->assertOk()
            ->assertJsonPath('ok', true);
        $this->dav('bob', $two)->assertStatus(401);
        $this->dav('bob', $three)->assertStatus(401);
        $this->withBearer($token)->getJson('/api/v1/settings/app-passwords')->assertOk()->assertJsonCount(0, 'appPasswords');
    }

    public function test_settings_routes_need_a_signed_in_account(): void
    {
        $this->getJson('/api/v1/settings/app-passwords')->assertUnauthorized();
        $this->postJson('/api/v1/settings/app-passwords', ['name' => 'x', 'currentPassword' => 'secret'])->assertUnauthorized();
        $this->postJson('/api/v1/settings/app-passwords/revocations')->assertUnauthorized();
        $this->deleteJson('/api/v1/settings/app-passwords/1')->assertUnauthorized();
    }

    // ---- DAV and Meet Basic -------------------------------------------------

    public function test_dav_basic_accepts_an_app_password_and_still_the_account_password(): void
    {
        $plain = $this->createAppPassword('bob');

        $this->dav('bob', $plain)->assertStatus(207);
        $this->dav('bob', implode(' ', str_split($plain, 4)))->assertStatus(207);
        $this->dav('bob', 'secret')->assertStatus(207);
        $this->dav('bob', strtoupper($plain))->assertStatus(401);
    }

    public function test_dav_basic_refuses_an_app_password_of_another_user(): void
    {
        $carolPassword = $this->createAppPassword('carol');

        $this->dav('bob', $carolPassword)->assertStatus(401);
        $this->dav('carol', $carolPassword)->assertStatus(207);
    }

    public function test_dav_basic_refuses_the_app_password_of_a_disabled_user(): void
    {
        $plain = $this->createAppPassword('bob');
        User::query()->where('username', 'bob')->update(['enabled' => false]);

        $this->dav('bob', $plain)->assertStatus(401);
    }

    public function test_meet_basic_accepts_an_app_password_and_still_the_account_password(): void
    {
        $plain = $this->createAppPassword('bob');
        $carolPassword = $this->createAppPassword('carol');

        $this->assertSame('bob', $this->meet('bob', $plain));
        $this->assertSame('bob', $this->meet('bob', implode(' ', str_split($plain, 4))));
        $this->assertSame('bob', $this->meet('bob', 'secret'));
        $this->assertNull($this->meet('bob', $carolPassword));

        AppPassword::query()->where('username', 'bob')->update(['revoked_at' => Carbon::now()]);
        $this->assertNull($this->meet('bob', $plain));
    }

    public function test_app_password_is_not_remembered(): void
    {
        $this->rememberIn(Cache::store('array'));
        $plain = $this->createAppPassword('bob');

        $this->dav('bob', $plain)->assertStatus(207);
        $this->dav('bob', $plain)->assertStatus(207);
        $this->assertSame([], $this->rememberedIn);

        // The account password is still remembered as before, in the memory store only.
        $this->dav('bob', 'secret')->assertStatus(207);
        $this->assertSame(['array'], $this->rememberedIn);
    }

    public function test_failed_app_password_shaped_dav_attempts_count_on_the_protocol_limiter(): void
    {
        $plain = $this->createAppPassword('bob');
        for ($attempt = 0; $attempt < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT; $attempt++) {
            $this->dav('bob', str_repeat('q', 16))->assertStatus(401);
        }

        // Locked: the account password and wrong app passwords wait, and the
        // answer says how long. A valid app password still gets in (#2273).
        $locked = $this->dav('bob', 'secret');
        $locked->assertStatus(429);
        $this->assertGreaterThan(0, (int) $locked->headers->get('Retry-After'));
        $this->dav('bob', str_repeat('q', 16))->assertStatus(429);
        $this->dav('bob', $plain)->assertStatus(207);
        $this->dav('carol', 'secret')->assertStatus(207);
    }

    public function test_a_valid_app_password_signs_in_on_dav_while_the_account_password_is_throttled(): void
    {
        $plain = $this->createAppPassword('bob');
        $revoked = $this->createAppPassword('bob', 'Old phone');
        AppPassword::query()->where('name', 'Old phone')->update(['revoked_at' => Carbon::now()]);
        $carols = $this->createAppPassword('carol');

        // An old client keeps sending a wrong account password from this address.
        for ($attempt = 0; $attempt < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT; $attempt++) {
            $this->dav('bob', 'old-password')->assertStatus(401);
        }

        $this->dav('bob', 'secret')->assertStatus(429);
        $this->dav('bob', $revoked)->assertStatus(429);
        $this->dav('bob', $carols)->assertStatus(429);
        $this->dav('bob', $plain)->assertStatus(207);
        $this->dav('bob', implode(' ', str_split($plain, 4)))->assertStatus(207);
        // That success neither resets nor counts: still throttled for the rest.
        $this->dav('bob', 'secret')->assertStatus(429);
        // A disabled user's valid app password does not get through either.
        User::query()->where('username', 'bob')->update(['enabled' => false]);
        $this->dav('bob', $plain)->assertStatus(429);
    }

    public function test_refused_attempts_while_throttled_do_not_fill_the_wider_limits(): void
    {
        $plain = $this->createAppPassword('bob');

        // One address keeps retrying a wrong account password on DAV, then on Meet.
        for ($attempt = 1; $attempt <= 60; $attempt++) {
            $this->dav('bob', 'old-password')->assertStatus($attempt <= LoginRateLimiter::PROTOCOL_USER_IP_LIMIT ? 401 : 429);
        }
        for ($attempt = 1; $attempt <= 60; $attempt++) {
            try {
                $this->meet('bob', 'old-password');
                $this->fail('Throttled Meet Basic accepted a wrong account password.');
            } catch (ApiHttpException $locked) {
                $this->assertSame(429, $locked->getStatusCode());
            }
        }

        $this->dav('bob', $plain)->assertStatus(207);
        $this->assertSame('bob', $this->meet('bob', $plain));
        $this->dav('bob', 'old-password')->assertStatus(429);
        // The refusals added no hits: other addresses and users are not locked out.
        $this->dav('bob', 'secret', ['REMOTE_ADDR' => '192.0.2.50'])->assertStatus(207);
        $this->dav('carol', 'secret')->assertStatus(207);
    }

    public function test_a_valid_app_password_signs_in_from_any_address_while_the_user_wide_limit_is_reached(): void
    {
        $plain = $this->createAppPassword('bob');

        // Failures spread over many addresses reach the per-user limit.
        for ($attempt = 0; $attempt < LoginRateLimiter::USER_LIMIT; $attempt++) {
            $this->dav('bob', 'old-password', ['REMOTE_ADDR' => '198.51.100.'.(1 + intdiv($attempt, 5))])->assertStatus(401);
        }

        $this->dav('bob', 'secret', ['REMOTE_ADDR' => '192.0.2.50'])->assertStatus(429);
        $this->dav('bob', $plain, ['REMOTE_ADDR' => '192.0.2.50'])->assertStatus(207);
        $this->assertSame('bob', $this->meet('bob', $plain));
    }

    public function test_a_valid_app_password_signs_in_on_meet_while_throttled(): void
    {
        $plain = $this->createAppPassword('bob');
        for ($attempt = 0; $attempt < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT; $attempt++) {
            $this->assertNull($this->meet('bob', 'old-password'));
        }

        $this->assertSame('bob', $this->meet('bob', $plain));
        foreach (['secret', str_repeat('q', 16)] as $refused) {
            try {
                $this->meet('bob', $refused);
                $this->fail('Throttled Meet Basic accepted something other than a valid app password.');
            } catch (ApiHttpException $locked) {
                $this->assertSame(429, $locked->getStatusCode());
                $this->assertGreaterThan(0, (int) ($locked->getHeaders()['Retry-After'] ?? 0));
            }
        }
    }

    public function test_failed_app_password_shaped_meet_attempts_count_on_the_protocol_limiter(): void
    {
        for ($attempt = 0; $attempt < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT; $attempt++) {
            $this->assertNull($this->meet('bob', str_repeat('q', 16)));
        }

        try {
            $this->meet('bob', 'secret');
            $this->fail('The eleventh Meet Basic attempt was not throttled.');
        } catch (ApiHttpException $locked) {
            $this->assertSame(429, $locked->getStatusCode());
            $this->assertSame('throttled', $locked->errorCode());
            $this->assertGreaterThan(0, (int) ($locked->getHeaders()['Retry-After'] ?? 0));
        }
        // DAV and Meet Basic share the protocol keys.
        $this->dav('bob', 'secret')->assertStatus(429);
    }

    public function test_last_used_is_written_at_most_once_per_five_minutes(): void
    {
        $plain = $this->createAppPassword('bob');
        $start = Carbon::parse('2026-11-19 10:00:00');
        Carbon::setTestNow($start);

        $this->dav('bob', $plain, ['HTTP_USER_AGENT' => 'DAVx5/4.4'])->assertStatus(207);
        $this->dav('bob', 'secret')->assertStatus(207);
        Carbon::setTestNow($start->copy()->addSeconds(200));
        $this->dav('bob', $plain, ['HTTP_USER_AGENT' => 'Other/1.0'])->assertStatus(207);
        $this->dav('bob', 'secret')->assertStatus(207);

        $row = AppPassword::query()->sole();
        $this->assertSame($start->toIso8601String(), $row->last_used_at?->toIso8601String());
        $this->assertSame('DAVx5/4.4', $row->last_used_client);
        $this->assertSame($start->toIso8601String(), $this->accountPasswordUsedAt('bob'));

        Carbon::setTestNow($start->copy()->addSeconds(301));
        $this->assertSame('bob', $this->meet('bob', $plain, str_repeat('u', 200)));
        $this->assertSame('bob', $this->meet('bob', 'secret'));

        $row->refresh();
        $this->assertSame($start->copy()->addSeconds(301)->toIso8601String(), $row->last_used_at?->toIso8601String());
        $this->assertSame(str_repeat('u', 120), $row->last_used_client);
        $this->assertSame($start->copy()->addSeconds(301)->toIso8601String(), $this->accountPasswordUsedAt('bob'));
        Carbon::setTestNow();
    }

    public function test_an_app_password_sign_in_does_not_count_as_account_password_use(): void
    {
        $plain = $this->createAppPassword('bob');

        $this->dav('bob', $plain)->assertStatus(207);
        $this->assertSame('bob', $this->meet('bob', $plain));

        $this->assertNull($this->accountPasswordUsedAt('bob'));
    }

    // ---- Routes that never take an app password -----------------------------

    public function test_an_app_password_does_not_sign_in_on_the_web(): void
    {
        $plain = $this->createAppPassword('bob');

        $this->postJson('/api/v1/auth/token', ['username' => 'bob', 'password' => $plain])
            ->assertUnauthorized()
            ->assertCookieMissing('wgw_refresh');
    }

    public function test_an_app_password_does_not_start_an_assistant_session(): void
    {
        $this->enableMcp();
        $plain = $this->createAppPassword('bob');

        $intent = app(ConsentIntent::class)->issue('_login', 'session');

        $this->postJson('/oauth/session', ['username' => 'bob', 'password' => $plain, 'intent' => $intent])
            ->assertUnauthorized();
        $this->assertGuest('web');
    }

    public function test_deleting_a_user_removes_their_app_passwords(): void
    {
        $plain = $this->createAppPassword('carol');

        app(AdminUserProvisionerService::class)->delete('carol');
        $this->seedWgwUser('carol', displayName: 'Carol again');

        $this->assertSame(0, AppPassword::query()->where('username', 'carol')->count());
        $this->dav('carol', $plain)->assertStatus(401);
    }

    // ---- Helpers -----------------------------------------------------------

    private function createAppPassword(string $username, string $name = 'Phone'): string
    {
        return app(AppPasswordService::class)->create($username, $name)['password'];
    }

    private function accountPasswordUsedAt(string $username): ?string
    {
        $value = User::query()->where('username', $username)->value('dav_password_used_at');

        return $value === null ? null : Carbon::parse((string) $value)->toIso8601String();
    }

    private function rememberIn(?Repository $store): void
    {
        $this->app->instance(VerifiedPasswordMemory::class, new class($store) extends VerifiedPasswordMemory
        {
            public function __construct(private readonly ?Repository $memory) {}

            public function store(): ?Repository
            {
                return $this->memory;
            }
        });
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $username, string $password, array $server = []): TestResponse
    {
        return $this->call('PROPFIND', '/files', [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':'.$password),
            'HTTP_DEPTH' => '0',
            'REMOTE_ADDR' => '203.0.113.9',
        ], $server));
    }

    /**
     * The Meet Basic branch, called the way Meet, RTC and presence routes call it.
     */
    private function meet(string $username, string $password, ?string $userAgent = null): ?string
    {
        $server = ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':'.$password)];
        if ($userAgent !== null) {
            $server['HTTP_USER_AGENT'] = $userAgent;
        }

        return app(MeetRequestAuth::class)->tryAuthenticatedUsername(
            Request::create('/api/v1/rooms/x/configuration', 'GET', server: $server),
            'SabreDAV',
        );
    }
}

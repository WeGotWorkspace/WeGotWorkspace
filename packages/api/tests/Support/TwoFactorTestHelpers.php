<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\AuthChallenge;
use App\Services\Auth\Mfa\TotpService;
use App\Services\Auth\Mfa\UserMfaService;
use App\Services\Meet\MeetRequestAuth;
use App\Support\WgwSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;

/**
 * Two-factor test world (#2273): an install with the sign-in throttle on,
 * bob and carol, and helpers to turn two-factor on and make codes. The clock is
 * frozen, so `code($secret, 1)` is the next 30-second step.
 */
trait TwoFactorTestHelpers
{
    protected function setUpTwoFactorWorld(): void
    {
        $this->app['env'] = 'production';
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $installRoot = sys_get_temp_dir().'/wgw-mfa-'.uniqid('', true);
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
        $this->grantAdminRole('alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
        unset($_COOKIE['sabre_ui_auth']);

        // Frozen a few seconds into the current real 30-second step, so codes
        // never cross a step boundary mid-test and issued tokens are not
        // dated in the future.
        Carbon::setTestNow(Carbon::createFromTimestamp(intdiv(time(), TotpService::PERIOD) * TotpService::PERIOD + 5));
    }

    protected function tearDownTwoFactorWorld(): void
    {
        Carbon::setTestNow();
    }

    /**
     * Turns two-factor on the way the settings routes do, and returns the
     * secret. The setup code used the step before now, so `code($secret)` works.
     *
     * @return array{secret: string, recovery_codes: list<string>}
     */
    protected function turnOnMfa(string $username): array
    {
        $secret = app(TotpService::class)->generateSecret();
        $mfa = app(UserMfaService::class);
        $mfa->startSetup($username, $secret);
        $codes = $mfa->enable($username, app(TotpService::class)->currentStep() - 1);

        return ['secret' => $secret, 'recovery_codes' => $codes];
    }

    protected function code(string $secret, int $stepsFromNow = 0): string
    {
        return (new Google2FA)->oathTotp($secret, app(TotpService::class)->currentStep() + $stepsFromNow);
    }

    protected function nextStep(int $steps = 1): void
    {
        Carbon::setTestNow(Carbon::now()->addSeconds(TotpService::PERIOD * $steps));
    }

    protected function signInWithPassword(string $username, string $password = 'secret', string $ip = '203.0.113.20'): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson('/api/v1/auth/token', ['username' => $username, 'password' => $password]);
    }

    protected function challengeFor(string $username): string
    {
        $response = $this->signInWithPassword($username)->assertOk()->assertJsonPath('status', 'mfa_required');

        return (string) $response->json('challenge');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function verifyChallenge(string $challenge, array $body, string $ip = '203.0.113.20'): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/verification', $body);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function replaceWithChallenge(string $challenge, array $body, string $ip = '203.0.113.20'): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/replacement', $body);
    }

    protected function openChallenges(string $username): int
    {
        return AuthChallenge::query()->where('username', $username)->whereNull('consumed_at')->count();
    }

    /**
     * @param  array<string, string>  $server
     */
    protected function dav(string $username, string $password, array $server = []): TestResponse
    {
        return $this->call('PROPFIND', '/files', [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':'.$password),
            'HTTP_DEPTH' => '0',
            'REMOTE_ADDR' => '203.0.113.9',
        ], $server));
    }

    protected function meet(string $username, string $password): ?string
    {
        return app(MeetRequestAuth::class)->tryAuthenticatedUsername(
            Request::create('/api/v1/rooms/x/configuration', 'GET', server: [
                'REMOTE_ADDR' => '203.0.113.9',
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':'.$password),
            ]),
            'SabreDAV',
        );
    }
}

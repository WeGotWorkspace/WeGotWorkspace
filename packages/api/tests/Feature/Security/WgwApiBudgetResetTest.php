<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Http\RateLimiting\WgwApiRateLimiters;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The live e2e tier resets the account budget before each test (#1677).
 * The reset is a local dev tool: production and shipped installs refuse it.
 */
final class WgwApiBudgetResetTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        config(['app.debug' => false]);
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        Cache::flush();
    }

    public function test_reset_reports_what_the_account_spent_and_gives_the_full_budget_back(): void
    {
        $this->spendAliceBudget();
        $this->get('/api/v1/me')->assertStatus(429);

        $this->assertSame(600, WgwApiRateLimiters::resetAccountBudget('alice'));

        $this->get('/api/v1/me')->assertOk();
        $this->assertSame(0, WgwApiRateLimiters::resetAccountBudget('bob'));
    }

    public function test_the_command_resets_each_named_account_on_a_local_checkout(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => '']);
        $this->spendAliceBudget();

        $this->assertSame(Command::SUCCESS, Artisan::call('wgw:e2e-reset-api-budget', ['usernames' => ['alice', 'bob']]));
        $this->assertSame('{"limit":600,"used":{"alice":600,"bob":0}}', trim(Artisan::output()));

        $this->get('/api/v1/me')->assertOk();
    }

    public function test_the_command_refuses_in_production_and_leaves_the_budget_alone(): void
    {
        $this->app['env'] = 'production';
        $this->spendAliceBudget();

        $this->assertSame(Command::FAILURE, Artisan::call('wgw:e2e-reset-api-budget', ['usernames' => ['alice']]));
        $this->assertStringContainsString('Refusing', Artisan::output());

        $this->get('/api/v1/me')->assertStatus(429);
    }

    public function test_the_command_refuses_on_a_docker_install_even_with_a_local_env(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => 'docker']);
        $this->spendAliceBudget();

        $this->assertSame(Command::FAILURE, Artisan::call('wgw:e2e-reset-api-budget', ['usernames' => ['alice']]));
        $this->assertStringContainsString('Refusing', Artisan::output());

        $this->get('/api/v1/me')->assertStatus(429);
    }

    private function spendAliceBudget(): void
    {
        $this->withBearer($this->issueBearerToken('alice'));
        for ($request = 0; $request < 600; $request++) {
            $this->get('/api/v1/me')->assertOk();
        }
    }
}

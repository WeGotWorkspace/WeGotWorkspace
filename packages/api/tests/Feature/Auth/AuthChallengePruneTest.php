<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AuthChallenge;
use App\Services\Auth\Mfa\AuthChallengeService;
use Illuminate\Console\Scheduling\Event as ScheduledEvent;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\TwoFactorTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Abandoned two-factor sign-ins leave an expired `auth_challenges` row; the
 * scheduled prune deletes them after a grace period.
 */
final class AuthChallengePruneTest extends WgwDatabaseTestCase
{
    use TwoFactorTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTwoFactorWorld();
    }

    protected function tearDown(): void
    {
        $this->tearDownTwoFactorWorld();
        parent::tearDown();
    }

    public function test_the_prune_deletes_rows_expired_past_the_grace_period_and_keeps_the_rest(): void
    {
        $now = Carbon::now();
        $this->challengeRow('long-gone', $now->copy()->subHours(2));
        $this->challengeRow('long-gone-used', $now->copy()->subDay(), consumed: true);
        $this->challengeRow('just-expired', $now->copy()->subMinutes(10));
        $this->challengeRow('still-open', $now->copy()->addMinutes(5));

        $this->assertSame(0, Artisan::call('wgw:auth:prune-challenges'));

        $this->assertStringContainsString('Deleted 2 expired two-factor sign-in challenge(s).', Artisan::output());
        $this->assertEqualsCanonicalizing(
            ['just-expired', 'still-open'],
            AuthChallenge::query()->pluck('client')->all(),
        );
    }

    public function test_an_abandoned_sign_in_is_deleted_once_it_is_past_expiry_and_grace(): void
    {
        $this->turnOnMfa('bob');
        $this->challengeFor('bob');
        $this->assertSame(1, AuthChallenge::query()->count());

        Carbon::setTestNow(Carbon::now()->addSeconds(AuthChallengeService::TTL_SECONDS + AuthChallengeService::PRUNE_GRACE_SECONDS - 1));
        Artisan::call('wgw:auth:prune-challenges');
        $this->assertSame(1, AuthChallenge::query()->count());

        Carbon::setTestNow(Carbon::now()->addSeconds(2));
        Artisan::call('wgw:auth:prune-challenges');
        $this->assertSame(0, AuthChallenge::query()->count());
    }

    public function test_the_prune_is_scheduled_hourly_without_overlap(): void
    {
        // withSchedule registers events inside Artisan::starting, so boot this app's console first.
        Artisan::call('schedule:list');

        $events = collect(app(Schedule::class)->events())
            ->filter(static fn (ScheduledEvent $event): bool => str_contains((string) $event->command, 'wgw:auth:prune-challenges'));

        // The schedule callback can run once per app boot in a test, so do not count events.
        $this->assertNotEmpty($events);
        $event = $events->first();
        $this->assertSame('0 * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
    }

    private function challengeRow(string $marker, Carbon $expiresAt, bool $consumed = false): void
    {
        AuthChallenge::query()->create([
            'id_hash' => hash('sha256', $marker),
            'username' => 'bob',
            'kind' => AuthChallenge::KIND_LOGIN,
            // `client` carries the marker so the test can tell the rows apart.
            'client' => $marker,
            'attempts' => 0,
            'expires_at' => $expiresAt,
            'consumed_at' => $consumed ? $expiresAt : null,
            'created_at' => $expiresAt->copy()->subMinutes(10),
        ]);
    }
}

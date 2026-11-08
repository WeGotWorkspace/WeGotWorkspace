<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Ownership matrix for Team availability (#1909). The target is a person,
 * not an object: dave shares Team `crew` with both actors, carol shares no
 * Team with either. Both have the switch on, so the only thing that decides
 * is the shared Team; the admin role gives no extra access.
 */
final class AvailabilityOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    private const MEMBER_GET = 'JMAP TeamMember/get';

    private const MEMBER_AVAILABILITY = 'JMAP TeamMember/getAvailability';

    private const USING = [JmapCapabilities::CORE, JmapCapabilities::AVAILABILITY];

    private string $cacheDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        $this->cacheDir = sys_get_temp_dir().'/wgw-availability-ownership-'.uniqid('', true);
        config(['cache.stores.availability.path' => $this->cacheDir]);
        Cache::purge('availability');
        // The matrix world puts everyone in a shared `colleagues` Team so they may share with
        // each other; here the shared Team is the thing under test, so only `crew` stays.
        GroupMember::query()
            ->whereIn('principal_id', Principal::query()->where('uri', 'principals/groups/colleagues')->pluck('id'))
            ->delete();
        foreach ([OwnershipPrincipals::DAVE, OwnershipPrincipals::CAROL] as $username) {
            app(AvailabilitySettings::class)->setEnabled($username, true);
        }
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->cacheDir);
        parent::tearDown();
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        foreach (Actor::signedIn() as $actor) {
            foreach ([self::MEMBER_GET, self::MEMBER_AVAILABILITY] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OwnGroup, Outcome::Allowed);
                $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::NotFound);
            }
        }
        foreach ([self::MEMBER_GET, self::MEMBER_AVAILABILITY] as $op) {
            // Team membership is checked per request: leaving `crew` ends the access.
            $cases[] = OwnershipCase::of($op, Actor::Member, Scope::OwnGroup, Outcome::NotFound)->variant('left-crew');
            $cases[] = OwnershipCase::of($op, Actor::Member, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }

        return $cases;
    }

    /**
     * @return iterable<string, array{0: OwnershipCase}>
     */
    public static function casesProvider(): iterable
    {
        foreach (self::ownershipCases() as $case) {
            yield $case->key() => [$case];
        }
    }

    #[DataProvider('casesProvider')]
    public function test_ownership_case(OwnershipCase $case): void
    {
        $this->runOwnershipCase($case, function () use ($case): void {
            $target = $case->scope === Scope::OwnGroup ? OwnershipPrincipals::DAVE : OwnershipPrincipals::CAROL;
            $accountId = $case->variant === 'foreign-account' ? $target : $this->accountIdFor($case->actor);
            if ($case->variant === 'left-crew') {
                $this->assertJmapGetOutcome($this->callAvailability($case, $accountId, $target), $target, $case->declared(Outcome::Allowed));
                $this->leaveCrew($case->actor);
            }

            $response = $this->callAvailability($case, $accountId, $target);
            $this->assertJmapGetOutcome($response, $target, $case);
            if ($case->outcome === Outcome::NotFound) {
                $this->assertSame([], $response->json('methodResponses.0.1.list'), $case->key().': nothing listed.');
            }
        });
    }

    private function callAvailability(OwnershipCase $case, string $accountId, string $target): TestResponse
    {
        $args = $case->operation === self::MEMBER_GET
            ? ['accountId' => $accountId, 'ids' => [$target]]
            : ['accountId' => $accountId, 'ids' => [$target], 'utcStart' => '2030-01-07T00:00:00Z', 'utcEnd' => '2030-01-14T00:00:00Z'];

        return $this->jmapAs($case->actor, [[substr($case->operation, strlen('JMAP ')), $args, 'c0']], self::USING);
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Services\Drive\DriveGroupResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Testing\TestResponse;
use InvalidArgumentException;
use PHPUnit\Framework\AssertionFailedError;
use PHPUnit\Framework\IncompleteTestError;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Proves the ownership matrix harness itself: actors, fixture world, and the
 * pending-row mechanics. Not an OwnershipSuite; it declares no rows.
 */
final class OwnershipHarnessTest extends WgwDatabaseTestCase
{
    use OwnershipAssertions;
    use OwnershipWorld;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
    }

    public function test_member_and_admin_tokens_authenticate_with_their_roles(): void
    {
        $this->requestAs(Actor::Member, 'GET', '/me')
            ->assertOk()
            ->assertJsonPath('username', OwnershipPrincipals::MEMBER)
            ->assertJsonPath('role', 'user');

        $this->requestAs(Actor::Admin, 'GET', '/me')
            ->assertOk()
            ->assertJsonPath('username', OwnershipPrincipals::ADMIN)
            ->assertJsonPath('role', 'admin');
    }

    public function test_anonymous_and_guest_are_refused_on_user_routes(): void
    {
        $this->assertRestOutcome(
            $this->requestAs(Actor::Anonymous, 'GET', '/me'),
            OwnershipCase::of('GET /me', Actor::Anonymous, Scope::None, Outcome::Unauthenticated),
        );

        $this->requestAs(Actor::Guest, 'GET', '/me')->assertForbidden();
    }

    public function test_only_the_admin_token_reaches_admin_routes(): void
    {
        $this->requestAs(Actor::Admin, 'GET', '/admin/state')->assertOk();
        $this->requestAs(Actor::Member, 'GET', '/admin/state')->assertForbidden();
    }

    public function test_memberships_match_the_spec(): void
    {
        $groups = app(DriveGroupResolver::class);

        // `colleagues` holds every fixture user, so they may share with each other (Epic #1915).
        $this->assertEqualsCanonicalizing(['administrators', 'crew', 'alumni', 'colleagues'], $groups->allowedGroupSlugs(OwnershipPrincipals::ADMIN));
        $this->assertEqualsCanonicalizing(['crew', 'alumni', 'colleagues'], $groups->allowedGroupSlugs(OwnershipPrincipals::MEMBER));
        $this->assertEqualsCanonicalizing(['outsiders', 'colleagues'], $groups->allowedGroupSlugs(OwnershipPrincipals::CAROL));
        $this->assertEqualsCanonicalizing(['crew', 'colleagues'], $groups->allowedGroupSlugs(OwnershipPrincipals::DAVE));
    }

    public function test_leaving_the_former_group_keeps_the_token_valid(): void
    {
        $this->leaveFormerGroup(Actor::Member);

        $this->assertNotContains(
            OwnershipPrincipals::ALUMNI,
            app(DriveGroupResolver::class)->allowedGroupSlugs(OwnershipPrincipals::MEMBER),
        );
        $this->requestAs(Actor::Member, 'GET', '/me')->assertOk();
    }

    public function test_tokens_are_not_kept_as_default_headers(): void
    {
        $this->requestAs(Actor::Member, 'GET', '/me')->assertOk();

        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_jmap_rejects_a_foreign_account_id(): void
    {
        $case = OwnershipCase::of('JMAP Notebook/get', Actor::Member, Scope::OtherUser, Outcome::AccountNotFound);

        $response = $this->jmapAs(Actor::Member, [
            ['Notebook/get', ['accountId' => OwnershipPrincipals::CAROL, 'ids' => null], 'c0'],
        ], ['urn:ietf:params:jmap:core', 'urn:wgw:jmap:notes']);

        $this->assertJmapGetOutcome($response, 'unused', $case);
    }

    public function test_a_failing_pending_row_is_reported_incomplete(): void
    {
        $case = OwnershipCase::of('GET /me', Actor::Member, Scope::None, Outcome::Allowed)->pending('P-001');

        try {
            $this->runOwnershipCase($case, fn () => $this->fail('declared outcome does not hold'));
        } catch (IncompleteTestError $incomplete) {
            $this->assertStringContainsString('P-001', $incomplete->getMessage());

            return;
        }

        $this->fail('A failing pending row must be reported incomplete.');
    }

    public function test_a_passing_pending_row_fails_so_the_marker_is_removed(): void
    {
        $case = OwnershipCase::of('GET /me', Actor::Member, Scope::None, Outcome::Allowed)->pending('P-002');

        try {
            $this->runOwnershipCase($case, fn () => $this->assertTrue(true));
        } catch (IncompleteTestError) {
            $this->fail('A passing pending row must not be reported incomplete.');
        } catch (AssertionFailedError $failure) {
            $this->assertStringContainsString('now passes', $failure->getMessage());

            return;
        }

        $this->fail('A passing pending row must fail.');
    }

    public function test_an_observed_response_is_reported_incomplete(): void
    {
        $case = $this->observedNotFoundCase();

        $this->expectException(IncompleteTestError::class);
        $this->runOwnershipCase($case, fn () => $this->assertRestOutcome($this->fakeResponse(400, 'bad_request'), $case));
    }

    public function test_a_response_that_matches_neither_outcome_fails(): void
    {
        $case = $this->observedNotFoundCase();

        $this->assertRealFailure(fn () => $this->runOwnershipCase(
            $case,
            fn () => $this->assertRestOutcome($this->fakeResponse(200, null), $case),
        ));
    }

    public function test_an_observed_response_still_enforces_the_rest_of_the_row(): void
    {
        $case = $this->observedNotFoundCase();

        $this->assertRealFailure(fn () => $this->runOwnershipCase($case, function () use ($case): void {
            $this->assertRestOutcome($this->fakeResponse(400, 'bad_request'), $case);
            $this->fail('target changed after a denied write');
        }));
    }

    public function test_a_pending_row_whose_spec_outcome_holds_fails(): void
    {
        $case = $this->observedNotFoundCase();

        try {
            $this->runOwnershipCase($case, fn () => $this->assertRestOutcome($this->fakeResponse(404, 'not_found'), $case));
        } catch (IncompleteTestError) {
            $this->fail('A row whose spec outcome holds must not be reported incomplete.');
        } catch (AssertionFailedError $failure) {
            $this->assertStringContainsString('now passes', $failure->getMessage());

            return;
        }

        $this->fail('A pending row whose spec outcome holds must fail.');
    }

    public function test_an_observed_outcome_needs_a_pending_id(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new OwnershipCase('GET /me', Actor::Member, Scope::None, Outcome::NotFound, observed: Outcome::Rejected);
    }

    public function test_pending_ids_must_be_opaque(): void
    {
        $this->expectException(InvalidArgumentException::class);

        OwnershipCase::of('GET /me', Actor::Member, Scope::None, Outcome::Allowed)->pending('member reads carol notes');
    }

    public function test_denied_ids_in_a_listing_fail(): void
    {
        $this->assertIdsAbsent(['carol-note'], ['own-note'], 'listing');

        $this->expectException(AssertionFailedError::class);
        $this->assertIdsAbsent(['carol-note'], ['own-note', 'carol-note'], 'listing');
    }

    private function observedNotFoundCase(): OwnershipCase
    {
        return OwnershipCase::of('GET /me', Actor::Member, Scope::OtherUser, Outcome::NotFound)
            ->pending('P-003', Outcome::Rejected);
    }

    private function fakeResponse(int $status, ?string $code): TestResponse
    {
        return TestResponse::fromBaseResponse(new JsonResponse($code === null ? ['ok' => true] : ['code' => $code], $status));
    }

    /**
     * @param  callable(): void  $run
     */
    private function assertRealFailure(callable $run): void
    {
        try {
            $run();
        } catch (IncompleteTestError) {
            $this->fail('This must be a real failure, not an incomplete row.');
        } catch (AssertionFailedError) {
            $this->addToAssertionCount(1);

            return;
        }

        $this->fail('This must fail.');
    }
}

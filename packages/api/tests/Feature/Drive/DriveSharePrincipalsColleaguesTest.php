<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\Principal;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The share picker lists people who share a Team with the caller and the
 * caller's own Teams, for admins too (Task #1918).
 *
 * Fixture: bob and alice (admin) share `team`; carol is in no Team. Here dave
 * and carol share `other`.
 */
#[Group('MySQLParity')]
final class DriveSharePrincipalsColleaguesTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $other = $this->seedWgwGroup('principals/groups/other', 'Other');
        foreach (['carol', 'dave'] as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($other, $member);
        }
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_member_finds_colleagues_and_own_teams_only(): void
    {
        $this->assertSame(['groups/team'], $this->principals('bob', ''));
        $this->assertSame(['alice', 'groups/team'], $this->principals('bob', 'a'));
        $this->assertSame([], $this->principals('bob', 'carol'));
        $this->assertSame([], $this->principals('bob', 'other'));
        $this->assertSame(['alice'], $this->principals('bob', 'ali'));
    }

    public function test_a_non_colleague_answers_like_an_unknown_name(): void
    {
        $this->assertSame(
            $this->response('bob', 'nobody-here'),
            $this->response('bob', 'dave'),
        );
    }

    public function test_an_admin_finds_only_people_and_teams_they_share(): void
    {
        $this->assertSame([], $this->principals('alice', 'carol'));
        $this->assertSame([], $this->principals('alice', 'dave'));
        $this->assertSame([], $this->principals('alice', 'other'));
        $this->assertSame(['bob'], $this->principals('alice', 'bob'));
        $this->assertContains('groups/team', $this->principals('alice', ''));
        $this->assertNotContains('groups/other', $this->principals('alice', ''));
    }

    public function test_a_user_in_another_team_sees_that_team_only(): void
    {
        $this->assertSame(['groups/other'], $this->principals('carol', ''));
        $this->assertSame(['dave'], $this->principals('carol', 'dave'));
        $this->assertSame([], $this->principals('carol', 'alice'));
    }

    public function test_like_wildcards_in_the_query_do_not_widen_the_result(): void
    {
        foreach (['%', '_', '%a%', 'c_rol'] as $query) {
            $this->assertNotContains('carol', $this->principals('bob', $query), $query);
            $this->assertNotContains('dave', $this->principals('bob', $query), $query);
        }
    }

    /**
     * @return list<string>
     */
    private function principals(string $username, string $query): array
    {
        $data = $this->response($username, $query)['data'] ?? [];
        $principals = array_map(static fn (array $row): string => (string) $row['principal'], (array) $data);
        sort($principals);

        return $principals;
    }

    /**
     * @return array<string, mixed>
     */
    private function response(string $username, string $query): array
    {
        $token = $this->issueBearerTokenFor($username);
        $body = $this->withBearer($token)
            ->getJson('/api/v1/files/shares/principals?query='.rawurlencode($query))
            ->assertOk()
            ->json();
        $this->assertIsArray($body);

        return $body;
    }
}

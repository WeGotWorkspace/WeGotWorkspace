<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The invitee directory lists colleagues only (Task #1918). Admins find everyone,
 * but `sharesTeam` follows real Team membership, so the DM rail and share
 * dialogs stay inside the admin's own Teams.
 *
 * bob and dave share Team t1. carol and erin share Team t2. frank is in no Team.
 * alice is the admin and in no Team with anyone else.
 */
final class CalendarSchedulingInviteesColleaguesTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        foreach (['dave' => 'Dave', 'erin' => 'Erin', 'frank' => 'Frank'] as $username => $name) {
            $this->seedWgwUser($username, displayName: $name);
        }
        $this->putInTeam('t1', ['bob', 'dave']);
        $this->putInTeam('t2', ['carol', 'erin']);
    }

    public function test_a_member_gets_only_people_who_share_a_team_and_every_entry_shares_a_team(): void
    {
        $body = $this->invitees('bob');

        $this->assertSame(['bob', 'dave'], $this->usernames($body['list']));
        foreach ($body['list'] as $entry) {
            $this->assertTrue($entry['sharesTeam'], $entry['username']);
        }
        $this->assertIsBool($body['canSubmitEmail']);
    }

    public function test_colleagues_are_not_transitive(): void
    {
        $this->putInTeam('t3', ['dave', 'carol']);

        $this->assertSame(['bob', 'dave'], $this->usernames($this->invitees('bob')['list']));
        $this->assertSame(['bob', 'carol', 'dave', 'erin'], $this->usernames($this->invitees('dave')['list']));
    }

    public function test_a_user_in_no_team_gets_only_themself(): void
    {
        $this->assertSame(['frank'], $this->usernames($this->invitees('frank')['list']));
    }

    public function test_an_admin_gets_everyone_with_shares_team_from_real_membership(): void
    {
        $this->putInTeam('t4', ['alice', 'erin']);

        $list = $this->invitees('alice')['list'];

        $this->assertSame(['alice', 'bob', 'carol', 'dave', 'erin', 'frank'], $this->usernames($list));
        $sharesTeam = array_column($list, 'sharesTeam', 'username');
        $this->assertTrue($sharesTeam['alice']);
        $this->assertTrue($sharesTeam['erin']);
        $this->assertFalse($sharesTeam['bob']);
        $this->assertFalse($sharesTeam['carol']);
        $this->assertFalse($sharesTeam['frank']);
    }

    public function test_can_submit_email_does_not_depend_on_the_caller(): void
    {
        $this->assertSame(
            $this->invitees('alice')['canSubmitEmail'],
            $this->invitees('frank')['canSubmitEmail'],
        );
    }

    public function test_a_membership_change_shows_on_the_next_request(): void
    {
        $this->assertNotContains('frank', $this->usernames($this->invitees('bob')['list']));

        $this->putInTeam('t1', ['frank']);

        $this->assertContains('frank', $this->usernames($this->invitees('bob')['list']));
    }

    /**
     * @param  list<string>  $usernames
     */
    private function putInTeam(string $slug, array $usernames): void
    {
        $uri = 'principals/groups/'.$slug;
        $team = Principal::query()->where('uri', $uri)->first() ?? $this->seedWgwGroup($uri, strtoupper($slug));
        foreach ($usernames as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    /**
     * @return array{list: list<array{username: string, email: string, name: string, sharesTeam: bool}>, canSubmitEmail: bool}
     */
    private function invitees(string $username): array
    {
        $body = $this->withBearer($this->issueBearerTokenFor($username))
            ->getJson('/api/v1/calendars/scheduling/invitees')
            ->assertOk()
            ->assertJsonStructure(['list' => [['username', 'email', 'name', 'sharesTeam']], 'canSubmitEmail'])
            ->json();
        $this->assertIsArray($body);

        /** @var array{list: list<array{username: string, email: string, name: string, sharesTeam: bool}>, canSubmitEmail: bool} $body */
        return $body;
    }

    /**
     * @param  list<array{username: string}>  $list
     * @return list<string>
     */
    private function usernames(array $list): array
    {
        $usernames = array_map(static fn (array $row): string => $row['username'], $list);
        sort($usernames);

        return $usernames;
    }
}

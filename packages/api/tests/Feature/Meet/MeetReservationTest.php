<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\MeetReservation;
use App\Models\Principal;
use App\Services\Meet\MeetReservationService;
use Illuminate\Support\Carbon;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetReservationTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const ROOM = 'abcd-efgh-ijkl';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_post_requires_authentication(): void
    {
        $this->postJson('/api/v1/meetings/rooms', [
            'room' => self::ROOM,
            'ownerPrincipal' => 'u:bob',
        ])->assertUnauthorized();
    }

    public function test_post_forbids_claiming_another_users_principal(): void
    {
        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'u:bob',
            ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->assertNull(MeetReservation::query()->find(self::ROOM));
    }

    public function test_post_forbids_claiming_a_group_without_calendar_write_access(): void
    {
        $this->seedWgwGroup('principals/groups/design', 'Design');
        $this->provisionGroupCalendar('design', 'Design');

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'groups/design',
            ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->assertNull(MeetReservation::query()->find(self::ROOM));
    }

    public function test_post_forbids_claiming_a_group_with_read_only_calendar_share(): void
    {
        $this->seedDesignGroupWith('bob');
        $this->shareGroupCalendar($this->provisionGroupCalendar('design', 'Design'), 'carol', write: false);

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'groups/design',
            ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->assertNull(MeetReservation::query()->find(self::ROOM));
    }

    public function test_post_allows_claiming_own_principal(): void
    {
        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'u:carol',
            ])
            ->assertCreated()
            ->assertJson([
                'ownerPrincipal' => 'u:carol',
                'createdBy' => 'u:carol',
            ]);
    }

    public function test_post_allows_claiming_a_group_the_user_belongs_to(): void
    {
        $this->seedDesignGroupWith('bob');

        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'groups/design')
            ->assertCreated()
            ->assertJson([
                'ownerPrincipal' => 'groups/design',
                'createdBy' => 'u:bob',
            ]);
    }

    public function test_post_allows_claiming_a_group_via_calendar_write_share(): void
    {
        $this->seedDesignGroupWith('bob');
        $this->shareGroupCalendar($this->provisionGroupCalendar('design', 'Design'), 'carol', write: true);

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'groups/design',
            ])
            ->assertCreated()
            ->assertJson([
                'ownerPrincipal' => 'groups/design',
                'createdBy' => 'u:carol',
            ]);
    }

    public function test_post_records_created_by_and_nullable_expires_at(): void
    {
        $this->reserveMeetRoom(self::ROOM)
            ->assertCreated()
            ->assertJson([
                'roomId' => self::ROOM,
                'reserved' => true,
                'active' => false,
                'ownerPrincipal' => 'u:bob',
                'createdBy' => 'u:bob',
                'expiresAt' => null,
            ]);

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('u:bob', $row->owner_principal);
        $this->assertSame('u:bob', $row->created_by);
        $this->assertNull($row->expires_at);
    }

    public function test_post_accepts_finite_expires_at(): void
    {
        $expires = Carbon::parse('2026-09-15T12:00:00Z');

        $this->reserveMeetRoom(self::ROOM, extra: ['expiresAt' => $expires->toISOString()])
            ->assertCreated()
            ->assertJsonPath('expiresAt', $expires->toISOString());
    }

    public function test_post_is_idempotent_and_keeps_owner_and_created_by(): void
    {
        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'u:bob')->assertCreated();

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/meetings/rooms', [
                'room' => self::ROOM,
                'ownerPrincipal' => 'u:carol',
                'expiresAt' => '2026-10-01T00:00:00Z',
            ])
            ->assertCreated()
            ->assertExactJson([
                'reserved' => true,
                'active' => false,
                'roomId' => self::ROOM,
            ]);

        $status = $this->withBearer($this->userBearerToken())
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertJson([
                'ownerPrincipal' => 'u:bob',
                'createdBy' => 'u:bob',
            ]);
        $this->assertTrue(
            Carbon::parse((string) $status->json('expiresAt'))->equalTo(Carbon::parse('2026-10-01T00:00:00Z')),
        );
    }

    public function test_post_omit_expires_at_on_existing_row_does_not_wipe_clock(): void
    {
        $expires = Carbon::parse('2026-09-15T12:00:00Z');
        $this->reserveMeetRoom(self::ROOM, extra: ['expiresAt' => $expires->toISOString()])
            ->assertCreated();

        $this->reserveMeetRoom(self::ROOM)
            ->assertCreated()
            ->assertJsonPath('expiresAt', $expires->toISOString());
    }

    public function test_guest_get_returns_reserved_and_active_only(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();

        $this->withoutBearer()
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertExactJson([
                'reserved' => true,
                'active' => false,
            ]);
    }

    public function test_get_without_reservation_is_404(): void
    {
        $this->getJson($this->meetStatusPath(self::ROOM))
            ->assertNotFound()
            ->assertJson(['error' => 'not_found']);
    }

    public function test_created_by_gets_full_get_body(): void
    {
        $this->seedDesignGroupWith('bob');
        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'groups/design')->assertCreated();

        $this->withBearer($this->userBearerToken())
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertJson([
                'reserved' => true,
                'active' => false,
                'ownerPrincipal' => 'groups/design',
                'createdBy' => 'u:bob',
            ])
            ->assertJsonStructure(['expiresAt']);
    }

    public function test_owner_principal_member_gets_full_get_body(): void
    {
        $this->seedDesignGroupWith('bob', 'carol');
        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'groups/design')->assertCreated();

        $this->withBearer($this->carolBearerToken())
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertJson([
                'reserved' => true,
                'ownerPrincipal' => 'groups/design',
                'createdBy' => 'u:bob',
            ]);
    }

    public function test_signed_in_non_member_gets_guest_get_body(): void
    {
        $this->seedDesignGroupWith('bob');
        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'groups/design')->assertCreated();

        $this->withBearer($this->carolBearerToken())
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertExactJson([
                'reserved' => true,
                'active' => false,
            ]);
    }

    public function test_patch_expires_at_by_created_by(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();
        $expires = Carbon::parse('2026-09-25T15:00:00Z');

        $this->withBearer($this->userBearerToken())
            ->patchJson($this->meetStatusPath(self::ROOM), [
                'expiresAt' => $expires->toISOString(),
            ])
            ->assertOk()
            ->assertJsonPath('expiresAt', $expires->toISOString());
    }

    public function test_patch_expires_at_by_owner_principal_member(): void
    {
        $this->seedDesignGroupWith('bob', 'carol');
        $this->reserveMeetRoom(self::ROOM, ownerPrincipal: 'groups/design')->assertCreated();

        $this->withBearer($this->carolBearerToken())
            ->patchJson($this->meetStatusPath(self::ROOM), ['expiresAt' => null])
            ->assertOk()
            ->assertJson(['expiresAt' => null]);
    }

    public function test_patch_forbidden_for_stranger(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();

        $this->withBearer($this->carolBearerToken())
            ->patchJson($this->meetStatusPath(self::ROOM), [
                'expiresAt' => Carbon::now()->addDay()->toISOString(),
            ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_patch_requires_authentication(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();

        $this->withoutBearer()
            ->patchJson($this->meetStatusPath(self::ROOM), ['expiresAt' => null])
            ->assertUnauthorized();
    }

    public function test_guest_get_becomes_active_after_host_joins(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rooms/'.self::ROOM.'/participants', [
                'peerId' => 'host-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $this->withoutBearer()
            ->getJson($this->meetStatusPath(self::ROOM))
            ->assertOk()
            ->assertExactJson([
                'reserved' => true,
                'active' => true,
            ]);
    }

    public function test_sweeper_skips_null_expires_at(): void
    {
        $this->reserveMeetRoom(self::ROOM)->assertCreated();

        $deleted = app(MeetReservationService::class)->sweepExpiredNeverActivated();

        $this->assertSame(0, $deleted);
        $this->assertNotNull(MeetReservation::query()->find(self::ROOM));
    }

    public function test_sweeper_prunes_never_activated_past_expires_at(): void
    {
        $this->reserveMeetRoom(self::ROOM, extra: [
            'expiresAt' => Carbon::now()->subHour()->toISOString(),
        ])->assertCreated();

        $deleted = app(MeetReservationService::class)->sweepExpiredNeverActivated();

        $this->assertSame(1, $deleted);
        $this->assertNull(MeetReservation::query()->find(self::ROOM));
        $this->getJson($this->meetStatusPath(self::ROOM))->assertNotFound();
    }

    public function test_sweeper_keeps_activated_past_expires_at(): void
    {
        $this->reserveMeetRoom(self::ROOM, extra: [
            'expiresAt' => Carbon::now()->addHour()->toISOString(),
        ])->assertCreated();

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rooms/'.self::ROOM.'/participants', [
                'peerId' => 'host-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row?->activated_at);
        $row->expires_at = Carbon::now()->subHour();
        $row->save();

        $deleted = app(MeetReservationService::class)->sweepExpiredNeverActivated();

        $this->assertSame(0, $deleted);
        $this->assertNotNull(MeetReservation::query()->find(self::ROOM));
    }

    private function seedDesignGroupWith(string ...$usernames): void
    {
        $group = $this->seedWgwGroup('principals/groups/design', 'Design');
        foreach ($usernames as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($group, $principal);
        }
    }
}

<?php

declare(strict_types=1);

namespace Tests\Unit\Meet;

use App\Models\MeetReservation;
use App\Models\Principal;
use App\Services\Meet\MeetReservationService;
use Illuminate\Support\Carbon;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetReservationServiceTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const ROOM = 'mnop-qrst-uvwx';

    private MeetReservationService $reservations;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
        $this->reservations = app(MeetReservationService::class);
    }

    public function test_reserve_is_idempotent_and_keeps_created_by(): void
    {
        $this->reservations->reserve(self::ROOM, 'u:bob', 'u:bob', null);
        $this->reservations->reserve(
            self::ROOM,
            'u:carol',
            'u:carol',
            Carbon::parse('2026-12-01T00:00:00Z'),
        );

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('u:bob', $row->owner_principal);
        $this->assertSame('u:bob', $row->created_by);
        $this->assertTrue($row->expires_at?->equalTo(Carbon::parse('2026-12-01T00:00:00Z')));
    }

    public function test_reserve_normalizes_bare_username_created_by(): void
    {
        $this->reservations->reserve(self::ROOM, 'groups/design', 'bob', null);

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertSame('u:bob', $row?->created_by);
        $this->assertSame('groups/design', $row?->owner_principal);
    }

    public function test_patch_expires_at_sets_null(): void
    {
        $this->reservations->reserve(self::ROOM, 'u:bob', 'u:bob', Carbon::now()->addDays(7));
        $this->reservations->patchExpiresAt(self::ROOM, null);

        $this->assertNull(MeetReservation::query()->find(self::ROOM)?->expires_at);
    }

    public function test_can_manage_created_by_even_when_not_group_member(): void
    {
        $this->seedWgwGroup('principals/groups/design', 'Design');
        $this->reservations->reserve(self::ROOM, 'groups/design', 'u:bob', null);
        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);

        $this->assertTrue($this->reservations->canManage('bob', $row));
        $this->assertFalse($this->reservations->canManage('carol', $row));
    }

    public function test_can_claim_own_principal_or_group_calendar_write(): void
    {
        $group = $this->seedWgwGroup('principals/groups/design', 'Design');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($group, $bob);

        $this->assertTrue($this->reservations->canClaimOwnerPrincipal('bob', 'u:bob'));
        $this->assertTrue($this->reservations->canClaimOwnerPrincipal('bob', 'groups/design'));
        $this->assertFalse($this->reservations->canClaimOwnerPrincipal('carol', 'u:bob'));
        $this->assertFalse($this->reservations->canClaimOwnerPrincipal('carol', 'groups/design'));

        $instance = $this->provisionGroupCalendar('design', 'Design');
        $this->shareGroupCalendar($instance, 'carol', write: true);
        $this->assertTrue($this->reservations->canClaimOwnerPrincipal('carol', 'groups/design'));

        $this->shareGroupCalendar($instance, 'alice', write: false);
        $this->assertFalse($this->reservations->canClaimOwnerPrincipal('alice', 'groups/design'));
    }

    public function test_ad_hoc_expires_at_is_start_plus_30_days(): void
    {
        $start = Carbon::parse('2026-08-26T10:00:00Z');

        $this->assertTrue(
            $this->reservations->adHocExpiresAt($start)->equalTo($start->copy()->addDays(30)),
        );
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Models\MeetReservation;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarRepository;
use App\Services\Settings\GroupMembershipResolver;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * Reservation persistence for Meet HTTP and the calendar ICS-write hook.
 *
 * Idempotent on room id: existing ownerPrincipal / createdBy are kept;
 * expiresAt is always overwritten when the caller supplies a clock.
 */
final class MeetReservationService
{
    public const ROOM_ID_PATTERN = '/^[A-Za-z0-9_-]{4,64}$/';

    public const OWNER_PRINCIPAL_PATTERN = '/^(?:u:[A-Za-z0-9._-]+|groups\/[a-z0-9_-]+)$/';

    public function __construct(
        private readonly GroupMembershipResolver $groups,
        private readonly CalendarRepository $calendars,
    ) {}

    public function actorPrincipal(string $username): string
    {
        return 'u:'.$username;
    }

    public function find(string $room): ?MeetReservation
    {
        $row = MeetReservation::query()->find($room);

        return $row instanceof MeetReservation ? $row : null;
    }

    public function require(string $room): MeetReservation
    {
        $row = $this->find($room);
        if ($row instanceof MeetReservation) {
            return $row;
        }

        throw new MeetResponseException(404, [
            'error' => 'not_found',
            'message' => 'Meeting room is not reserved.',
        ]);
    }

    public function reserve(
        string $room,
        string $ownerPrincipal,
        string $createdBy,
        ?DateTimeInterface $expiresAt,
    ): MeetReservation {
        $createdBy = $this->normalizeActor($createdBy);
        $existing = $this->find($room);
        if ($existing instanceof MeetReservation) {
            $existing->expires_at = $expiresAt;
            $existing->save();

            return $existing;
        }

        return MeetReservation::query()->create([
            'id' => $room,
            'owner_principal' => $ownerPrincipal,
            'created_by' => $createdBy,
            'expires_at' => $expiresAt,
        ]);
    }

    public function patchExpiresAt(string $room, ?DateTimeInterface $expiresAt): void
    {
        $existing = $this->find($room);
        if (! $existing instanceof MeetReservation) {
            return;
        }

        $existing->expires_at = $expiresAt;
        $existing->save();
    }

    public function canClaimOwnerPrincipal(string $username, string $ownerPrincipal): bool
    {
        if ($username === '') {
            return false;
        }
        if ($ownerPrincipal === $this->actorPrincipal($username)) {
            return true;
        }
        if (! str_starts_with($ownerPrincipal, 'groups/')) {
            return false;
        }
        $groupSlug = substr($ownerPrincipal, strlen('groups/'));
        if ($groupSlug === '') {
            return false;
        }

        return $this->calendars->userMayWriteEventsOwnedBy(
            $username,
            AdminConstants::GROUP_PREFIX.$groupSlug,
        );
    }

    public function canManage(?string $username, MeetReservation $row): bool
    {
        if ($username === null || $username === '') {
            return false;
        }
        $actor = $this->actorPrincipal($username);
        if ($row->created_by === $actor || $row->owner_principal === $actor) {
            return true;
        }

        return $this->isOwnerPrincipalMember($username, (string) $row->owner_principal);
    }

    private function isOwnerPrincipalMember(string $username, string $ownerPrincipal): bool
    {
        if (! str_starts_with($ownerPrincipal, 'groups/')) {
            return false;
        }
        $groupUri = AdminConstants::GROUP_PREFIX.substr($ownerPrincipal, strlen('groups/'));

        return in_array('principals/'.$username, $this->groups->memberPrincipalUris($groupUri), true);
    }

    public function adHocExpiresAt(DateTimeInterface $start): Carbon
    {
        return Carbon::instance($start)->copy()->addDays(30);
    }

    public function markActivated(string $room): void
    {
        $row = $this->find($room);
        if (! $row instanceof MeetReservation || $row->activated_at !== null) {
            return;
        }
        $row->activated_at = Carbon::now();
        $row->save();
    }

    public function sweepExpiredNeverActivated(): int
    {
        return MeetReservation::query()
            ->whereNull('activated_at')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', Carbon::now())
            ->delete();
    }

    private function normalizeActor(string $createdBy): string
    {
        $trimmed = trim($createdBy);
        if ($trimmed === '') {
            return $trimmed;
        }
        if (str_starts_with($trimmed, 'u:') || str_starts_with($trimmed, 'groups/')) {
            return $trimmed;
        }

        return 'u:'.$trimmed;
    }
}

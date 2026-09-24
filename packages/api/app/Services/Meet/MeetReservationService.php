<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Events\EventDispatch;
use App\Models\CalendarObject;
use App\Models\MeetReservation;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarMeetLinkHref;
use App\Services\Calendars\CalendarPrincipalAddresses;
use App\Services\Calendars\CalendarRepository;
use App\Services\Calendars\Conversion\LocationConversionSupport;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Notify\MeetStartedNotify;
use App\Services\Settings\GroupMembershipResolver;
use DateTimeInterface;
use Illuminate\Support\Carbon;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

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
        private readonly MeetChannelJoinPolicy $channelJoinPolicy,
        private readonly ChatChannelRepository $channels,
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly CalendarMeetLinkHref $meetHrefs,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
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

    public function markActivated(string $room, ?string $actorUsername = null): void
    {
        $row = $this->find($room);
        if (! $row instanceof MeetReservation || $row->activated_at !== null) {
            return;
        }
        $row->activated_at = Carbon::now();
        $row->save();

        $actor = $actorUsername ?? $this->usernameFromActorPrincipal((string) $row->created_by);
        if ($actor === '') {
            $actor = 'system';
        }
        $recipients = $this->startedRecipients($room, $row);
        if ($recipients === []) {
            return;
        }
        $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
        $this->eventDispatch->fireMutation(
            $actor,
            'meet',
            MeetStartedNotify::ACTION,
            'meet/'.$room,
            MeetStartedNotify::eventData(
                MeetStartedNotify::actorLabel($actor),
                $room,
                $recipients,
                $channel?->channelUri,
                $channel !== null ? ($channel->isDm ? 'dm' : 'channel') : null,
            ),
        );
    }

    /**
     * @return list<string>
     */
    private function startedRecipients(string $room, MeetReservation $row): array
    {
        $out = [];
        $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
        if ($channel !== null) {
            $instance = $this->channels->findAccessibleChannel(
                $this->usernameFromActorPrincipal((string) $row->created_by) ?: 'system',
                $channel->channelUri,
            );
            // Prefer owner-side instance lookup for roster.
            if ($instance === null) {
                $owner = $this->usernameFromOwnerPrincipal((string) $row->owner_principal);
                if ($owner !== '') {
                    $instance = $this->channels->findAccessibleChannel($owner, $channel->channelUri);
                }
            }
            if ($instance !== null) {
                foreach ($this->channels->rosterUsernames($instance, null) as $username) {
                    $out[strtolower($username)] = strtolower($username);
                }
            }
        }

        $owner = $this->usernameFromOwnerPrincipal((string) $row->owner_principal);
        if ($owner !== '') {
            $out[$owner] = $owner;
        }
        $createdBy = $this->usernameFromActorPrincipal((string) $row->created_by);
        if ($createdBy !== '') {
            $out[$createdBy] = $createdBy;
        }

        foreach ($this->calendarAttendeeUsernames($room) as $username) {
            $out[$username] = $username;
        }

        return array_values($out);
    }

    /**
     * Internal WGW principals on VEVENTs whose conference href matches this room.
     * External mailto attendees (no principal) are skipped.
     *
     * @return list<string>
     */
    private function calendarAttendeeUsernames(string $room): array
    {
        $needle = strtolower(trim($room));
        if ($needle === '') {
            return [];
        }

        $rows = CalendarObject::query()
            ->where('componenttype', 'VEVENT')
            ->where('calendardata', 'like', '%'.$needle.'%')
            ->limit(50)
            ->get(['calendardata']);

        $out = [];
        foreach ($rows as $row) {
            $raw = is_string($row->calendardata) ? $row->calendardata : (string) $row->calendardata;
            if ($raw === '') {
                continue;
            }
            try {
                $parsed = Reader::read($raw);
            } catch (\Throwable) {
                continue;
            }
            foreach ($parsed->select('VEVENT') as $vevent) {
                if (! $vevent instanceof VEvent) {
                    continue;
                }
                $href = LocationConversionSupport::conferenceHrefFromVEvent($vevent);
                if ($href === null || $this->meetHrefs->parseWgwRoom($href) !== $needle) {
                    continue;
                }
                if (! isset($vevent->ATTENDEE)) {
                    continue;
                }
                foreach ($vevent->ATTENDEE as $attendee) {
                    $mailto = trim((string) $attendee);
                    if ($mailto === '') {
                        continue;
                    }
                    $principal = $this->addresses->principalForMailto($mailto);
                    if ($principal === null) {
                        continue;
                    }
                    $uri = (string) $principal->uri;
                    if (! str_starts_with($uri, 'principals/') || str_starts_with($uri, AdminConstants::GROUP_PREFIX)) {
                        continue;
                    }
                    $username = strtolower(substr($uri, strlen('principals/')));
                    if ($username !== '' && ! str_contains($username, '/')) {
                        $out[$username] = $username;
                    }
                }
            }
        }

        return array_values($out);
    }

    private function usernameFromActorPrincipal(string $createdBy): string
    {
        $trimmed = trim($createdBy);
        if (str_starts_with($trimmed, 'u:')) {
            return strtolower(substr($trimmed, 2));
        }
        if (str_starts_with($trimmed, 'principals/')) {
            $rest = substr($trimmed, strlen('principals/'));
            if ($rest !== '' && ! str_contains($rest, '/')) {
                return strtolower($rest);
            }
        }

        return strtolower($trimmed);
    }

    private function usernameFromOwnerPrincipal(string $ownerPrincipal): string
    {
        $trimmed = trim($ownerPrincipal);
        if (str_starts_with($trimmed, 'u:')) {
            return strtolower(substr($trimmed, 2));
        }

        return '';
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

<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Meetings;

use App\Http\Requests\Api\V1\MeetPatchRoomRequest;
use App\Http\Requests\Api\V1\MeetReserveRoomRequest;
use App\Http\Resources\Api\V1\MeetRoomResource;
use App\Models\MeetReservation;
use App\Services\Meet\MeetActorResolver;
use App\Services\Meet\MeetReservationService;
use App\Services\Meet\MeetResponseException;
use App\Services\Meet\MeetSignalingService;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

final class MeetingsController
{
    public function __construct(
        private MeetSignalingService $meet,
        private MeetReservationService $reservations,
        private MeetActorResolver $actors,
    ) {}

    public function store(MeetReserveRoomRequest $request): JsonResponse
    {
        $username = $this->requireUsername($request);
        $this->reservations->sweepExpiredNeverActivated();

        $validated = $request->validated();
        $roomId = (string) $validated['room'];
        $ownerPrincipal = (string) $validated['ownerPrincipal'];
        if (! $this->reservations->canClaimOwnerPrincipal($username, $ownerPrincipal)) {
            throw new MeetResponseException(403, [
                'error' => 'forbidden',
                'message' => 'You can only reserve a room for your own principal or a group calendar you can write.',
            ]);
        }
        $existing = $this->reservations->find($roomId);
        $expiresAt = array_key_exists('expiresAt', $request->json()->all())
            ? $this->parseExpiresAt($validated['expiresAt'] ?? null)
            : $existing?->expires_at;

        $this->reservations->reserve(
            $roomId,
            $ownerPrincipal,
            $this->reservations->actorPrincipal($username),
            $expiresAt,
        );

        return $this->reservationResponse($roomId, $username, includeRoomId: true)
            ->setStatusCode(201);
    }

    public function show(Request $request, string $roomId): JsonResponse
    {
        $this->reservations->sweepExpiredNeverActivated();
        $row = $this->reservations->require($roomId);
        $username = $this->actors->tryAuthenticatedUsername($request);

        return $this->reservationResponse($roomId, $username, includeRoomId: false, row: $row);
    }

    public function update(MeetPatchRoomRequest $request, string $roomId): JsonResponse
    {
        $username = $this->requireUsername($request);
        $this->reservations->sweepExpiredNeverActivated();
        $row = $this->reservations->require($roomId);
        if (! $this->reservations->canManage($username, $row)) {
            throw new MeetResponseException(403, [
                'error' => 'forbidden',
                'message' => 'Only the reservation creator or an owner-principal member can update expiry.',
            ]);
        }

        $this->reservations->patchExpiresAt(
            $roomId,
            $this->parseExpiresAt($request->validated()['expiresAt'] ?? null),
        );

        return $this->reservationResponse($roomId, $username, includeRoomId: false);
    }

    /**
     * @return non-empty-string
     */
    private function requireUsername(Request $request): string
    {
        $username = $this->actors->tryAuthenticatedUsername($request);
        if ($username === null || $username === '') {
            throw new MeetResponseException(401, [
                'error' => 'auth_required',
                'message' => 'Sign in to reserve a meeting room.',
            ]);
        }

        return $username;
    }

    private function parseExpiresAt(mixed $value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof DateTimeInterface) {
            return Carbon::instance($value);
        }

        return Carbon::parse((string) $value);
    }

    private function reservationResponse(
        string $roomId,
        ?string $username,
        bool $includeRoomId,
        ?MeetReservation $row = null,
    ): JsonResponse {
        $row ??= $this->reservations->require($roomId);
        $active = $this->meet->roomStatus(['room' => $roomId])['active'];
        $payload = [
            'active' => $active,
            'ownerPrincipal' => $row->owner_principal,
            'createdBy' => $row->created_by,
            'expiresAt' => $row->expires_at?->toISOString(),
        ];
        if ($includeRoomId) {
            $payload['roomId'] = $roomId;
        }

        return (new MeetRoomResource(
            $this->reservations->canManage($username, $row),
            $payload,
        ))->response();
    }
}

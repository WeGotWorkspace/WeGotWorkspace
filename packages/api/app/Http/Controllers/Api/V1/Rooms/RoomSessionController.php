<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Rooms;

use App\Exceptions\ApiHttpException;
use App\Services\Collab\DocCollabSignalingService;
use App\Services\Meet\MeetSignalingService;
use App\Services\Principal\PrincipalSignalingService;
use App\Services\Rtc\RoomIdCodec;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class RoomSessionController
{
    public function __construct(
        private RoomIdCodec $roomIds,
        private MeetSignalingService $meet,
        private DocCollabSignalingService $collab,
        private PrincipalSignalingService $principal,
    ) {}

    public function storeParticipant(Request $request, string $roomId): JsonResponse
    {
        $decoded = $this->decodeRoom($roomId);
        $body = $this->bodyWithRoom($request, $decoded['room']);

        return match ($decoded['channel']) {
            'meet' => response()->json($this->meet->join($request, $body)),
            'collab' => response()->json($this->collab->join($request, $body)),
            'principal' => response()->json($this->principal->join($request, $body)),
        };
    }

    public function indexEvents(Request $request, string $roomId): JsonResponse|Response
    {
        $decoded = $this->decodeRoom($roomId);
        $body = $this->bodyWithRoom($request, $decoded['room']);
        $body['peerId'] = $body['peerId'] ?? $request->query('peerId');
        $body['since'] = $body['since'] ?? $request->query('since', 0);
        $body['sig'] = $body['sig'] ?? $request->query('sig');
        if ($request->query('sessionKey') !== null) {
            $body['sessionKey'] = $request->query('sessionKey');
        }

        $result = match ($decoded['channel']) {
            'meet' => $this->meet->poll($request, $body),
            'collab' => $this->collab->poll($request, $body),
            'principal' => $this->principal->poll($request, $body),
        };

        if ($this->pollResultUnchanged($result, $body['sig'] ?? null)) {
            return response()->noContent();
        }

        return response()->json($result);
    }

    /**
     * Nothing-new poll contract: clients echo the `rosterSig` of a previous poll via
     * `?sig=`; when the roster is unchanged and no messages are pending, the endpoint
     * answers 204 No Content instead of the full payload.
     *
     * @param  array<string, mixed>  $result
     */
    private function pollResultUnchanged(array $result, mixed $clientSig): bool
    {
        if (($result['unchanged'] ?? false) === true) {
            return true;
        }
        if (! is_string($clientSig) || $clientSig === '') {
            return false;
        }

        return ($result['rosterSig'] ?? null) === $clientSig
            && ($result['messages'] ?? null) === [];
    }

    public function storeEvent(Request $request, string $roomId): JsonResponse
    {
        $decoded = $this->decodeRoom($roomId);
        $body = $this->bodyWithRoom($request, $decoded['room']);

        return match ($decoded['channel']) {
            'meet' => response()->json($this->meet->send($request, $body)),
            'collab' => response()->json($this->collab->send($request, $body)),
            'principal' => response()->json($this->principal->send($request, $body)),
        };
    }

    public function destroyParticipant(Request $request, string $roomId, string $participantId): JsonResponse
    {
        $decoded = $this->decodeRoom($roomId);
        $body = $this->bodyWithRoom($request, $decoded['room']);
        $body['peerId'] = $participantId === 'me'
            ? ($body['peerId'] ?? $request->query('peerId'))
            : $participantId;

        return match ($decoded['channel']) {
            'meet' => response()->json($this->meet->leave($request, $body)),
            'collab' => response()->json($this->collab->leave($request, $body)),
            'principal' => response()->json($this->principal->leave($request, $body)),
        };
    }

    public function configuration(string $roomId): JsonResponse
    {
        $decoded = $this->decodeRoom($roomId);

        return match ($decoded['channel']) {
            'meet' => response()->json(['rtc' => $this->meet->rtcSettings()]),
            'collab' => response()->json(['rtc' => $this->collab->rtcSettings()]),
            'principal' => response()->json(['rtc' => $this->principal->rtcSettings()]),
        };
    }

    public function storeMessage(Request $request, string $roomId): JsonResponse
    {
        $decoded = $this->decodeRoom($roomId);
        if ($decoded['channel'] !== 'meet') {
            throw new ApiHttpException(405, 'Chat is only supported in meeting rooms.', 'method_not_allowed');
        }

        $body = $this->bodyWithRoom($request, $decoded['room']);

        return response()->json($this->meet->chat($request, $body));
    }

    /**
     * @return array{channel: 'meet'|'collab'|'principal', room: string}
     */
    private function decodeRoom(string $roomId): array
    {
        try {
            return $this->roomIds->decode($roomId);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function bodyWithRoom(Request $request, string $room): array
    {
        $body = $request->json()->all();
        if (! is_array($body)) {
            $body = [];
        }
        $body['room'] = $room;

        return $body;
    }
}

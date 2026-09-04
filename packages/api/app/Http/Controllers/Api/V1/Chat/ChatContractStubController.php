<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Chat;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Placeholder for the /chat contract (Epic #701, spec 701-meet-chat-backend).
 *
 * The OpenAPI ↔ routes parity gate (OpenApiRouteContractTest) is bidirectional,
 * so every documented /chat operation needs a registered route. Chunks B/C
 * replace this stub with ChatChannelsController / ChatMessagesController;
 * until then every operation answers 501 Not Implemented.
 *
 * TODO(chunk-b-channels, chunk-c-messages): replace with real controllers.
 */
final class ChatContractStubController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'error' => 'not_implemented',
            'code' => 'chat_contract_pending',
        ], 501);
    }
}

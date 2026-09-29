<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Requests\Api\V1\MfaChallengeConfirmRequest;
use App\Http\Requests\Api\V1\MfaChallengeVerifyRequest;
use App\Services\Auth\MfaChallengeService;
use App\Services\Auth\UiSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MfaChallengeController
{
    public function __construct(
        private MfaChallengeService $challenges,
        private UiSessionService $uiSession,
    ) {}

    public function verify(MfaChallengeVerifyRequest $request, string $challenge): JsonResponse
    {
        $validated = $request->validated();

        return response()->json($this->challenges->verify(
            $challenge,
            isset($validated['code']) ? (string) $validated['code'] : null,
            isset($validated['recovery_code']) ? (string) $validated['recovery_code'] : null,
            (string) $request->ip(),
        ));
    }

    public function provision(Request $request, string $challenge): JsonResponse
    {
        return response()->json($this->challenges->provision($challenge, $request->getHost()));
    }

    public function confirm(MfaChallengeConfirmRequest $request, string $challenge): JsonResponse
    {
        $payload = $this->challenges->confirm(
            $challenge,
            (string) $request->validated()['code'],
            (string) $request->ip(),
        );

        return response()->json($payload)->withCookie(
            $this->uiSession->issueForRequest((string) $payload['username']),
        );
    }
}

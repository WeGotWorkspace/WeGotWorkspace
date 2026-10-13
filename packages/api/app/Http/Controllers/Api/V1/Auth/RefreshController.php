<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Exceptions\ApiHttpException;
use App\Http\Resources\Api\V1\AuthTokenResource;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\RefreshCookie;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class RefreshController
{
    public function __construct(
        private AuthTokenService $authTokens,
        private RefreshCookie $refreshCookie,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $presented = $this->refreshCookie->read($request);
        if ($presented === null) {
            return $this->unauthorized('Missing refresh token.');
        }

        try {
            $payload = $this->authTokens->refresh($presented);
        } catch (ApiHttpException $e) {
            if ($e->getStatusCode() === 401) {
                return $this->unauthorized($e->getMessage());
            }
            throw $e;
        }

        return (new AuthTokenResource($payload))->response()
            ->withCookie($this->refreshCookie->issue($payload['refresh_token']));
    }

    private function unauthorized(string $message): JsonResponse
    {
        return response()->json(['error' => $message, 'code' => 'unauthorized'], 401)
            ->withCookie($this->refreshCookie->forget());
    }
}

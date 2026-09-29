<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\DriveShareService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DriveShareSessionsController
{
    public function __construct(private DriveShareService $shares) {}

    public function store(Request $request): JsonResponse
    {
        $body = $this->body($request);
        $token = $body['token'] ?? null;
        $password = is_string($body['password'] ?? null) ? $body['password'] : null;
        if (! is_string($token)) {
            throw new ApiHttpException(400, 'token is required.', 'bad_request');
        }

        return response()->json($this->shares->createSessionFromPublicToken($token, $password, (string) $request->ip()));
    }

    public function accept(Request $request): JsonResponse
    {
        $body = $this->body($request);
        $inviteToken = $body['inviteToken'] ?? null;
        if (! is_string($inviteToken)) {
            throw new ApiHttpException(400, 'inviteToken is required.', 'bad_request');
        }
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->acceptInvite($principal['username'], $inviteToken),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function body(Request $request): array
    {
        $payload = $request->json()->all();

        return $payload;
    }

    /**
     * @return array{username: string, role: string}
     */
    private function principal(Request $request): array
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal;
    }
}

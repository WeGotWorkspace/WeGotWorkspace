<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\User;
use App\Services\Mcp\McpGrantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class McpGrantsController
{
    public function __construct(private McpGrantService $grants) {}

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);

        return response()->json(['grants' => $this->grants->listForUser($user)]);
    }

    public function destroy(Request $request, string $clientId): JsonResponse
    {
        $user = $this->user($request);
        if (! $this->grants->revoke($user, $clientId)) {
            return response()->json(['error' => 'Grant not found.', 'code' => 'not_found'], 404);
        }

        return response()->json(['ok' => true]);
    }

    private function user(Request $request): User
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $user = User::query()->where('username', $principal['username'])->first();
        if (! $user instanceof User) {
            abort(401, 'Unauthorized.');
        }

        return $user;
    }
}

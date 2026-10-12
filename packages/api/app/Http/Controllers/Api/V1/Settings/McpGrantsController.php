<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\McpAuditEvent;
use App\Models\User;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpGrantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class McpGrantsController
{
    public function __construct(private McpGrantService $grants) {}

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $grants = [];
        foreach ($this->grants->listForUser($user) as $grant) {
            $grant['shareCalls'] = $this->recentShareCalls((string) $user->username, $grant['clientId']);
            $grants[] = $grant;
        }

        return response()->json(['grants' => $grants]);
    }

    public function destroy(Request $request, string $clientId): JsonResponse
    {
        $user = $this->user($request);
        if (! $this->grants->revoke($user, $clientId)) {
            return response()->json(['error' => 'Grant not found.', 'code' => 'not_found'], 404);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Last 20 tool-call audit rows for this client whose tool name ends in `_share`.
     *
     * @return list<array{tool: string, outcome: string, createdAt: string, target: string|null}>
     */
    private function recentShareCalls(string $username, string $clientId): array
    {
        $rows = McpAuditEvent::query()
            ->where('username', $username)
            ->where('client_id', $clientId)
            ->where('event_type', McpAuditLogger::TOOL_CALL)
            ->whereRaw("tool LIKE ? ESCAPE '\\'", ['%\_share'])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        $calls = [];
        foreach ($rows as $row) {
            $tool = $row->tool;
            if (! is_string($tool) || ! str_ends_with($tool, '_share')) {
                continue;
            }
            $target = $row->target;
            $calls[] = [
                'tool' => $tool,
                'outcome' => $row->outcome,
                'createdAt' => $row->created_at,
                'target' => is_string($target) ? $target : null,
            ];
        }

        return $calls;
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

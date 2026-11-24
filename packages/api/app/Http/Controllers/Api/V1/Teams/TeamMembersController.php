<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Teams;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Teams\TeamMemberDirectory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Member management for a team admin of the Team, or an organization admin (#2278).
 * Every action answers a Team the caller may not manage like an unknown Team.
 */
final class TeamMembersController
{
    public function __construct(private readonly TeamMemberDirectory $directory) {}

    public function index(Request $request, string $team): JsonResponse
    {
        return response()->json(['list' => $this->directory->members($this->username($request), $team)]);
    }

    public function candidates(Request $request, string $team): JsonResponse
    {
        $query = $request->query('q');

        return response()->json([
            'list' => $this->directory->candidates($this->username($request), $team, is_string($query) ? $query : ''),
        ]);
    }

    public function store(Request $request, string $team, string $username): JsonResponse
    {
        $this->directory->setMembership($this->username($request), $team, $username, true);

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $team, string $username): JsonResponse
    {
        $this->directory->setMembership($this->username($request), $team, $username, false);

        return response()->json(['ok' => true]);
    }

    public function appoint(Request $request, string $team, string $username): JsonResponse
    {
        $this->directory->setTeamAdmin($this->username($request), $team, $username, true);

        return response()->json(['ok' => true]);
    }

    public function dismiss(Request $request, string $team, string $username): JsonResponse
    {
        $this->directory->setTeamAdmin($this->username($request), $team, $username, false);

        return response()->json(['ok' => true]);
    }

    private function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }
}

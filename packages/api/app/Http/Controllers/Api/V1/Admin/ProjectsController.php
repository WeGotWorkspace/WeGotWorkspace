<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\Principal;
use App\Models\Project;
use App\Services\Admin\AdminConstants;
use App\Services\Projects\ProjectLifecycle;
use App\Services\Teams\TeamColleagues;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Archived Projects of the organization admin's own Teams (#810). A team admin archives a
 * Project; deleting it for good, with its collections and folder, is done here.
 */
final class ProjectsController
{
    public function __construct(
        private readonly ProjectLifecycle $lifecycle,
        private readonly TeamColleagues $colleagues,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $viewer = (string) $principal['username'];
        // Same rule as ProjectService::findVisible, which the purge applies: only a member sees a Team's Projects.
        $projects = Project::query()
            ->whereNotNull('archived_at')
            ->whereNull('default_for_group')
            ->orderBy('group_slug')
            ->orderBy('name')
            ->get()
            ->filter(fn (Project $p): bool => $this->colleagues->isOwnTeam($viewer, (string) $p->group_slug))
            ->values();
        $teamNames = Principal::query()
            ->whereIn('uri', $projects->map(fn (Project $p): string => AdminConstants::GROUP_PREFIX.$p->group_slug)->unique()->values()->all())
            ->pluck('displayname', 'uri');

        return response()->json(['list' => $projects->map(fn (Project $project): array => [
            'id' => (string) $project->id,
            'teamSlug' => (string) $project->group_slug,
            'teamName' => (string) ($teamNames[AdminConstants::GROUP_PREFIX.$project->group_slug] ?? $project->group_slug),
            'name' => (string) $project->name,
            'color' => $project->color,
            'archivedAt' => $project->archived_at?->toIso8601ZuluString(),
        ])->values()->all()]);
    }

    public function destroy(Request $request, string $project): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->lifecycle->purgeAsOrganizationAdmin((string) $principal['username'], $project);

        return response()->json(['ok' => true]);
    }
}

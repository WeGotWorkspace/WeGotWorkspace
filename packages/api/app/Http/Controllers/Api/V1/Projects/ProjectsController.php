<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Projects;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Projects\ProjectLifecycle;
use App\Services\Projects\ProjectService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Projects of the caller's Teams (#817). Reading needs membership of the Team;
 * writing needs the team-admin role for it. A Project of another Team answers
 * like an unknown id.
 */
final class ProjectsController
{
    public function __construct(
        private readonly ProjectService $projects,
        private readonly ProjectLifecycle $lifecycle,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $archived = in_array((string) $request->query('archived', ''), ['1', 'true'], true);

        return response()->json(['list' => $this->projects->list($this->username($request), $archived)]);
    }

    public function show(Request $request, string $project): JsonResponse
    {
        return response()->json($this->projects->show($this->username($request), $project));
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json($this->projects->create($this->username($request), $this->payload($request)), 201);
    }

    public function update(Request $request, string $project): JsonResponse
    {
        return response()->json($this->projects->patch($this->username($request), $project, $this->payload($request)));
    }

    public function archive(Request $request, string $project): JsonResponse
    {
        return response()->json($this->lifecycle->archive($this->username($request), $project));
    }

    public function unarchive(Request $request, string $project): JsonResponse
    {
        return response()->json($this->lifecycle->unarchive($this->username($request), $project));
    }

    /** Purge: only an archived Project (#819). */
    public function destroy(Request $request, string $project): JsonResponse
    {
        $this->lifecycle->purge($this->username($request), $project);

        return response()->json(['ok' => true]);
    }

    /** @return array<string, mixed> */
    private function payload(Request $request): array
    {
        return $request->json()->all();
    }

    private function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }
}

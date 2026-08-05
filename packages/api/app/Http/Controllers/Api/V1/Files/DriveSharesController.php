<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\DriveSharePrincipalDirectoryService;
use App\Services\Drive\DriveShareService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DriveSharesController
{
    public function __construct(
        private DriveShareService $shares,
        private DriveSharePrincipalDirectoryService $principalDirectory,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->listForOwner($principal['username'], $request->query('path')),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->createShare($principal['username'], $this->body($request)),
        ]);
    }

    public function show(Request $request, string $shareId): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->getShareForOwner($principal['username'], $shareId),
        ]);
    }

    public function update(Request $request, string $shareId): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->updateShare($principal['username'], $shareId, $this->body($request)),
        ]);
    }

    public function destroy(Request $request, string $shareId): JsonResponse
    {
        $principal = $this->principal($request);
        $this->shares->revokeShare($principal['username'], $shareId);

        return response()->json(['data' => 'Deleted']);
    }

    public function sharedWithMe(Request $request): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->sharedWithMe($principal['username']),
        ]);
    }

    public function atPath(Request $request): JsonResponse
    {
        $principal = $this->principal($request);
        $path = $request->query('path');
        if (! is_string($path) || trim($path) === '') {
            throw new ApiHttpException(400, 'path is required.', 'bad_request');
        }

        return response()->json([
            'data' => $this->shares->atPath($principal, $path),
        ]);
    }

    public function revokeAllPublic(Request $request): JsonResponse
    {
        $principal = $this->principal($request);
        $path = $request->query('path');
        if (! is_string($path) || trim($path) === '') {
            throw new ApiHttpException(400, 'path is required.', 'bad_request');
        }

        return response()->json([
            'data' => $this->shares->revokeAllPublicUnderPath($principal['username'], $path),
        ]);
    }

    public function byPrincipal(Request $request): JsonResponse
    {
        $principal = $this->principal($request);
        $queryPrincipal = $request->query('principal');
        if (! is_string($queryPrincipal) || trim($queryPrincipal) === '') {
            throw new ApiHttpException(400, 'principal is required.', 'bad_request');
        }

        $scope = $request->query('scope');
        $scopePath = is_string($scope) && trim($scope) !== '' ? $scope : null;

        return response()->json([
            'data' => $this->shares->byPrincipal($principal['username'], $queryPrincipal, $scopePath),
        ]);
    }

    public function principals(Request $request): JsonResponse
    {
        $this->principal($request);
        $query = $request->query('query');
        if (! is_string($query)) {
            $query = '';
        }

        return response()->json([
            'data' => $this->principalDirectory->search($query),
        ]);
    }

    public function storeInvite(Request $request, string $shareId): JsonResponse
    {
        $principal = $this->principal($request);

        return response()->json([
            'data' => $this->shares->createInvite($principal['username'], $shareId, $this->body($request)),
        ]);
    }

    public function destroyInvite(Request $request, string $shareId, string $inviteId): JsonResponse
    {
        $principal = $this->principal($request);
        $this->shares->revokeInvite($principal['username'], $shareId, $inviteId);

        return response()->json(['data' => 'Deleted']);
    }

    /**
     * @return array<string, mixed>
     */
    private function body(Request $request): array
    {
        $payload = $request->json()->all();
        if (! is_array($payload)) {
            throw new ApiHttpException(400, 'Invalid request body.', 'bad_request');
        }

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

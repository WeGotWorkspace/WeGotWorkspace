<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notes;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\DriveShareService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SharedController
{
    public function __construct(private DriveShareService $shares) {}

    public function sharedWithMe(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json([
            'items' => $this->shares->notesSharedWithMe($principal['username']),
        ]);
    }

    public function sharedNotebooks(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json([
            'items' => $this->shares->notesSharedNotebooks($principal['username']),
        ]);
    }
}

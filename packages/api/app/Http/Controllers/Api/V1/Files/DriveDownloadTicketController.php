<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\PathDownloadTicketIssuer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /files/download-tickets` (#1622): a download ticket for one file by
 * drive path, reachable by share-link guests. The ticket URL is the same
 * public route as JMAP tickets (`GET /jmap/download-ticket/{secret}/{name}`).
 */
final class DriveDownloadTicketController
{
    public function __construct(private readonly PathDownloadTicketIssuer $issuer) {}

    public function store(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string, sid?: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $path = $request->input('path');
        if (! is_string($path)) {
            throw new ApiHttpException(400, 'path is required.', 'bad_request');
        }

        return response()->json($this->issuer->issue($principal, $path), 201);
    }
}

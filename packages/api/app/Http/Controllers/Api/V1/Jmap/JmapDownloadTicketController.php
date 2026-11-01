<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Support\RangeResponder;
use App\Services\Jmap\Download\DownloadTicketService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Download tickets (#1500): `store` issues a ticket for one blobId on the
 * authenticated route; `show` serves it on an unauthenticated URL the
 * browser can download natively (with Range resumes). The ticket is not a
 * session token and grants nothing else.
 */
final class JmapDownloadTicketController
{
    public function __construct(
        private readonly DownloadTicketService $tickets,
        private readonly RangeResponder $ranges,
    ) {}

    public function store(Request $request, string $accountId): JsonResponse
    {
        /** @var array{username: string, role: string, sid?: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if ($accountId !== $principal['username']) {
            throw new ApiHttpException(404, 'Account not found.', 'not_found');
        }

        $blobId = $request->input('blobId');
        $name = $request->input('name');
        $type = $request->input('type');
        if (! is_string($blobId) || $blobId === '' || strlen($blobId) > 128) {
            throw new ApiHttpException(400, 'blobId is required.', 'bad_request');
        }
        if (! is_string($name) || trim($name) === '' || strlen($name) > 255 || preg_match('/[\x00-\x1f\x7f\/\\\\]/', $name) === 1 || in_array(trim($name), ['.', '..'], true)) {
            throw new ApiHttpException(400, 'name must be a file name.', 'bad_request');
        }
        if ($type !== null && (! is_string($type) || strlen($type) > 255 || preg_match('/[\x00-\x1f\x7f]/', $type) === 1)) {
            throw new ApiHttpException(400, 'type must be a media type.', 'bad_request');
        }

        $issued = $this->tickets->issue($principal, $blobId, trim($name), is_string($type) && $type !== '' ? $type : null);

        return response()->json($issued, 201);
    }

    public function show(Request $request, string $secret, string $name): Response
    {
        $redeemed = $this->tickets->redeem($secret);
        $stream = $redeemed !== null ? $redeemed['blob']->open() : null;
        if ($redeemed === null || $stream === null) {
            return response()
                ->json(['type' => 'about:blank', 'status' => 404, 'detail' => 'Download ticket not found or expired.'], 404)
                ->header('Content-Type', 'application/problem+json');
        }
        $ticket = $redeemed['ticket'];
        $type = is_string($ticket->media_type) && $ticket->media_type !== ''
            ? $ticket->media_type
            : $redeemed['blob']->mediaType;

        return $this->ranges->respond($request, $stream, [
            'Content-Type' => $this->sanitize($type),
            'Content-Disposition' => 'attachment; filename="'.$this->sanitize((string) $ticket->file_name).'"',
            'Cache-Control' => 'private, no-store',
            // An unauthenticated URL on our origin: never let it render.
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "sandbox; default-src 'none'",
        ], $this->tickets->streamingActivity($ticket));
    }

    private function sanitize(string $value): string
    {
        return str_replace(["\r", "\n", '"'], '', $value);
    }
}

<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Contacts\ContactBlobService;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\FileNodes\FileNodeBlobResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * JMAP blob upload/download (RFC 8620 §6, #438), replacing the 501 stubs.
 *
 * Download serves blobIds from ALL stores that surface ids through the
 * envelope: the envelope store (JmapBlobService, `jb-…`), the contacts REST
 * blob store (ContactBlobService, UUID-shaped), and drive file content via
 * node-derived `fnb-…` ids (FileNodeBlobResolver, #450) — every blobId the
 * envelope surfaces must be downloadable through the Session's downloadUrl.
 */
final class JmapBlobController
{
    public function __construct(
        private readonly JmapBlobService $blobs,
        private readonly ContactBlobService $contactBlobs,
        private readonly FileNodeBlobResolver $fileNodeBlobs,
    ) {}

    public function upload(Request $request, string $accountId): JsonResponse
    {
        $username = $this->username($request);
        if ($accountId !== $username) {
            return $this->notFoundProblem('Account not found.');
        }

        $contents = $request->getContent();
        if (strlen($contents) > JmapBlobService::maxSizeUpload()) {
            // RFC 8620 §6.1: over-limit uploads get the `limit` problem type
            // with limit: maxSizeUpload.
            return response()
                ->json([
                    'type' => 'urn:ietf:params:jmap:error:limit',
                    'status' => 400,
                    'detail' => 'The file is larger than maxSizeUpload.',
                    'limit' => 'maxSizeUpload',
                ], 400)
                ->header('Content-Type', 'application/problem+json');
        }

        $mediaType = (string) $request->header('Content-Type', 'application/octet-stream');
        // Strip parameters (e.g. "; charset=…") — the type is echoed back
        // and stored as the blob's media type.
        $mediaType = trim(explode(';', $mediaType, 2)[0]);

        try {
            $stored = $this->blobs->store($username, $mediaType, $contents);
        } catch (ApiHttpException $e) {
            return response()
                ->json([
                    'type' => 'urn:ietf:params:jmap:error:limit',
                    'status' => 400,
                    'detail' => $e->getMessage(),
                    'limit' => 'maxSizeUpload',
                ], 400)
                ->header('Content-Type', 'application/problem+json');
        }

        return response()->json([
            'accountId' => $username,
            'blobId' => $stored['blobId'],
            'type' => $stored['type'],
            'size' => $stored['size'],
        ], 201);
    }

    public function download(Request $request, string $accountId, string $blobId, string $name): Response|JsonResponse
    {
        $username = $this->username($request);
        if ($accountId !== $username) {
            return $this->notFoundProblem('Account not found.');
        }

        $blob = $this->blobs->retrieve($username, $blobId)
            ?? $this->contactBlobs->retrieve($username, $blobId)
            ?? $this->fileNodeBlobs->retrieve($username, $blobId);
        if ($blob === null) {
            return $this->notFoundProblem('Blob not found.');
        }

        $type = $request->query('type');
        $contentType = is_string($type) && $type !== ''
            ? $this->sanitizeHeaderValue($type)
            : $blob['mediaType'];

        return response($blob['contents'], 200, [
            'Content-Type' => $contentType,
            'Content-Length' => (string) strlen($blob['contents']),
            'Content-Disposition' => 'attachment; filename="'.$this->sanitizeHeaderValue($name).'"',
            // Blob content is immutable per blobId (content-addressed).
            'Cache-Control' => 'private, immutable, max-age=31536000',
        ]);
    }

    private function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }

    private function notFoundProblem(string $detail): JsonResponse
    {
        return response()
            ->json(['type' => 'about:blank', 'status' => 404, 'detail' => $detail], 404)
            ->header('Content-Type', 'application/problem+json');
    }

    private function sanitizeHeaderValue(string $value): string
    {
        return str_replace(["\r", "\n", '"'], '', $value);
    }
}
